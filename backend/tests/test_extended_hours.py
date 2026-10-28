import unittest
from datetime import datetime
from zoneinfo import ZoneInfo

from portfolio.api.serializers import serialize_stock
from portfolio.data.models import Stock
from portfolio.services.stock_data_service import _extract_extended_hours_data, get_market_session


class TestExtendedHoursExtraction(unittest.TestCase):
    def test_extract_valid_post_market(self):
        info = {
            "regularMarketPrice": 220.0,
            "regularMarketTime": 1700000000,
            "postMarketPrice": 222.5,
            "postMarketChange": 2.5,
            "postMarketChangePercent": 1.1364,
            "postMarketTime": 1700003600,  # Later than regularMarketTime
        }
        res = _extract_extended_hours_data(info, last_price=220.0, previous_close=218.0)
        self.assertEqual(res["post_market_price"], 222.5)
        self.assertEqual(res["post_market_change"], 2.5)
        self.assertEqual(res["post_market_change_percent"], 1.1364)

    def test_stale_post_market_ignored(self):
        info = {
            "regularMarketPrice": 225.0,
            "regularMarketTime": 1700086400,  # Today's regular close
            "postMarketPrice": 222.5,
            "postMarketTime": 1700003600,  # Yesterday's post-market (older)
        }
        res = _extract_extended_hours_data(info, last_price=225.0, previous_close=220.0)
        self.assertIsNone(res["post_market_price"])
        self.assertIsNone(res["post_market_change"])
        self.assertIsNone(res["post_market_change_percent"])

    def test_post_market_missing_change_calculated(self):
        info = {
            "regularMarketPrice": 200.0,
            "regularMarketTime": 1700000000,
            "postMarketPrice": 210.0,
            "postMarketTime": 1700003600,
        }
        res = _extract_extended_hours_data(info, last_price=200.0, previous_close=195.0)
        self.assertEqual(res["post_market_price"], 210.0)
        self.assertEqual(res["post_market_change"], 10.0)
        self.assertEqual(res["post_market_change_percent"], 5.0)

    def test_valid_pre_market(self):
        info = {
            "previousClose": 100.0,
            "preMarketPrice": 102.0,
            "preMarketTime": 1700003600,
        }
        res = _extract_extended_hours_data(info, last_price=None, previous_close=100.0)
        self.assertEqual(res["pre_market_price"], 102.0)
        self.assertEqual(res["pre_market_change"], 2.0)
        self.assertEqual(res["pre_market_change_percent"], 2.0)

    def test_pre_market_cleared_once_regular_market_updates(self):
        info = {
            "previousClose": 100.0,
            "preMarketPrice": 102.0,
            "preMarketTime": 1700003600,
            "regularMarketTime": 1700007200,  # Regular market has started / updated
        }
        res = _extract_extended_hours_data(info, last_price=101.5, previous_close=100.0)
        self.assertIsNone(res["pre_market_price"])
        self.assertIsNone(res["pre_market_change"])

    def test_pre_market_clears_post_market_when_market_state_pre(self):
        info = {
            "marketState": "PRE",
            "regularMarketPrice": 341.07,
            "previousClose": 335.92,
            "postMarketPrice": 341.46,
            "postMarketTime": 1700003600,
            "preMarketPrice": 340.85,
            "preMarketTime": 1700004000,
        }
        res = _extract_extended_hours_data(info, last_price=341.07, previous_close=335.92)
        self.assertIsNone(res["post_market_price"])
        self.assertIsNone(res["post_market_change"])
        self.assertEqual(res["pre_market_price"], 340.85)
        self.assertAlmostEqual(res["pre_market_change"], -0.22, places=2)

    def test_regular_market_clears_both_extended_hours(self):
        info = {
            "marketState": "REGULAR",
            "regularMarketPrice": 345.0,
            "postMarketPrice": 341.46,
            "preMarketPrice": 340.85,
        }
        res = _extract_extended_hours_data(info, last_price=345.0, previous_close=341.07)
        self.assertIsNone(res["post_market_price"])
        self.assertIsNone(res["pre_market_price"])

    def test_prepre_overnight_preserves_post_market_when_no_pre_price(self):
        info = {
            "marketState": "PREPRE",
            "regularMarketPrice": 70.53,
            "regularMarketTime": 1700000000,
            "postMarketPrice": 71.10,
            "postMarketChange": 0.57,
            "postMarketChangePercent": 0.808,
            "postMarketTime": 1700003600,
        }
        res = _extract_extended_hours_data(info, last_price=70.53, previous_close=72.61)
        self.assertEqual(res["post_market_price"], 71.10)
        self.assertEqual(res["post_market_change"], 0.57)
        self.assertIsNone(res["pre_market_price"])


class TestStockSerialization(unittest.TestCase):
    def test_serialize_stock_with_extended_hours(self):
        stock = Stock(
            id=1,
            symbol="NVDA",
            name="NVIDIA Corporation",
            sector="Technology",
            last_price=120.0,
            previous_close=118.0,
            post_market_price=122.5,
            post_market_change=2.5,
            post_market_change_percent=2.0833,
            day_open=119.0,
            day_high=121.5,
            day_low=117.8,
            updated_at=datetime(2026, 9, 24, 20, 0, 0),
        )
        serialized = serialize_stock(stock)
        self.assertEqual(serialized["symbol"], "NVDA")
        self.assertEqual(serialized["lastPrice"], 120.0)
        self.assertEqual(serialized["previousClose"], 118.0)
        self.assertEqual(serialized["postMarketPrice"], 122.5)
        self.assertEqual(serialized["postMarketChange"], 2.5)
        self.assertEqual(serialized["postMarketChangePercent"], 2.0833)
        self.assertEqual(serialized["dayOpen"], 119.0)
        self.assertEqual(serialized["dayHigh"], 121.5)
        self.assertEqual(serialized["dayLow"], 117.8)
        self.assertEqual(serialized["quoteDate"], "2026-09-24")


class TestDatabaseMigration(unittest.TestCase):
    def test_ensure_stock_columns_creates_extended_hours_columns(self):
        from flask import Flask
        from sqlalchemy import inspect
        from portfolio.data.db import db, init_db

        app = Flask(__name__)
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///:memory:"
        app.config["SQLALCHEMY_BINDS"] = {"master": "sqlite:///:memory:"}
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        init_db(app)

        with app.app_context():
            inspector = inspect(db.engines["master"])
            column_names = {col["name"] for col in inspector.get_columns("stocks")}
            expected = {
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
            self.assertTrue(expected.issubset(column_names), f"Missing columns: {expected - column_names}")


class TestMarketSessionClassification(unittest.TestCase):
    def test_market_session_pre_market(self):
        dt = datetime(2024, 6, 3, 6, 0, tzinfo=ZoneInfo("America/New_York"))
        self.assertEqual(get_market_session(dt), "pre")

    def test_market_session_regular(self):
        dt = datetime(2024, 6, 3, 11, 0, tzinfo=ZoneInfo("America/New_York"))
        self.assertEqual(get_market_session(dt), "regular")

    def test_market_session_post_market(self):
        dt = datetime(2024, 6, 3, 17, 0, tzinfo=ZoneInfo("America/New_York"))
        self.assertEqual(get_market_session(dt), "post")

    def test_market_session_closed_weekend(self):
        dt = datetime(2024, 6, 1, 11, 0, tzinfo=ZoneInfo("America/New_York"))  # Saturday
        self.assertEqual(get_market_session(dt), "closed")

    def test_market_session_closed_overnight(self):
        dt = datetime(2024, 6, 3, 21, 30, tzinfo=ZoneInfo("America/New_York"))
        self.assertEqual(get_market_session(dt), "closed")


class TestPriceRetrievalGuardrails(unittest.TestCase):
    def test_negative_or_zero_prices_ignored_in_extended_hours(self):
        info = {
            "marketState": "PRE",
            "preMarketPrice": -10.0,
            "postMarketPrice": 0.0,
        }
        res = _extract_extended_hours_data(info, last_price=100.0, previous_close=95.0)
        self.assertIsNone(res["pre_market_price"])
        self.assertIsNone(res["post_market_price"])


if __name__ == "__main__":
    unittest.main()
