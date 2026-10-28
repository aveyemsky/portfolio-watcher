from portfolio.core.logging import get_logger
from portfolio.data.db import db
from portfolio.data.models import Portfolio, PortfolioCategory

logger = get_logger(__name__)


def list_categories():
    logger.debug("Listing portfolio categories")
    return PortfolioCategory.query.order_by(
        PortfolioCategory.sort_order.asc(),
        PortfolioCategory.id.asc(),
    ).all()


def get_category(category_id):
    logger.debug("Loading category id=%s", category_id)
    return db.session.get(PortfolioCategory, category_id)


def create_category(name, sort_order=0, is_default=False):
    logger.info("Creating category name=%s", name)
    category = PortfolioCategory(
        name=name,
        sort_order=sort_order,
        is_default=is_default,
    )
    db.session.add(category)
    db.session.commit()
    return category


def update_category(category, payload):
    logger.info("Updating category id=%s", category.id)
    if "name" in payload and payload["name"] is not None:
        category.name = payload["name"]
    if "sort_order" in payload and payload["sort_order"] is not None:
        category.sort_order = payload["sort_order"]
    db.session.commit()
    return category


def delete_category(category, delete_portfolios=False):
    logger.info("Deleting category id=%s delete_portfolios=%s", category.id, delete_portfolios)
    child_portfolios = Portfolio.query.filter(Portfolio.category_id == category.id).all()
    if delete_portfolios:
        for p in child_portfolios:
            db.session.delete(p)
    else:
        for p in child_portfolios:
            p.category_id = None

    db.session.delete(category)
    db.session.commit()
