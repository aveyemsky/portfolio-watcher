from datetime import datetime

from portfolio.core.logging import get_logger
from portfolio.data.repositories import price_repository
from portfolio.services import stock_service
from portfolio.services.stock_data_service import MARKET_TIMEZONE

logger = get_logger(__name__)


def get_stock_prices(symbol):
    prices = price_repository.list_prices_for_symbol(symbol)

    # Auto-heal missing prices if empty or if historical prices are missing recent trading days
    needs_sync = False
    if not prices:
        needs_sync = True
    elif len(prices) > 0:
        today_et = datetime.now(MARKET_TIMEZONE).date()
        latest_date = prices[-1].date
        # On weekdays (Mon-Fri), if latest date in DB is older than yesterday, auto-sync
        if today_et.weekday() < 5 and (today_et - latest_date).days >= 2:
            needs_sync = True

    if needs_sync:
        try:
            sync_res = stock_service.sync_stock_prices(symbol)
            if sync_res and sync_res.get("prices"):
                return sync_res["prices"]
        except Exception as exc:
            logger.warning("On-demand chart price sync failed for %s: %s", symbol, exc)

    return prices


def sync_stock_prices(symbol):
    return stock_service.sync_stock_prices(symbol)

