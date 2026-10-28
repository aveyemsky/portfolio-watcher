from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from flask import current_app

from portfolio.api.errors import NotFoundError, ServiceError, ValidationError
from portfolio.core.logging import get_logger
from portfolio.data.repositories import intraday_price_repository, stock_repository
from portfolio.services import stock_data_service

logger = get_logger(__name__)

MARKET_TIMEZONE = ZoneInfo("America/New_York")


def get_stock_intraday(symbol, interval=None):
    normalized = _normalize_symbol(symbol)
    interval = _normalize_interval(interval)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    trading_date = intraday_price_repository.get_latest_trading_date(stock.id, interval) or current_market_date()
    cached = intraday_price_repository.list_intraday_prices(stock.id, trading_date, interval)
    fetched_at = intraday_price_repository.get_latest_fetched_at(stock.id, trading_date, interval)

    if cached and fetched_at and not _is_stale(fetched_at):
        logger.info("Returning cached intraday prices for %s interval=%s", normalized, interval)
        return {
            "stock": stock,
            "symbol": normalized,
            "interval": interval,
            "trading_date": trading_date,
            "fetched_at": fetched_at,
            "prices": cached,
        }

    return refresh_stock_intraday(normalized, interval=interval)


def refresh_stock_intraday(symbol, interval=None):
    normalized = _normalize_symbol(symbol)
    interval = _normalize_interval(interval)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    trading_date = current_market_date()
    fetched_at = datetime.now(MARKET_TIMEZONE)

    try:
        fetched_prices = stock_data_service.fetch_stock_intraday_history(normalized, interval=interval)
    except Exception as exc:
        logger.exception("Failed to fetch intraday prices for %s", normalized)
        raise ServiceError(
            f"Unable to fetch intraday data for {normalized}. Please check the symbol and network connection."
        ) from exc

    effective_trading_date = trading_date
    if fetched_prices:
        effective_trading_date = max(price["trading_date"] for price in fetched_prices)

    current_day_prices = [
        price for price in fetched_prices
        if price.get("trading_date") == effective_trading_date
    ]
    if not current_day_prices:
        cached = intraday_price_repository.list_intraday_prices(stock.id, effective_trading_date, interval)
        logger.info("No intraday price history returned for %s for trading date %s.", normalized, effective_trading_date)
        return {
            "stock": stock,
            "symbol": normalized,
            "interval": interval,
            "trading_date": effective_trading_date,
            "fetched_at": fetched_at,
            "prices": cached or [],
        }

    prices = intraday_price_repository.replace_intraday_prices(
        stock.id,
        normalized,
        effective_trading_date,
        interval,
        current_day_prices,
        fetched_at,
    )
    _cleanup_old_intraday_rows()

    return {
        "stock": stock,
        "symbol": normalized,
        "interval": interval,
        "trading_date": effective_trading_date,
        "fetched_at": fetched_at,
        "prices": prices,
    }


def current_market_date():
    return datetime.now(MARKET_TIMEZONE).date()


def _normalize_interval(interval):
    interval = (interval or current_app.config.get("DEFAULT_INTRADAY_INTERVAL", "5m")).strip()
    supported = current_app.config.get("SUPPORTED_INTRADAY_INTERVALS", ["1m", "5m", "15m"])
    if interval not in supported:
        raise ValidationError(f"Unsupported intraday interval: {interval}")
    return interval


def _normalize_symbol(symbol):
    try:
        return stock_data_service.normalize_symbol(symbol)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc


def _is_stale(fetched_at):
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=MARKET_TIMEZONE)
    age = datetime.now(MARKET_TIMEZONE) - fetched_at.astimezone(MARKET_TIMEZONE)
    ttl = current_app.config.get("INTRADAY_CACHE_TTL_SECONDS", 60)
    return age > timedelta(seconds=ttl)


def _cleanup_old_intraday_rows():
    cutoff_date = current_market_date() - timedelta(days=7)
    intraday_price_repository.delete_intraday_prices_before(cutoff_date)
