import unittest
from datetime import date, timedelta
from unittest.mock import patch, MagicMock

import pandas as pd

from portfolio.services import indicator_service


class DummyPrice:
    def __init__(self, price_date, open_p, high, low, close, volume):
        self.date = price_date
        self.open = open_p
        self.high = high
        self.low = low
        self.close = close
        self.volume = volume


def generate_dummy_prices(n=100, base_price=100.0, trend=0.5):
    start = date(2025, 1, 1)
    prices = []
    current_close = base_price
    for i in range(n):
        d = start + timedelta(days=i)
        current_close += trend + (0.5 if i % 2 == 0 else -0.5)
        high = current_close + 1.0
        low = current_close - 1.0
        open_p = current_close - 0.2
        prices.append(DummyPrice(d.strftime("%Y-%m-%d"), open_p, high, low, current_close, 1000000))
    return prices


class TestIndicators(unittest.TestCase):
    @patch("portfolio.services.indicator_service.stock_repository")
    @patch("portfolio.services.indicator_service.price_repository")
    def test_calculate_indicators_empty_prices(self, mock_price_repo, mock_stock_repo):
        mock_stock = MagicMock(id=1, symbol="AAPL")
        mock_stock_repo.get_stock_by_symbol.return_value = mock_stock
        mock_price_repo.list_prices_for_stock_id.return_value = []

        res = indicator_service.calculate_indicators("AAPL")
        self.assertEqual(res["symbol"], "AAPL")
        self.assertTrue(res["notEnoughData"])
        self.assertIn("ema20", res["indicators"])
        self.assertIn("ma50", res["indicators"])
        self.assertIn("ma200", res["indicators"])
        self.assertIn("bb20", res["indicators"])
        self.assertIn("atr14", res["indicators"])
        self.assertIn("rsi14", res["indicators"])
        self.assertIn("stoch14", res["indicators"])
        self.assertIn("macd", res["indicators"])
        self.assertIn("obv", res["indicators"])
        self.assertEqual(res["indicators"]["ema20"]["status"], "not_enough_data")
        self.assertEqual(res["indicators"]["bb20"]["status"], "not_enough_data")
        self.assertEqual(res["indicators"]["atr14"]["status"], "not_enough_data")
        self.assertEqual(res["indicators"]["stoch14"]["status"], "not_enough_data")
        self.assertEqual(res["indicators"]["macd"]["status"], "not_enough_data")
        self.assertEqual(res["indicators"]["obv"]["status"], "not_enough_data")

    @patch("portfolio.services.indicator_service.stock_repository")
    @patch("portfolio.services.indicator_service.price_repository")
    def test_calculate_indicators_full_history(self, mock_price_repo, mock_stock_repo):
        mock_stock = MagicMock(id=1, symbol="AAPL")
        mock_stock_repo.get_stock_by_symbol.return_value = mock_stock
        prices = generate_dummy_prices(250, base_price=100.0, trend=0.2)
        mock_price_repo.list_prices_for_stock_id.return_value = prices

        res = indicator_service.calculate_indicators("AAPL")
        self.assertEqual(res["symbol"], "AAPL")
        self.assertFalse(res["notEnoughData"])

        # EMA-20
        ema = res["indicators"]["ema20"]
        self.assertIsNotNone(ema["value"])
        self.assertIn(ema["status"], ["price_above_ema", "price_below_ema"])

        # MA-50 & MA-200
        ma50 = res["indicators"]["ma50"]
        ma200 = res["indicators"]["ma200"]
        self.assertIsNotNone(ma50["value"])
        self.assertIsNotNone(ma200["value"])

        # Bollinger Bands
        bb = res["indicators"]["bb20"]
        self.assertIsNotNone(bb["value"]["upper"])
        self.assertIsNotNone(bb["value"]["middle"])
        self.assertIsNotNone(bb["value"]["lower"])
        self.assertGreater(bb["value"]["upper"], bb["value"]["lower"])
        self.assertIn(bb["status"], ["price_above_upper", "price_below_lower", "inside_bands"])

        # ATR-14
        atr = res["indicators"]["atr14"]
        self.assertIsNotNone(atr["value"]["atr"])
        self.assertIsNotNone(atr["value"]["atrPct"])
        self.assertGreater(atr["value"]["atr"], 0.0)
        self.assertIn(atr["status"], ["high_volatility", "low_volatility", "normal_volatility"])

        # RSI-14
        rsi = res["indicators"]["rsi14"]
        self.assertIsNotNone(rsi["value"])
        self.assertGreaterEqual(rsi["value"], 0.0)
        self.assertLessEqual(rsi["value"], 100.0)

        # Stochastic (14, 3, 3)
        stoch = res["indicators"]["stoch14"]
        self.assertIsNotNone(stoch["value"]["k"])
        self.assertIsNotNone(stoch["value"]["d"])
        self.assertIn(stoch["status"], ["bullish_crossover", "bearish_crossover", "bullish", "bearish", "overbought", "oversold", "neutral"])

        # MACD
        macd = res["indicators"]["macd"]
        self.assertIsNotNone(macd["value"]["macd"])
        self.assertIsNotNone(macd["value"]["signal"])
        self.assertIsNotNone(macd["value"]["histogram"])
        self.assertIn(macd["status"], ["bullish_crossover", "bearish_crossover", "bullish", "bearish", "neutral"])

        # OBV
        obv = res["indicators"]["obv"]
        self.assertIsNotNone(obv["value"]["obv"])
        self.assertIn(obv["status"], ["accumulation", "distribution"])

    @patch("portfolio.services.indicator_service.stock_repository")
    @patch("portfolio.services.indicator_service.price_repository")
    def test_calculate_indicator_series(self, mock_price_repo, mock_stock_repo):
        mock_stock = MagicMock(id=1, symbol="AAPL")
        mock_stock_repo.get_stock_by_symbol.return_value = mock_stock
        prices = generate_dummy_prices(250, base_price=100.0, trend=0.2)
        mock_price_repo.list_prices_for_stock_id.return_value = prices

        res = indicator_service.calculate_indicator_series("AAPL")
        self.assertEqual(res["symbol"], "AAPL")
        self.assertIn("ema20", res["series"])
        self.assertIn("bb20", res["series"])
        self.assertIn("atr14", res["series"])
        self.assertIn("stoch14", res["series"])
        self.assertIn("macd", res["series"])
        self.assertIn("obv", res["series"])

        # Single-line series structure: list of {date, value}
        ema_series = res["series"]["ema20"]
        self.assertTrue(len(ema_series) > 0)
        self.assertIn("date", ema_series[0])
        self.assertIn("value", ema_series[0])

        # Bollinger Bands series structure: {upper: [...], middle: [...], lower: [...]}
        bb_series = res["series"]["bb20"]
        self.assertIn("upper", bb_series)
        self.assertIn("middle", bb_series)
        self.assertIn("lower", bb_series)
        self.assertTrue(len(bb_series["upper"]) > 0)

        # Stochastic series structure: {k: [...], d: [...]}
        stoch_series = res["series"]["stoch14"]
        self.assertIn("k", stoch_series)
        self.assertIn("d", stoch_series)
        self.assertTrue(len(stoch_series["k"]) > 0)

        # MACD series structure: {macd: [...], signal: [...], histogram: [...]}
        macd_series = res["series"]["macd"]
        self.assertIn("macd", macd_series)
        self.assertIn("signal", macd_series)
        self.assertIn("histogram", macd_series)
        self.assertTrue(len(macd_series["macd"]) > 0)

        # OBV series structure: {obv: [...], sma20: [...]}
        obv_series = res["series"]["obv"]
        self.assertIn("obv", obv_series)
        self.assertIn("sma20", obv_series)
        self.assertTrue(len(obv_series["obv"]) > 0)

    @patch("portfolio.services.stock_service.get_stock_by_symbol")
    @patch("portfolio.services.indicator_service.stock_repository")
    @patch("portfolio.services.indicator_service.price_repository")
    def test_indicator_api_endpoints(self, mock_price_repo, mock_stock_repo, mock_stock_service_get):
        from app import app
        mock_stock = MagicMock(id=1, symbol="AAPL")
        mock_stock_repo.get_stock_by_symbol.return_value = mock_stock
        mock_stock_service_get.return_value = mock_stock
        prices = generate_dummy_prices(250, base_price=100.0, trend=0.5)
        mock_price_repo.list_prices_for_stock_id.return_value = prices

        client = app.test_client()

        # GET /api/portfolio/stocks/AAPL/indicators
        resp = client.get("/api/portfolio/stocks/AAPL/indicators")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("indicators", data)
        self.assertIn("ema20", data["indicators"])
        self.assertIn("bb20", data["indicators"])
        self.assertIn("atr14", data["indicators"])
        self.assertIn("stoch14", data["indicators"])
        self.assertIn("macd", data["indicators"])
        self.assertIn("obv", data["indicators"])

        # GET /api/portfolio/stocks/AAPL/indicators/series
        resp_series = client.get("/api/portfolio/stocks/AAPL/indicators/series")
        self.assertEqual(resp_series.status_code, 200)
        data_series = resp_series.get_json()
        self.assertIn("series", data_series)
        self.assertIn("ema20", data_series["series"])
        self.assertIn("bb20", data_series["series"])
        self.assertIn("atr14", data_series["series"])
        self.assertIn("stoch14", data_series["series"])
        self.assertIn("macd", data_series["series"])
        self.assertIn("obv", data_series["series"])


if __name__ == "__main__":
    unittest.main()
