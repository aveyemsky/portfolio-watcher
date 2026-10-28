"""Market scheduler service for automated post-market EOD sync.

Runs 45 minutes after market close (16:45 America/New_York, Mon-Fri)
to fetch confirmed daily closing candles for all tracked stocks and indices.
Supports pluggable post-market hooks so host platforms (e.g. Foliowatcher)
can trigger quant evaluations or cache warming once prices are settled.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from datetime import datetime, time as dt_time, timedelta
from typing import Callable

from portfolio.core.logging import get_logger
from portfolio.services.stock_data_service import MARKET_TIMEZONE

logger = get_logger(__name__)

# Post-market sync time: 16:45 ET (45 minutes after 16:00 ET market close)
DEFAULT_SYNC_HOUR = 16
DEFAULT_SYNC_MINUTE = 45

_scheduler_thread: threading.Thread | None = None
_stop_event = threading.Event()
_post_market_hooks: list[Callable[[str], None]] = []
_scheduler_state = {
    "last_synced_date": None,
    "last_sync_time": None,
    "last_status": "idle",
    "is_running": False,
}
_SHARED_STATE_FILE = os.path.join(tempfile.gettempdir(), "fowa_market_scheduler_state.json")


def _load_shared_scheduler_state() -> dict:
    if "pytest" in sys.modules:
        return dict(_scheduler_state)
    try:
        if os.path.exists(_SHARED_STATE_FILE):
            with open(_SHARED_STATE_FILE, "r", encoding="utf-8") as fh:
                data = json.load(fh)
                if isinstance(data, dict):
                    merged = dict(_scheduler_state)
                    merged.update(data)
                    merged["is_running"] = _scheduler_state["is_running"] or bool(data.get("is_running"))
                    return merged
    except Exception:
        pass
    return dict(_scheduler_state)


def _save_shared_scheduler_state() -> None:
    if "pytest" in sys.modules:
        return
    try:
        tmp_path = f"{_SHARED_STATE_FILE}.{os.getpid()}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as fh:
            json.dump(_scheduler_state, fh)
        os.replace(tmp_path, _SHARED_STATE_FILE)
    except Exception:
        pass


def register_post_market_hook(callback: Callable[[str], None]) -> None:
    """Register a callback to run after the post-market sync completes."""
    if callback not in _post_market_hooks:
        _post_market_hooks.append(callback)


def get_next_scheduled_sync(now: datetime | None = None) -> datetime:
    """Compute the next scheduled 16:45 ET sync datetime (Mon-Fri)."""
    if now is None:
        now = datetime.now(MARKET_TIMEZONE)
    target_today = now.replace(
        hour=DEFAULT_SYNC_HOUR,
        minute=DEFAULT_SYNC_MINUTE,
        second=0,
        microsecond=0,
    )

    # If it's a weekday and before 16:45 ET today, target is today
    if now.weekday() < 5 and now < target_today:
        return target_today

    # Otherwise look for the next weekday
    candidate = now + timedelta(days=1)
    while candidate.weekday() >= 5:  # Skip Saturday (5) and Sunday (6)
        candidate += timedelta(days=1)

    return candidate.replace(
        hour=DEFAULT_SYNC_HOUR,
        minute=DEFAULT_SYNC_MINUTE,
        second=0,
        microsecond=0,
    )


def execute_post_market_sync(app=None, force: bool = False) -> dict:
    """Execute the end-of-day price sync and fire registered extension hooks."""
    from portfolio.services.stock_service import sync_all_stocks

    now_et = datetime.now(MARKET_TIMEZONE)
    today_str = now_et.strftime("%Y-%m-%d")

    shared = _load_shared_scheduler_state()
    if not force and (
        _scheduler_state["last_synced_date"] == today_str
        or shared.get("last_synced_date") == today_str
        or shared.get("syncing_date") == today_str
    ):
        logger.debug("Post-market sync already executed for %s", today_str)
        return {"status": "skipped", "date": today_str, "reason": "already_synced"}

    logger.info("Starting automated post-market sync for %s...", today_str)
    _scheduler_state["last_status"] = "syncing"
    _scheduler_state["syncing_date"] = today_str
    _save_shared_scheduler_state()

    def _run_sync():
        try:
            return sync_all_stocks(max_duration_seconds=600, all_master=True)
        except TypeError:
            return sync_all_stocks()

    sync_result = {}
    try:
        if app:
            with app.app_context():
                sync_result = _run_sync()
        else:
            sync_result = _run_sync()

        _scheduler_state["last_synced_date"] = today_str
        _scheduler_state["last_sync_time"] = now_et.isoformat()
        _scheduler_state["last_status"] = "success"
        _scheduler_state.pop("syncing_date", None)
        _save_shared_scheduler_state()
        logger.info(
            "Post-market sync completed for %s: %d synced, %d failed",
            today_str,
            len(sync_result.get("synced", [])),
            len(sync_result.get("failed", [])),
        )

        # Execute registered host hooks (e.g. Foliowatcher quant cache warming)
        for hook in list(_post_market_hooks):
            try:
                if app:
                    with app.app_context():
                        hook(today_str)
                else:
                    hook(today_str)
            except Exception as hook_err:
                logger.error("Error executing post-market hook %s: %s", hook, hook_err)

    except Exception as exc:
        _scheduler_state["last_status"] = f"error: {exc}"
        _scheduler_state.pop("syncing_date", None)
        _save_shared_scheduler_state()
        logger.error("Post-market sync failed for %s: %s", today_str, exc)
        return {"status": "error", "date": today_str, "error": str(exc)}

    return {
        "status": "success",
        "date": today_str,
        "synced": sync_result.get("synced", []),
        "failed": sync_result.get("failed", []),
    }


def _scheduler_loop(app, check_interval_seconds: int = 30):
    """Background polling loop that checks the clock and triggers at 16:45 ET."""
    logger.info("Market scheduler loop started (check interval: %ds)", check_interval_seconds)
    while not _stop_event.is_set():
        try:
            now_et = datetime.now(MARKET_TIMEZONE)
            is_weekday = now_et.weekday() < 5
            is_post_sync_time = (
                now_et.hour > DEFAULT_SYNC_HOUR
                or (now_et.hour == DEFAULT_SYNC_HOUR and now_et.minute >= DEFAULT_SYNC_MINUTE)
            )
            today_str = now_et.strftime("%Y-%m-%d")

            if is_weekday and is_post_sync_time:
                shared = _load_shared_scheduler_state()
                if (
                    _scheduler_state["last_synced_date"] != today_str
                    and shared.get("last_synced_date") != today_str
                    and shared.get("syncing_date") != today_str
                ):
                    execute_post_market_sync(app=app, force=False)

        except Exception as loop_err:
            logger.error("Unexpected error in market scheduler loop: %s", loop_err)

        _stop_event.wait(check_interval_seconds)


def start_market_scheduler(app=None, check_interval_seconds: int = 30) -> None:
    """Start the market scheduler daemon thread if not already running."""
    global _scheduler_thread
    if _scheduler_thread is not None and _scheduler_thread.is_alive():
        logger.debug("Market scheduler is already running")
        return

    _stop_event.clear()
    _scheduler_state["is_running"] = True
    _save_shared_scheduler_state()
    _scheduler_thread = threading.Thread(
        target=_scheduler_loop,
        args=(app, check_interval_seconds),
        name="MarketSchedulerThread",
        daemon=True,
    )
    _scheduler_thread.start()
    logger.info("Market scheduler started successfully")


def stop_market_scheduler() -> None:
    """Stop the market scheduler daemon thread."""
    _stop_event.set()
    _scheduler_state["is_running"] = False
    _save_shared_scheduler_state()
    logger.info("Market scheduler stopping...")


def get_scheduler_status() -> dict:
    """Return the current scheduler state and next run target."""
    now_et = datetime.now(MARKET_TIMEZONE)
    next_sync = get_next_scheduled_sync(now_et)
    state = _load_shared_scheduler_state()
    return {
        "isRunning": state["is_running"],
        "lastSyncedDate": state["last_synced_date"],
        "lastSyncTime": state["last_sync_time"],
        "lastStatus": state["last_status"],
        "nextScheduledSync": next_sync.strftime("%Y-%m-%d %H:%M:%S %Z"),
    }
