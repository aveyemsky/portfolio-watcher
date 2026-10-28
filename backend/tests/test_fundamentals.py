import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pandas as pd
from flask import Flask
from sqlalchemy import create_engine, inspect

from portfolio.api.routes import portfolio_api
from portfolio.data.init_db import _ensure_fundamentals_schema
from portfolio.services.fundamental_service import (
    FundamentalQueueManager,
    FundamentalService,
)


class FakeTicker:
    def __init__(self, calendar=None, earnings_df=None, dividends=None, info=None):
        self.calendar = calendar
        self._earnings_df = earnings_df
        self.dividends = dividends
        self.info = info or {}

    def get_earnings_dates(self, limit=8):
        return self._earnings_df


class TestFundamentalsEngine(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_fundamentals.db"
        self.engine = create_engine(f"sqlite:///{self.db_path}")
        _ensure_fundamentals_schema(self.engine)

    def tearDown(self):
        self.engine.dispose()
        self.temp_dir.cleanup()

    def test_ensure_fundamentals_schema_creates_tables_non_destructively(self):
        # Create an existing dummy user table to verify non-destructive migration
        with self.engine.begin() as conn:
            conn.exec_driver_sql("CREATE TABLE user_accounts_check (id INTEGER PRIMARY KEY, name TEXT)")
            conn.exec_driver_sql("INSERT INTO user_accounts_check (name) VALUES ('Core Portfolio')")

        # Re-run schema migration
        _ensure_fundamentals_schema(self.engine)

        inspector = inspect(self.engine)
        tables = set(inspector.get_table_names())
        self.assertIn("stock_fundamentals", tables)
        self.assertIn("stock_earnings_history", tables)
        self.assertIn("stock_dividend_history", tables)
        self.assertIn("user_accounts_check", tables)

        with self.engine.connect() as conn:
            row = conn.exec_driver_sql("SELECT name FROM user_accounts_check").fetchone()
            self.assertEqual(row[0], "Core Portfolio")

    @patch("portfolio.services.fundamental_service.yf.Ticker")
    def test_fetch_and_store_fundamentals_dividend_payer_and_ttl_cache(self, mock_ticker_cls):
        earnings_index = pd.to_datetime(["2026-08-01", "2026-05-02"])
        earnings_df = pd.DataFrame(
            {
                "EPS Estimate": [1.35, 1.30],
                "Reported EPS": [1.40, 1.25],
                "Surprise(%)": [3.70, -3.85],
            },
            index=earnings_index,
        )
        div_index = pd.to_datetime(["2026-05-10", "2026-08-10"])
        dividends_series = pd.Series([0.24, 0.25], index=div_index)

        mock_ticker_cls.return_value = FakeTicker(
            calendar={
                "Earnings Date": [datetime(2026, 10, 29).date()],
                "Earnings Average": 1.62,
                "Ex-Dividend Date": datetime(2026, 11, 8).date(),
            },
            earnings_df=earnings_df,
            dividends=dividends_series,
            info={
                "dividendRate": 1.00,
                "dividendYield": 0.0052,
                "payoutRatio": 0.152,
                "exDividendDate": "2026-11-08",
                "fiveYearAvgDividendYield": 0.58,
            },
        )

        payload = FundamentalService.fetch_and_store_fundamentals("AAPL", conn=self.engine)
        self.assertEqual(payload["symbol"], "AAPL")
        self.assertEqual(payload["calendar"]["next_earnings_date"], "2026-10-29")
        self.assertAlmostEqual(payload["calendar"]["earnings_avg_est"], 1.62, places=2)
        self.assertEqual(payload["calendar"]["ex_dividend_date"], "2026-11-08")

        snap = payload["dividend_snapshot"]
        self.assertAlmostEqual(snap["annual_rate"], 1.00, places=2)
        self.assertAlmostEqual(snap["yield_pct"], 0.52, places=2)
        self.assertAlmostEqual(snap["payout_ratio_pct"], 15.2, places=1)
        self.assertAlmostEqual(snap["five_year_avg_yield"], 0.58, places=2)

        self.assertEqual(len(payload["earnings_history"]), 2)
        self.assertEqual(payload["earnings_history"][0]["date"], "2026-08-01")
        self.assertAlmostEqual(payload["earnings_history"][0]["eps_reported"], 1.40, places=2)
        self.assertAlmostEqual(payload["earnings_history"][0]["eps_estimate"], 1.35, places=2)
        self.assertAlmostEqual(payload["earnings_history"][0]["surprise_pct"], 3.70, places=2)

        self.assertEqual(len(payload["dividend_history"]), 2)
        self.assertEqual(payload["dividend_history"][0]["date"], "2026-08-10")
        self.assertAlmostEqual(payload["dividend_history"][0]["amount"], 0.25, places=2)
        self.assertEqual(mock_ticker_cls.call_count, 1)

        # Second call within 12h TTL should skip network fetch
        cached_payload = FundamentalService.fetch_and_store_fundamentals("AAPL", conn=self.engine)
        self.assertEqual(mock_ticker_cls.call_count, 1)
        self.assertEqual(cached_payload["calendar"]["next_earnings_date"], "2026-10-29")

    @patch("portfolio.services.fundamental_service.yf.Ticker")
    def test_fetch_and_store_non_dividend_stock_fallback(self, mock_ticker_cls):
        earnings_index = pd.to_datetime(["2026-07-22"])
        earnings_df = pd.DataFrame(
            {
                "EPS Estimate": [0.60],
                "Reported EPS": [0.52],
                "Surprise(%)": [-13.33],
            },
            index=earnings_index,
        )
        mock_ticker_cls.return_value = FakeTicker(
            calendar={
                "Earnings Date": [datetime(2026, 10, 21).date()],
                "Earnings Average": 0.65,
            },
            earnings_df=earnings_df,
            dividends=pd.Series([], dtype=float),
            info={
                "dividendRate": None,
                "dividendYield": None,
                "payoutRatio": 0.0,
            },
        )

        payload = FundamentalService.fetch_and_store_fundamentals("TSLA", conn=self.engine)
        self.assertEqual(payload["symbol"], "TSLA")
        self.assertEqual(payload["calendar"]["next_earnings_date"], "2026-10-21")
        self.assertIsNone(payload["calendar"]["ex_dividend_date"])
        self.assertEqual(payload["dividend_snapshot"]["annual_rate"], 0.0)
        self.assertEqual(payload["dividend_snapshot"]["yield_pct"], 0.0)
        self.assertEqual(payload["dividend_history"], [])
        self.assertEqual(len(payload["earnings_history"]), 1)

    @patch("portfolio.services.fundamental_service.FundamentalService.get_fundamentals")
    def test_get_stock_fundamentals_api_endpoint(self, mock_get_fundamentals):
        mock_get_fundamentals.return_value = {
            "symbol": "AAPL",
            "calendar": {
                "next_earnings_date": "2026-10-29",
                "earnings_avg_est": 1.62,
                "ex_dividend_date": "2026-11-08",
            },
            "dividend_snapshot": {
                "annual_rate": 1.00,
                "yield_pct": 0.52,
                "payout_ratio_pct": 15.2,
                "five_year_avg_yield": 0.58,
            },
            "earnings_history": [
                {"date": "2026-08-01", "eps_reported": 1.40, "eps_estimate": 1.35, "surprise_pct": 3.7}
            ],
            "dividend_history": [
                {"date": "2026-08-10", "amount": 0.25}
            ],
        }

        app = Flask(__name__)
        app.register_blueprint(portfolio_api, url_prefix="/api")
        client = app.test_client()

        resp = client.get("/api/stocks/aapl/fundamentals")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertEqual(data["symbol"], "AAPL")
        self.assertEqual(data["calendar"]["next_earnings_date"], "2026-10-29")
        self.assertEqual(data["dividend_snapshot"]["yield_pct"], 0.52)
        mock_get_fundamentals.assert_called_once_with(
            "aapl",
            conn=None,
            refresh=False,
            priority=FundamentalQueueManager.PRIORITY_HIGH,
        )

    @patch("portfolio.services.fundamental_service.fundamental_queue_manager.enqueue")
    def test_stale_while_revalidate_non_blocking_under_15ms_and_10_stocks_burst(self, mock_enqueue):
        import time

        app = Flask(__name__)
        app.register_blueprint(portfolio_api, url_prefix="/api")
        client = app.test_client()

        # Seed 1 fresh stock (<12h) and 1 stale stock (>12h)
        now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        stale_str = (datetime.utcnow() - timedelta(hours=14)).strftime("%Y-%m-%d %H:%M:%S")
        with self.engine.begin() as conn:
            conn.exec_driver_sql(
                """
                INSERT INTO stock_fundamentals (symbol, next_earnings_date, dividend_rate, dividend_yield, updated_at)
                VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)
                """,
                (
                    "AAPL", "2026-10-29", 1.00, 0.0052, now_str,
                    "MSFT", "2026-10-28", 3.00, 0.0072, stale_str,
                ),
            )

        with patch("portfolio.services.fundamental_service.db") as mock_db:
            mock_db.engines = {"master": self.engine}
            mock_db.engine = self.engine

            # 1. Fresh record (< 12h): returns immediately in < 15ms without enqueueing
            t0 = time.perf_counter()
            r_fresh = client.get("/api/stocks/AAPL/fundamentals")
            elapsed_fresh_ms = (time.perf_counter() - t0) * 1000.0
            self.assertEqual(r_fresh.status_code, 200)
            self.assertLess(elapsed_fresh_ms, 15.0)
            self.assertEqual(r_fresh.get_json()["calendar"]["next_earnings_date"], "2026-10-29")
            mock_enqueue.assert_not_called()

            # 2. Stale record (> 12h): returns existing DB row immediately in < 15ms and enqueues at Priority 1
            t1 = time.perf_counter()
            r_stale = client.get("/api/stocks/MSFT/fundamentals")
            elapsed_stale_ms = (time.perf_counter() - t1) * 1000.0
            self.assertEqual(r_stale.status_code, 200)
            self.assertLess(elapsed_stale_ms, 15.0)
            self.assertEqual(r_stale.get_json()["calendar"]["next_earnings_date"], "2026-10-28")
            mock_enqueue.assert_called_once_with(
                "MSFT",
                priority=FundamentalQueueManager.PRIORITY_HIGH,
                conn=self.engine,
                force=False,
            )

            # 3. Requesting 10 brand-new stocks in rapid succession: each returns pending_sync in < 15ms
            mock_enqueue.reset_mock()
            burst_symbols = ["NVDA", "META", "AMZN", "GOOGL", "NFLX", "AMD", "AVGO", "CRM", "ORCL", "COST"]
            for sym in burst_symbols:
                t_start = time.perf_counter()
                resp = client.get(f"/api/stocks/{sym}/fundamentals")
                elapsed_ms = (time.perf_counter() - t_start) * 1000.0
                self.assertEqual(resp.status_code, 200)
                self.assertLess(elapsed_ms, 15.0)
                payload = resp.get_json()
                self.assertEqual(payload["symbol"], sym)
                self.assertEqual(payload["status"], "pending_sync")

            self.assertEqual(mock_enqueue.call_count, 10)
            for call_args in mock_enqueue.call_args_list:
                self.assertEqual(call_args.kwargs["priority"], FundamentalQueueManager.PRIORITY_HIGH)

    @patch("portfolio.services.fundamental_service.time.sleep")
    @patch("portfolio.services.fundamental_service.yf.Ticker")
    def test_queue_manager_priority_tiers_pacing_and_429_backoff(self, mock_ticker_cls, mock_sleep):
        mgr = FundamentalQueueManager(
            min_delay=0.6,
            max_delay=1.2,
            backoff_seconds=60.0,
            max_retries=2,
            auto_start=False,
        )

        processed_order = []

        def fake_ticker_factory(sym):
            processed_order.append(sym)
            return FakeTicker(
                calendar={"Earnings Date": [datetime(2026, 11, 1).date()]},
                info={"dividendRate": 0.0},
            )

        mock_ticker_cls.side_effect = fake_ticker_factory

        # Enqueue in reverse priority order: Priority 3 (Watchlist), Priority 2 (Holding), Priority 1 (Active Chart)
        mgr.enqueue("WMT", priority=FundamentalQueueManager.PRIORITY_LOW, conn=self.engine)
        mgr.enqueue("JPM", priority=FundamentalQueueManager.PRIORITY_MEDIUM, conn=self.engine)
        mgr.enqueue("NVDA", priority=FundamentalQueueManager.PRIORITY_HIGH, conn=self.engine)

        self.assertEqual(mgr.process_one(), "NVDA")
        self.assertEqual(mgr.process_one(), "JPM")
        self.assertEqual(mgr.process_one(), "WMT")
        self.assertEqual(processed_order, ["NVDA", "JPM", "WMT"])

        # Verify pacing sleep between 0.6s and 1.2s was applied for each call
        self.assertEqual(mock_sleep.call_count, 3)
        for call_arg in mock_sleep.call_args_list:
            delay_val = call_arg.args[0]
            self.assertGreaterEqual(delay_val, 0.6)
            self.assertLessEqual(delay_val, 1.2)

        # Verify HTTP 429 rate-limit triggers 60-second backoff and re-queues ticker
        mock_sleep.reset_mock()
        call_counter = {"count": 0}

        def rate_limited_then_ok(sym):
            call_counter["count"] += 1
            if call_counter["count"] == 1:
                raise RuntimeError("HTTP Error 429: Too Many Requests")
            return FakeTicker(
                calendar={"Earnings Date": [datetime(2026, 11, 15).date()]},
                info={"dividendRate": 1.2},
            )

        mock_ticker_cls.side_effect = rate_limited_then_ok
        mgr.enqueue("META", priority=FundamentalQueueManager.PRIORITY_HIGH, conn=self.engine, force=True)

        # First attempt hits 429 -> sleeps pacing + 60s backoff, and re-enqueues META
        mgr.process_one()
        sleep_values = [c.args[0] for c in mock_sleep.call_args_list]
        self.assertIn(60.0, sleep_values)

        # Second attempt succeeds and stores in DB
        mgr.process_one()
        stored = FundamentalService.get_fundamentals_from_db("META", conn=self.engine)
        self.assertEqual(stored["calendar"]["next_earnings_date"], "2026-11-15")

    @patch("portfolio.services.fundamental_service.yf.Ticker")
    def test_supplements_stale_get_earnings_dates_with_quote_summary_earnings_chart(self, mock_ticker_cls):
        """When get_earnings_dates stops in early 2025 (like ISRG), quoteSummary earningsChart fills 2025-2026 & same-day actuals."""
        earnings_index = pd.to_datetime(["2025-04-22", "2025-01-23"])
        earnings_df = pd.DataFrame(
            {
                "EPS Estimate": [1.72, 1.79],
                "Reported EPS": [1.81, 2.21],
                "Surprise(%)": [5.11, 23.19],
            },
            index=earnings_index,
        )
        fake_tkr = FakeTicker(
            calendar={
                "Earnings Date": [datetime(2026, 10, 20).date()],
                "Earnings Average": 2.64,
            },
            earnings_df=earnings_df,
            dividends=pd.Series([], dtype=float),
            info={"dividendRate": None, "dividendYield": 0.0},
        )
        fake_quote = MagicMock()
        fake_quote._fetch.return_value = {
            "quoteSummary": {
                "result": [
                    {
                        "calendarEvents": {
                            "earnings": {
                                "earningsDate": [1792526400],  # 2026-10-20
                                "earningsAverage": 2.64065,
                            }
                        },
                        "earnings": {
                            "earningsChart": {
                                "currentCalendarQuarter": "3Q2026",
                                "currentQuarterActual": 3.0,
                                "currentQuarterEstimate": 2.64065,
                                "quarterly": [
                                    {
                                        "calendarQuarter": "3Q2025",
                                        "reportedDate": 1761077100,  # 2025-10-21
                                        "actual": 2.40,
                                        "estimate": 1.99,
                                        "surprisePct": "20.7",
                                    },
                                    {
                                        "calendarQuarter": "4Q2025",
                                        "reportedDate": 1769115912,  # 2026-01-22
                                        "actual": 2.53,
                                        "estimate": 2.27,
                                        "surprisePct": "11.57",
                                    },
                                    {
                                        "calendarQuarter": "1Q2026",
                                        "reportedDate": 1776802176,  # 2026-04-21
                                        "actual": 2.50,
                                        "estimate": 2.11,
                                        "surprisePct": "18.67",
                                    },
                                    {
                                        "calendarQuarter": "2Q2026",
                                        "reportedDate": 1784232300,  # 2026-07-16
                                        "actual": 2.80,
                                        "estimate": 2.50,
                                        "surprisePct": "11.86",
                                    },
                                ],
                            }
                        },
                    }
                ]
            }
        }
        fake_tkr._quote = fake_quote
        mock_ticker_cls.return_value = fake_tkr

        payload = FundamentalService.fetch_and_store_fundamentals("ISRG", conn=self.engine)
        self.assertEqual(payload["symbol"], "ISRG")
        dates = [r["date"] for r in payload["earnings_history"]]
        self.assertEqual(
            dates,
            [
                "2026-10-20",
                "2026-07-16",
                "2026-04-21",
                "2026-01-22",
                "2025-10-21",
                "2025-04-22",
                "2025-01-23",
            ],
        )
        self.assertAlmostEqual(payload["earnings_history"][0]["eps_reported"], 3.0, places=2)
        self.assertAlmostEqual(payload["earnings_history"][0]["eps_estimate"], 2.64, places=2)
        self.assertAlmostEqual(payload["earnings_history"][0]["surprise_pct"], 13.61, places=2)


if __name__ == "__main__":
    unittest.main()
