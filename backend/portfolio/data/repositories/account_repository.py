from portfolio.core.logging import get_logger
from portfolio.data.db import db
from portfolio.data.models import Holding
from portfolio.data.models import Account

logger = get_logger(__name__)


def list_accounts():
    logger.debug("Listing accounts")
    return Account.query.order_by(Account.sort_order.asc(), Account.id.asc()).all()


def get_account(account_id):
    logger.debug("Loading account id=%s", account_id)
    return db.session.get(Account, account_id)


def create_account(name, type="standard", category_id=None, sort_order=0):
    logger.info("Creating account name=%s category_id=%s", name, category_id)
    account = Account(
        name=name,
        type=type,
        category_id=category_id,
        sort_order=sort_order,
    )
    db.session.add(account)
    db.session.commit()
    return account


def update_account(account, payload):
    logger.info("Updating account id=%s", account.id)
    if "name" in payload:
        account.name = payload["name"]
    if "type" in payload:
        account.type = payload["type"]
    if "category_id" in payload:
        account.category_id = payload["category_id"]
    if "sort_order" in payload:
        account.sort_order = payload["sort_order"]
    if "sizing_mode" in payload or "sizingMode" in payload:
        account.sizing_mode = payload.get("sizing_mode", payload.get("sizingMode"))
    db.session.commit()
    return account


def delete_account(account):
    logger.info("Deleting account id=%s", account.id)
    db.session.delete(account)
    db.session.commit()


def count_holdings_for_account(account_id):
    logger.debug("Counting holdings for account id=%s", account_id)
    return Holding.query.filter(
        Holding.portfolio_id == account_id,
        Holding.is_section_header.is_(False),
    ).count()


def add_section_divider(account_id, section_label, sort_order=None):
    logger.info("Adding section divider to account id=%s label=%s", account_id, section_label)
    if sort_order is None:
        last_item = Holding.query.filter_by(portfolio_id=account_id).order_by(Holding.sort_order.desc()).first()
        sort_order = (last_item.sort_order + 1) if last_item else 0

    item = Holding(
        portfolio_id=account_id,
        symbol=None,
        shares=0.0,
        avg_cost=0.0,
        is_section_header=True,
        section_label=section_label,
        sort_order=sort_order,
    )
    db.session.add(item)
    db.session.commit()
    return item


def get_portfolio_item(item_id):
    return db.session.get(Holding, item_id)


def delete_portfolio_item(item):
    db.session.delete(item)
    db.session.commit()


def reorder_portfolio_items(account_id, item_orders):
    logger.info("Reordering portfolio items for account id=%s count=%s", account_id, len(item_orders))
    # item_orders: list of dicts like [{"id": 1, "sort_order": 0}, {"id": 2, "sort_order": 1}]
    items_by_id = {
        item.id: item
        for item in Holding.query.filter_by(portfolio_id=account_id).all()
    }
    updated = []
    for entry in item_orders:
        item_id = entry.get("id")
        sort_order = entry.get("sort_order", entry.get("sortOrder", 0))
        if item_id in items_by_id:
            items_by_id[item_id].sort_order = int(sort_order)
            updated.append(items_by_id[item_id])

    db.session.commit()
    return Holding.query.filter_by(portfolio_id=account_id).order_by(Holding.sort_order.asc(), Holding.id.asc()).all()

