from portfolio.core.logging import get_logger
from portfolio.data.db import db
from portfolio.data.models import Stock, StockPrice

logger = get_logger(__name__)


def list_prices_for_symbol(symbol):
    logger.debug("Listing prices for symbol=%s", symbol)
    return (
        StockPrice.query.join(Stock)
        .filter(Stock.symbol == symbol.upper())
        .order_by(StockPrice.date.asc())
        .all()
    )


def list_prices_for_stock_id(stock_id):
    logger.debug("Listing prices for stock id=%s", stock_id)
    return (
        StockPrice.query.filter(StockPrice.stock_id == stock_id)
        .order_by(StockPrice.date.asc())
        .all()
    )


def get_latest_price_date(stock_id):
    latest = (
        StockPrice.query.filter(StockPrice.stock_id == stock_id)
        .order_by(StockPrice.date.desc())
        .first()
    )
    return latest.date if latest else None


def count_prices_for_stock_id(stock_id):
    return StockPrice.query.filter(StockPrice.stock_id == stock_id).count()


def replace_prices_for_stock_id(stock_id, prices):
    logger.info("Replacing prices for stock id=%s rows=%s", stock_id, len(prices))
    StockPrice.query.filter(StockPrice.stock_id == stock_id).delete()
    for price in prices:
        db.session.add(
            StockPrice(
                stock_id=stock_id,
                date=price["date"],
                open=price["open"],
                high=price["high"],
                low=price["low"],
                close=price["close"],
                volume=price.get("volume") or 0,
            )
        )
    db.session.commit()
    return list_prices_for_stock_id(stock_id)


def upsert_prices_for_stock_id(stock_id, prices):
    logger.info("Upserting prices for stock id=%s rows=%s", stock_id, len(prices))
    if not prices:
        return list_prices_for_stock_id(stock_id)

    incoming_by_date = {price["date"]: price for price in prices}
    existing_prices = (
        StockPrice.query.filter(StockPrice.stock_id == stock_id)
        .filter(StockPrice.date.in_(list(incoming_by_date.keys())))
        .all()
    )
    existing_by_date = {price.date: price for price in existing_prices}

    for price_date, price in incoming_by_date.items():
        existing = existing_by_date.get(price_date)
        if existing:
            existing.open = price["open"]
            existing.high = price["high"]
            existing.low = price["low"]
            existing.close = price["close"]
            existing.volume = price.get("volume") or 0
            continue

        db.session.add(
            StockPrice(
                stock_id=stock_id,
                date=price_date,
                open=price["open"],
                high=price["high"],
                low=price["low"],
                close=price["close"],
                volume=price.get("volume") or 0,
            )
        )

    db.session.commit()
    return list_prices_for_stock_id(stock_id)


def delete_prices_for_stock_id(stock_id):
    logger.info("Deleting prices for stock id=%s", stock_id)
    deleted = StockPrice.query.filter(StockPrice.stock_id == stock_id).delete()
    db.session.commit()
    return deleted
