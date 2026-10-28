from portfolio.core.logging import get_logger
from portfolio.data.db import db
from portfolio.data.models import Holding

logger = get_logger(__name__)


def list_holdings_for_account(account_id):
    logger.debug("Listing holdings for account id=%s", account_id)
    return (
        Holding.query
        .filter(Holding.portfolio_id == account_id)
        .order_by(Holding.sort_order.asc(), Holding.id.asc())
        .all()
    )


def list_all_holdings():
    logger.debug("Listing all holdings across accounts")
    return (
        Holding.query
        .order_by(Holding.portfolio_id.asc(), Holding.sort_order.asc(), Holding.id.asc())
        .all()
    )


def get_holding(account_id, symbol):
    logger.debug("Loading holding account_id=%s symbol=%s", account_id, symbol)
    return (
        Holding.query
        .filter_by(portfolio_id=account_id, symbol=str(symbol).upper(), is_section_header=False)
        .first()
    )


def get_holding_by_account_and_symbol(account_id, symbol):
    return get_holding(account_id, symbol)


def create_holding(account_id, symbol, shares, avg_cost, sort_order=None, weight_pct=None):
    logger.info("Creating holding account_id=%s symbol=%s", account_id, symbol)
    if sort_order is None:
        last_item = Holding.query.filter_by(portfolio_id=account_id).order_by(Holding.sort_order.desc()).first()
        sort_order = (last_item.sort_order + 1) if last_item else 0

    holding = Holding(
        portfolio_id=account_id,
        symbol=symbol.upper(),
        shares=shares,
        avg_cost=avg_cost,
        weight_pct=weight_pct,
        is_section_header=False,
        sort_order=sort_order,
    )
    db.session.add(holding)
    db.session.commit()
    return holding


def update_holding(holding, payload):
    logger.info("Updating holding id=%s", holding.id)
    if "shares" in payload and payload["shares"] is not None:
        holding.shares = float(payload["shares"])
    if "avg_cost" in payload and payload["avg_cost"] is not None:
        holding.avg_cost = float(payload["avg_cost"])
    elif "avgCost" in payload and payload["avgCost"] is not None:
        holding.avg_cost = float(payload["avgCost"])
    elif "average_cost" in payload and payload["average_cost"] is not None:
        holding.avg_cost = float(payload["average_cost"])
    if "weight_pct" in payload:
        val = payload["weight_pct"]
        holding.weight_pct = float(val) if val is not None and str(val).strip() != "" else None
    elif "weightPct" in payload:
        val = payload["weightPct"]
        holding.weight_pct = float(val) if val is not None and str(val).strip() != "" else None
    if "sort_order" in payload or "sortOrder" in payload:
        holding.sort_order = int(payload.get("sort_order", payload.get("sortOrder", holding.sort_order)))
    db.session.commit()
    return holding


def delete_holding(holding):
    logger.info("Deleting holding id=%s", holding.id)
    db.session.delete(holding)
    db.session.commit()


def count_holdings_for_account(account_id):
    logger.debug("Counting holdings for account id=%s", account_id)
    return Holding.query.filter(Holding.account_id == account_id).count()


def count_holdings_for_symbol(symbol):
    logger.debug("Counting holdings for symbol=%s", symbol)
    return Holding.query.filter(Holding.symbol == symbol.upper()).count()


def count_holdings_for_stock(stock_id_or_symbol):
    """Backward compatibility helper."""
    logger.debug("Counting holdings for stock=%s", stock_id_or_symbol)
    if isinstance(stock_id_or_symbol, str):
        return count_holdings_for_symbol(stock_id_or_symbol)
    return 0
