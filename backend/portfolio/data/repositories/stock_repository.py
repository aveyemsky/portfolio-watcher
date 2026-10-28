from portfolio.core.logging import get_logger
from portfolio.data.db import db
from portfolio.data.models import Stock

logger = get_logger(__name__)


DEFAULT_STOCKS = ["AAPL", "NVDA", "GOOG", "ASML", "AMD", "MSFT", "GS"]


def list_stocks(asset_type="stock"):
    logger.debug("Listing stocks asset_type=%s", asset_type)
    if asset_type == "index":
        return Stock.query.filter(Stock.asset_type == "index").order_by(Stock.display_order.asc(), Stock.symbol.asc()).all()

    # In tenant context, filter to stocks tracked or held by this tenant
    try:
        from portfolio.data.models import TrackedStock, Holding
        tracked = TrackedStock.query.all()
        tracked_symbols = [t.symbol for t in tracked]
        holding_tuples = Holding.query.with_entities(Holding.symbol).distinct().all()
        holding_symbols = [h[0] for h in holding_tuples]
        all_tenant_symbols = sorted(list(dict.fromkeys(tracked_symbols + holding_symbols)))

        if all_tenant_symbols:
            return Stock.query.filter(Stock.symbol.in_(all_tenant_symbols)).order_by(Stock.symbol.asc()).all()
        return Stock.query.filter(Stock.asset_type == "stock", Stock.symbol.in_(DEFAULT_STOCKS)).order_by(Stock.symbol.asc()).all()
    except Exception as exc:
        logger.debug("Tenant tracked stock query fallback: %s", exc)

    return Stock.query.filter(Stock.asset_type == "stock", Stock.symbol.in_(DEFAULT_STOCKS)).order_by(Stock.symbol.asc()).all()


def list_active_stocks():
    """Returns stocks that have at least 1 active subscriber or are market indices."""
    logger.debug("Listing active stocks and indices")
    return (
        Stock.query.filter(
            (Stock.subscriber_count > 0) | (Stock.asset_type == "index")
        )
        .order_by(Stock.symbol.asc())
        .all()
    )


def list_all_master_stocks(asset_type=None):
    """Return all stocks in the master stock table regardless of tenant session context."""
    logger.debug("Listing all master stocks asset_type=%s", asset_type)
    query = Stock.query
    if asset_type == "index":
        return query.filter(Stock.asset_type == "index").order_by(Stock.display_order.asc(), Stock.symbol.asc()).all()
    if asset_type:
        return query.filter(Stock.asset_type == asset_type).order_by(Stock.symbol.asc()).all()
    return query.order_by(Stock.symbol.asc()).all()


def list_indices():
    logger.debug("Listing indices")
    return Stock.query.filter(Stock.asset_type == "index").order_by(Stock.display_order.asc(), Stock.symbol.asc()).all()


def get_stock_by_symbol(symbol):
    logger.debug("Loading stock symbol=%s", symbol)
    return Stock.query.filter(Stock.symbol == symbol.upper()).first()


def get_stocks_by_symbols(symbols):
    """Retrieve multiple stocks by their symbols in a single query."""
    if not symbols:
        return []
    normalized = [str(s).upper() for s in symbols]
    return Stock.query.filter(Stock.symbol.in_(normalized)).order_by(Stock.symbol.asc()).all()


def get_stock_by_id(stock_id):
    logger.debug("Loading stock id=%s", stock_id)
    return Stock.query.get(stock_id)


def increment_subscriber_count(symbol):
    """Increment subscriber count when a user adds this stock to their portfolio."""
    stock = get_stock_by_symbol(symbol)
    if stock:
        stock.subscriber_count = (stock.subscriber_count or 0) + 1
        db.session.commit()
    return stock


def decrement_subscriber_count(symbol):
    """Decrement subscriber count when a user removes this stock from their portfolio."""
    stock = get_stock_by_symbol(symbol)
    if stock:
        stock.subscriber_count = max(0, (stock.subscriber_count or 1) - 1)
        db.session.commit()
    return stock


def create_stock(
    symbol,
    name,
    sector,
    exchange=None,
    currency=None,
    last_price=None,
    previous_close=None,
    market_cap=None,
    last_split_date=None,
    split_dirty=False,
    price_dirty=False,
    post_market_price=None,
    post_market_change=None,
    post_market_change_percent=None,
    pre_market_price=None,
    pre_market_change=None,
    pre_market_change_percent=None,
    day_open=None,
    day_high=None,
    day_low=None,
    asset_type="stock",
    is_deletable=True,
    display_order=None,
    short_name=None,
    subscriber_count=1,
):
    logger.info("Creating stock symbol=%s asset_type=%s", symbol, asset_type)
    stock = Stock(
        symbol=symbol.upper(),
        name=name,
        sector=sector,
        exchange=exchange,
        currency=currency,
        last_price=last_price,
        previous_close=previous_close,
        market_cap=market_cap,
        last_split_date=last_split_date,
        split_dirty=split_dirty,
        price_dirty=price_dirty,
        post_market_price=post_market_price,
        post_market_change=post_market_change,
        post_market_change_percent=post_market_change_percent,
        pre_market_price=pre_market_price,
        pre_market_change=pre_market_change,
        pre_market_change_percent=pre_market_change_percent,
        day_open=day_open,
        day_high=day_high,
        day_low=day_low,
        asset_type=asset_type,
        is_deletable=is_deletable,
        display_order=display_order,
        short_name=short_name,
        subscriber_count=subscriber_count,
    )
    db.session.add(stock)
    db.session.commit()
    return stock


def update_stock_metadata(stock, metadata, commit=True):
    logger.debug("Updating stock metadata symbol=%s", stock.symbol)
    nullable_fields = {
        "post_market_price",
        "post_market_change",
        "post_market_change_percent",
        "pre_market_price",
        "pre_market_change",
        "pre_market_change_percent",
        "day_open",
        "day_high",
        "day_low",
    }
    for field in (
        "name",
        "sector",
        "exchange",
        "currency",
        "last_price",
        "previous_close",
        "market_cap",
        "last_split_date",
        "split_dirty",
        "price_dirty",
        "post_market_price",
        "post_market_change",
        "post_market_change_percent",
        "pre_market_price",
        "pre_market_change",
        "pre_market_change_percent",
        "day_open",
        "day_high",
        "day_low",
        "asset_type",
        "is_deletable",
        "display_order",
        "short_name",
        "subscriber_count",
    ):
        if field in metadata and (metadata[field] is not None or field in nullable_fields):
            setattr(stock, field, metadata[field])
    if commit:
        db.session.commit()
    return stock


def delete_stock(stock):
    logger.info("Deleting stock symbol=%s", stock.symbol)
    db.session.delete(stock)
    db.session.commit()
