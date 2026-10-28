from portfolio.core.logging import get_logger
from portfolio.data.db import db
from portfolio.data.models import StockIntradayPrice

logger = get_logger(__name__)


def list_intraday_prices(stock_id, trading_date, interval):
    logger.debug(
        "Listing intraday prices stock_id=%s trading_date=%s interval=%s",
        stock_id,
        trading_date,
        interval,
    )
    return (
        StockIntradayPrice.query.filter(
            StockIntradayPrice.stock_id == stock_id,
            StockIntradayPrice.trading_date == trading_date,
            StockIntradayPrice.interval == interval,
        )
        .order_by(StockIntradayPrice.timestamp.asc())
        .all()
    )


def get_latest_trading_date(stock_id, interval):
    latest = (
        StockIntradayPrice.query.filter(
            StockIntradayPrice.stock_id == stock_id,
            StockIntradayPrice.interval == interval,
        )
        .order_by(StockIntradayPrice.trading_date.desc())
        .first()
    )
    return latest.trading_date if latest else None


def get_latest_fetched_at(stock_id, trading_date, interval):
    latest = (
        StockIntradayPrice.query.filter(
            StockIntradayPrice.stock_id == stock_id,
            StockIntradayPrice.trading_date == trading_date,
            StockIntradayPrice.interval == interval,
        )
        .order_by(StockIntradayPrice.fetched_at.desc())
        .first()
    )
    return latest.fetched_at if latest else None


def replace_intraday_prices(stock_id, symbol, trading_date, interval, prices, fetched_at):
    logger.info(
        "Replacing intraday prices stock_id=%s symbol=%s trading_date=%s interval=%s rows=%s",
        stock_id,
        symbol,
        trading_date,
        interval,
        len(prices),
    )
    StockIntradayPrice.query.filter(
        StockIntradayPrice.stock_id == stock_id,
        StockIntradayPrice.trading_date == trading_date,
        StockIntradayPrice.interval == interval,
    ).delete()

    for price in prices:
        db.session.add(
            StockIntradayPrice(
                stock_id=stock_id,
                symbol=symbol,
                trading_date=trading_date,
                timestamp=price["timestamp"],
                interval=interval,
                open=price["open"],
                high=price["high"],
                low=price["low"],
                close=price["close"],
                volume=price.get("volume") or 0,
                provider=price.get("provider") or "yfinance",
                fetched_at=fetched_at,
            )
        )

    db.session.commit()
    return list_intraday_prices(stock_id, trading_date, interval)


def delete_intraday_prices_before(cutoff_date):
    logger.info("Deleting intraday prices before %s", cutoff_date)
    deleted = StockIntradayPrice.query.filter(StockIntradayPrice.trading_date < cutoff_date).delete()
    db.session.commit()
    return deleted
