from datetime import datetime
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from portfolio.services.market_scheduler import (
    DEFAULT_SYNC_HOUR,
    DEFAULT_SYNC_MINUTE,
    execute_post_market_sync,
    get_next_scheduled_sync,
    get_scheduler_status,
    register_post_market_hook,
    start_market_scheduler,
    stop_market_scheduler,
)

MARKET_TZ = ZoneInfo("America/New_York")


def test_get_next_scheduled_sync_same_day():
    # Thursday at 10:00 AM ET -> should be Thursday 16:45 ET
    now = datetime(2026, 10, 1, 10, 0, 0, tzinfo=MARKET_TZ)
    target = get_next_scheduled_sync(now)
    assert target.year == 2026
    assert target.month == 10
    assert target.day == 1
    assert target.hour == DEFAULT_SYNC_HOUR
    assert target.minute == DEFAULT_SYNC_MINUTE


def test_get_next_scheduled_sync_after_close():
    # Thursday at 18:00 ET -> should be Friday 16:45 ET
    now = datetime(2026, 10, 1, 18, 0, 0, tzinfo=MARKET_TZ)
    target = get_next_scheduled_sync(now)
    assert target.day == 2
    assert target.hour == DEFAULT_SYNC_HOUR
    assert target.minute == DEFAULT_SYNC_MINUTE


def test_get_next_scheduled_sync_skips_weekend():
    # Friday at 19:00 ET -> should skip Sat & Sun, returning Monday Oct 5 at 16:45 ET
    now = datetime(2026, 10, 2, 19, 0, 0, tzinfo=MARKET_TZ)
    target = get_next_scheduled_sync(now)
    assert target.day == 5  # Monday
    assert target.weekday() == 0  # Monday


@patch("portfolio.services.stock_service.sync_all_stocks")
def test_execute_post_market_sync_invokes_hook(mock_sync):
    mock_sync.return_value = {"synced": ["AAPL", "NVDA"], "failed": []}
    mock_hook = MagicMock()
    register_post_market_hook(mock_hook)

    res = execute_post_market_sync(app=None, force=True)
    assert res["status"] == "success"
    assert "AAPL" in res["synced"]
    mock_hook.assert_called_once()


def test_scheduler_lifecycle():
    start_market_scheduler(app=None, check_interval_seconds=60)
    status = get_scheduler_status()
    assert status["isRunning"] is True
    assert "nextScheduledSync" in status

    stop_market_scheduler()
    status_stopped = get_scheduler_status()
    assert status_stopped["isRunning"] is False
