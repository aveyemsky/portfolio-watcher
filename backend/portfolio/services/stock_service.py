from datetime import datetime
import time

from portfolio.api.errors import (
    NotFoundError,
    ServiceError,
    UpstreamRateLimitError,
    UpstreamTimeoutError,
    ValidationError,
)
from portfolio.core.logging import get_logger
from portfolio.data.repositories import price_repository, stock_repository
from portfolio.services import stock_data_service

logger = get_logger(__name__)


def list_stocks(asset_type="stock"):
    return stock_repository.list_stocks(asset_type=asset_type)


def get_stock_by_symbol(symbol):
    return stock_repository.get_stock_by_symbol(symbol)


def add_stock(
    symbol,
    asset_type="stock",
    is_deletable=True,
    display_order=None,
    short_name=None,
):
    normalized = _normalize_symbol(symbol)
    existing = stock_repository.get_stock_by_symbol(normalized)
    if existing:
        logger.info("Stock already tracked: %s", normalized)
        # If metadata fields need updating (e.g. promoting to index)
        updates = {}
        if asset_type and existing.asset_type != asset_type:
            updates["asset_type"] = asset_type
        if is_deletable is not None and existing.is_deletable != is_deletable:
            updates["is_deletable"] = is_deletable
        if display_order is not None and existing.display_order != display_order:
            updates["display_order"] = display_order
        if short_name and existing.short_name != short_name:
            updates["short_name"] = short_name
        if updates:
            existing = stock_repository.update_stock_metadata(existing, updates)

        prices = price_repository.list_prices_for_stock_id(existing.id)
        if not prices:
            prices = sync_stock_prices(normalized)["prices"]
        if asset_type == "stock":
            _ensure_tenant_tracked_stock(normalized)
        return {"stock": existing, "prices": prices, "created": False}

    try:
        metadata = stock_data_service.fetch_stock_info(normalized)
        latest_split_date = stock_data_service.fetch_latest_split_date(normalized)
        history_result = stock_data_service.fetch_stock_price_history(normalized, return_meta=True)
        fetched_prices = history_result["prices"]
        has_missing_data = history_result["has_missing_data"]
        if not fetched_prices:
            raise NotFoundError(f"No market data found for symbol '{normalized}'. Please check the symbol.")
    except (NotFoundError, ValidationError, UpstreamRateLimitError, UpstreamTimeoutError):
        raise
    except Exception as exc:
        logger.exception("Failed to fetch stock data for %s", normalized)
        err_msg = str(exc).lower()
        if "429" in err_msg or "too many requests" in err_msg or "rate limit" in err_msg:
            raise UpstreamRateLimitError(
                f"Yahoo Finance is temporarily rate-limiting requests for {normalized}."
            ) from exc
        if "timeout" in err_msg or "timed out" in err_msg:
            raise UpstreamTimeoutError(
                f"Connection to Yahoo Finance timed out while fetching {normalized}."
            ) from exc
        raise ServiceError(
            f"Unable to fetch stock data for {normalized}. Please check the symbol and network connection."
        ) from exc

    stock = stock_repository.create_stock(
        symbol=normalized,
        name=metadata.get("name") or normalized,
        sector=metadata.get("sector") or ("Index" if asset_type == "index" else "Unknown"),
        exchange=metadata.get("exchange"),
        currency=metadata.get("currency"),
        last_price=metadata.get("last_price"),
        previous_close=metadata.get("previous_close"),
        market_cap=metadata.get("market_cap"),
        last_split_date=latest_split_date,
        split_dirty=False,
        price_dirty=has_missing_data,
        post_market_price=metadata.get("post_market_price"),
        post_market_change=metadata.get("post_market_change"),
        post_market_change_percent=metadata.get("post_market_change_percent"),
        pre_market_price=metadata.get("pre_market_price"),
        pre_market_change=metadata.get("pre_market_change"),
        pre_market_change_percent=metadata.get("pre_market_change_percent"),
        day_open=metadata.get("day_open"),
        day_high=metadata.get("day_high"),
        day_low=metadata.get("day_low"),
        asset_type=asset_type,
        is_deletable=is_deletable,
        display_order=display_order,
        short_name=short_name,
    )
    prices = price_repository.replace_prices_for_stock_id(stock.id, fetched_prices) if fetched_prices else []
    if prices:
        latest = prices[-1]
        previous = prices[-2] if len(prices) > 1 else None
        live_last = metadata.get("last_price")
        live_prev = metadata.get("previous_close")
        stock = stock_repository.update_stock_metadata(
            stock,
            {
                "last_price": live_last if live_last is not None else latest.close,
                "previous_close": live_prev if live_prev is not None else (previous.close if previous else None),
                "price_dirty": has_missing_data,
            },
        )
    if asset_type == "stock":
        _ensure_tenant_tracked_stock(normalized)
    return {"stock": stock, "prices": prices, "created": True}


def _ensure_tenant_tracked_stock(symbol):
    """Ensure a stock is present in the active tenant's tracked_stocks list."""
    try:
        from portfolio.data.db import db
        from portfolio.data.models import TrackedStock
        existing = TrackedStock.query.filter_by(symbol=symbol).first()
        if not existing:
            ts = TrackedStock(symbol=symbol)
            db.session.add(ts)
            db.session.commit()
    except Exception as exc:
        logger.debug("Tenant tracked stock registration fallback: %s", exc)


def delete_stock(symbol, force=False):
    normalized = _normalize_symbol(symbol)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    if not getattr(stock, "is_deletable", True) and not force:
        raise ValidationError(
            f"Cannot delete {normalized} because it is a protected market index.",
            status_code=403,
            code="stock_protected",
        )

    # In tenant mode: check if THIS tenant has holdings of this symbol
    from portfolio.data.db import db
    from portfolio.data.models import Holding, TrackedStock
    try:
        holding_count = Holding.query.filter_by(symbol=normalized).count()
        if holding_count > 0 and not force:
            raise ValidationError(
                f"Cannot delete {normalized} because it is used by one or more holdings in your portfolio.",
                status_code=409,
                code="stock_in_use",
            )
        # Remove from this tenant's tracked_stocks
        ts = TrackedStock.query.filter_by(symbol=normalized).first()
        if ts:
            db.session.delete(ts)
            db.session.commit()
        return {"symbol": normalized, "deleted": True}
    except ValidationError:
        raise
    except Exception as exc:
        logger.debug("Tenant tracked stock delete check: %s", exc)

    # Standalone single-tenant fallback (when not using tenant tracked_stocks)
    if (stock.subscriber_count or 0) > 0 and not force:
        raise ValidationError(
            f"Cannot delete {normalized} because it is used by one or more holdings.",
            status_code=409,
            code="stock_in_use",
        )

    price_repository.delete_prices_for_stock_id(stock.id)
    stock_repository.delete_stock(stock)
    return {"symbol": normalized, "deleted": True}


def sync_stock(symbol, skip_info=False):
    normalized = _normalize_symbol(symbol)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    try:
        needs_info = (
            not skip_info
            or not stock.name
            or stock.name == stock.symbol
            or stock.sector in (None, "Unknown", "")
        )
        if needs_info:
            metadata = stock_data_service.fetch_stock_info(normalized)
            stock = stock_repository.update_stock_metadata(stock, metadata)
        prices = sync_stock_prices(normalized)["prices"]
    except Exception as exc:
        logger.exception("Failed to sync stock %s", normalized)
        raise ServiceError(
            f"Unable to sync {normalized}. Please check the symbol and network connection."
        ) from exc

    return {"stock": stock, "prices": prices}


def sync_stock_prices(symbol):
    normalized = _normalize_symbol(symbol)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    price_count = price_repository.count_prices_for_stock_id(stock.id)
    latest_split_date = stock_data_service.fetch_latest_split_date(normalized)

    # Step 1 & 2: Check if a new split occurred or unhandled split exists
    has_new_split = False
    if latest_split_date is not None:
        if stock.last_split_date is None:
            if price_count > 0:
                # Stock had prices saved prior to split tracking (e.g. CRWD).
                # A split exists, so old prices in DB need full reload.
                has_new_split = True
            else:
                stock = stock_repository.update_stock_metadata(
                    stock,
                    {"last_split_date": latest_split_date, "split_dirty": False},
                )
        elif latest_split_date > stock.last_split_date:
            has_new_split = True

    if has_new_split:
        logger.info(
            "Split detected for %s on %s (previous: %s). Marking dirty.",
            normalized,
            latest_split_date,
            stock.last_split_date,
        )
        stock = stock_repository.update_stock_metadata(
            stock,
            {"last_split_date": latest_split_date, "split_dirty": True},
        )

    # Step 3: If dirty (split_dirty, price_dirty, or no existing prices), delete & reload all historical data
    is_dirty = stock.split_dirty or getattr(stock, "price_dirty", False) or price_count == 0
    if is_dirty:
        logger.info(
            "Reloading all prices for dirty stock %s (split_dirty=%s, price_dirty=%s)",
            normalized,
            stock.split_dirty,
            getattr(stock, "price_dirty", False),
        )
        history_result = stock_data_service.fetch_stock_price_history(normalized, return_meta=True)
        prices = history_result["prices"]
        has_missing_data = history_result["has_missing_data"]
        if not prices:
            raise ServiceError(f"No price history returned for {normalized}")
        stored_prices = price_repository.replace_prices_for_stock_id(stock.id, prices)
        stock = stock_repository.update_stock_metadata(
            stock,
            {
                "split_dirty": False,
                "price_dirty": has_missing_data,
            },
        )
    else:
        # Step 4: Not dirty - fast incremental sync
        latest_date = price_repository.get_latest_price_date(stock.id)
        history_result = stock_data_service.fetch_stock_price_history(
            normalized,
            start_date=latest_date.isoformat() if latest_date else None,
            return_meta=True,
        )
        prices = history_result["prices"]
        has_missing_data = history_result["has_missing_data"]
        if not prices:
            # Prices are already up-to-date
            stored_prices = price_repository.list_prices_for_stock_id(stock.id)
        else:
            stored_prices = price_repository.upsert_prices_for_stock_id(stock.id, prices)
            if has_missing_data:
                stock = stock_repository.update_stock_metadata(stock, {"price_dirty": True})
            elif getattr(stock, "price_dirty", False):
                stock = stock_repository.update_stock_metadata(stock, {"price_dirty": False})

    if stored_prices:
        latest = stored_prices[-1]
        previous = stored_prices[-2] if len(stored_prices) > 1 else None
        stock_updates = {}
        if stock.last_price is None:
            stock_updates["last_price"] = latest.close
        if stock.previous_close is None and previous:
            stock_updates["previous_close"] = previous.close
        if stock_updates:
            stock = stock_repository.update_stock_metadata(stock, stock_updates)
    return {"stock": stock, "prices": stored_prices}


ACTIVE_COOLDOWN_SECONDS = 15
CLOSED_COOLDOWN_SECONDS = 300  # 5 minutes when market is closed (weekends & overnight)

_last_refresh_state = {
    "timestamp": None,
    "session": None,
}


def refresh_all_stock_quotes(force=False, all_master=False):
    if all_master:
        stocks = stock_repository.list_all_master_stocks()
    else:
        stocks = stock_repository.list_stocks()
    if not stocks:
        return []

    now = datetime.now(stock_data_service.MARKET_TIMEZONE)
    session = stock_data_service.get_market_session(now)

    # Timing Guardrail: check cooldown unless force=True
    if not force and _last_refresh_state["timestamp"] is not None:
        elapsed = (now - _last_refresh_state["timestamp"]).total_seconds()
        cooldown = CLOSED_COOLDOWN_SECONDS if session == "closed" else ACTIVE_COOLDOWN_SECONDS
        if elapsed < cooldown:
            logger.debug(
                "Quote refresh throttle active (elapsed=%.1fs, cooldown=%ds, session=%s); returning cached DB quotes",
                elapsed,
                cooldown,
                session,
            )
            return stocks

    symbols = [s.symbol for s in stocks]
    quotes = stock_data_service.fetch_batch_stock_quotes(symbols)
    _last_refresh_state["timestamp"] = now
    _last_refresh_state["session"] = session

    updated_stocks = []
    any_updated = False
    for stock in stocks:
        quote = quotes.get(stock.symbol)
        if quote:
            updates = {}
            # Logic guardrail: prices must be positive numbers
            if quote.get("last_price") is not None and quote["last_price"] > 0:
                updates["last_price"] = quote["last_price"]
            if quote.get("previous_close") is not None and quote["previous_close"] > 0:
                updates["previous_close"] = quote["previous_close"]
            if quote.get("market_cap") is not None:
                updates["market_cap"] = quote["market_cap"]
            for field in (
                "post_market_price",
                "post_market_change",
                "post_market_change_percent",
                "pre_market_price",
                "pre_market_change",
                "pre_market_change_percent",
            ):
                if field in quote:
                    updates[field] = quote[field]
            for field in ("day_open", "day_high", "day_low"):
                if field in quote and quote[field] is not None:
                    updates[field] = quote[field]
            if updates:
                stock = stock_repository.update_stock_metadata(stock, updates, commit=False)
                any_updated = True
        updated_stocks.append(stock)

    if any_updated:
        from portfolio.data.db import db
        db.session.commit()

    return updated_stocks


def refresh_stock_quote(symbol):
    normalized = _normalize_symbol(symbol)
    stock = stock_repository.get_stock_by_symbol(normalized)
    if not stock:
        raise NotFoundError(f"Stock not found: {normalized}")

    metadata = stock_data_service.fetch_stock_info(normalized)
    updates = {}
    if metadata.get("last_price") is not None:
        updates["last_price"] = metadata["last_price"]
    if metadata.get("previous_close") is not None:
        updates["previous_close"] = metadata["previous_close"]
    if metadata.get("market_cap") is not None:
        updates["market_cap"] = metadata["market_cap"]
    for field in (
        "post_market_price",
        "post_market_change",
        "post_market_change_percent",
        "pre_market_price",
        "pre_market_change",
        "pre_market_change_percent",
    ):
        if field in metadata:
            updates[field] = metadata[field]
    for field in ("day_open", "day_high", "day_low"):
        if field in metadata and metadata[field] is not None and metadata[field] > 0:
            updates[field] = metadata[field]
    if updates:
        stock = stock_repository.update_stock_metadata(stock, updates)
    return stock


def sync_all_stocks(max_duration_seconds=25, all_master=False):
    # 1. High-speed batch quote refresh upfront (~1-2s for all tracked tickers)
    try:
        if all_master:
            refresh_all_stock_quotes(force=True, all_master=True)
        else:
            refresh_all_stock_quotes(force=True)
    except Exception as exc:
        logger.warning("Upfront batch quote refresh in sync_all_stocks failed: %s", exc)

    synced = []
    failed = []
    consecutive_failures = 0
    circuit_broken = False
    timed_out = False
    # Prioritize market indices first so benchmarks (SKEW, VIX, SPX) always have fresh EOD candles
    if all_master:
        indices = stock_repository.list_all_master_stocks(asset_type="index")
        stocks = stock_repository.list_all_master_stocks(asset_type="stock")
    else:
        indices = stock_repository.list_stocks(asset_type="index")
        stocks = stock_repository.list_stocks(asset_type="stock")
    all_targets = indices + stocks
    start_time = time.monotonic()

    for stock in all_targets:
        elapsed = time.monotonic() - start_time
        if elapsed > max_duration_seconds:
            logger.warning(
                "sync_all_stocks reached time budget (%.1fs > %ds); terminating early",
                elapsed,
                max_duration_seconds,
            )
            timed_out = True
            break

        if consecutive_failures >= 3:
            logger.warning(
                "sync_all_stocks encountered 3 consecutive failures; tripping circuit breaker",
            )
            circuit_broken = True
            break

        try:
            sync_stock(stock.symbol, skip_info=True)
            consecutive_failures = 0
            synced.append(stock.symbol)
        except Exception as exc:
            consecutive_failures += 1
            logger.exception("Failed to sync stock %s", stock.symbol)
            failed.append({"symbol": stock.symbol, "message": str(exc)})

    return {
        "synced": synced,
        "failed": failed,
        "circuit_broken": circuit_broken,
        "timed_out": timed_out,
    }


def retrieve_latest_prices(symbol=None):
    """
    Fetch latest market data through the migrated yfinance provider wrapper.
    """
    if symbol:
        return sync_stock(symbol)
    return sync_all_stocks()


def _normalize_symbol(symbol):
    try:
        return stock_data_service.normalize_symbol(symbol)
    except ValueError as exc:
        raise ValidationError(str(exc)) from exc
