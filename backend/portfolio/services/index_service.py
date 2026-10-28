from portfolio.config.indices import DEFAULT_INDICES
from portfolio.core.logging import get_logger
from portfolio.data.repositories import stock_repository
from portfolio.services import stock_service

logger = get_logger(__name__)


def list_indices():
    """Return all market benchmark indices ordered by display_order."""
    indices = stock_repository.list_indices()
    symbols_in_db = {idx.symbol for idx in indices}
    missing_defaults = any(item["symbol"] not in symbols_in_db for item in DEFAULT_INDICES)
    if not indices or missing_defaults:
        indices = ensure_default_indices()
    return indices


def ensure_default_indices():
    """Ensure all default indices defined in config are seeded in the database."""
    logger.info("Ensuring default market indices exist")
    for item in DEFAULT_INDICES:
        symbol = item["symbol"]
        name = item.get("name")
        short_name = item.get("short_name")
        display_order = item.get("display_order")
        sector = item.get("sector", "Index")

        existing = stock_repository.get_stock_by_symbol(symbol)
        if not existing:
            try:
                logger.info("Seeding market index: %s (%s)", symbol, name)
                stock_service.add_stock(
                    symbol=symbol,
                    asset_type="index",
                    is_deletable=False,
                    display_order=display_order,
                    short_name=short_name,
                )
            except Exception as exc:
                logger.warning("Failed to fetch initial data for index %s: %s", symbol, exc)
                # Fallback: create basic record if yfinance fails offline
                stock_repository.create_stock(
                    symbol=symbol,
                    name=name,
                    sector=sector,
                    asset_type="index",
                    is_deletable=False,
                    display_order=display_order,
                    short_name=short_name,
                )
        else:
            # Update existing index fields
            updates = {
                "asset_type": "index",
                "is_deletable": False,
                "display_order": display_order,
                "short_name": short_name,
                "sector": sector,
            }
            if name and (existing.name == symbol or not existing.name):
                updates["name"] = name
            stock_repository.update_stock_metadata(existing, updates)

    return stock_repository.list_indices()


def refresh_index_quotes():
    """Refresh quotes for all registered market indices."""
    indices = list_indices()
    updated = []
    for idx in indices:
        try:
            stock = stock_service.refresh_stock_quote(idx.symbol)
            updated.append(stock)
        except Exception as exc:
            logger.warning("Failed to refresh quote for index %s: %s", idx.symbol, exc)
            updated.append(idx)
    return updated
