from datetime import date
from unittest.mock import MagicMock, patch

from portfolio.services import stock_data_service


def test_get_fixed_history_start_date_default_2017():
    assert stock_data_service.get_fixed_history_start_date() == "2017-01-01"


def test_get_fixed_history_start_date_with_years():
    d1 = date(2026, 10, 1)
    d15 = date(2026, 10, 15)
    d31 = date(2026, 10, 31)

    start1 = stock_data_service.get_fixed_history_start_date(years=7, ref_date=d1)
    start15 = stock_data_service.get_fixed_history_start_date(years=7, ref_date=d15)
    start31 = stock_data_service.get_fixed_history_start_date(years=7, ref_date=d31)

    # All dates in the same month share the exact same fixed anchor start date
    assert start1 == "2019-10-01"
    assert start15 == "2019-10-01"
    assert start31 == "2019-10-01"


def test_default_start_date_with_years():
    fixed_start = stock_data_service.default_start_date(years=7)
    expected = stock_data_service.get_fixed_history_start_date(years=7)
    assert fixed_start == expected


def test_fetch_stock_price_history_uses_fixed_start_for_default():
    import pandas as pd
    with patch.object(stock_data_service, "_require_yfinance"):
        with patch("portfolio.services.stock_data_service.yf.download") as mock_download:
            mock_df = pd.DataFrame(
                {
                    "Open": [100.0],
                    "High": [105.0],
                    "Low": [99.0],
                    "Close": [102.0],
                    "Volume": [1000],
                },
                index=[pd.Timestamp("2026-10-12")],
            )
            mock_download.return_value = mock_df

            stock_data_service.fetch_stock_price_history("AAPL")

            assert mock_download.called
            call_kwargs = mock_download.call_args[1]
            # Verify start date is anchored to default fixed start date 2017-01-01
            assert call_kwargs.get("start") == "2017-01-01"
            assert "period" not in call_kwargs


def test_fetch_stock_price_history_backfills_unsettled_final_close_without_marking_dirty():
    import numpy as np
    import pandas as pd

    with patch.object(stock_data_service, "_require_yfinance"):
        with patch("portfolio.services.stock_data_service.yf.download") as mock_download, \
             patch("portfolio.services.stock_data_service.yf.Ticker") as mock_ticker_cls:
            mock_df = pd.DataFrame(
                {
                    "Open": [349.12, 343.90],
                    "High": [351.73, 347.09],
                    "Low": [345.75, 341.03],
                    "Close": [347.73, np.nan],
                    "Adj Close": [347.73, np.nan],
                    "Volume": [39496500, 42263954],
                },
                index=[pd.Timestamp("2026-10-23"), pd.Timestamp("2026-10-26")],
            )
            mock_download.return_value = mock_df
            mock_ticker = MagicMock()
            mock_ticker.fast_info = {"lastPrice": 343.91}
            mock_ticker_cls.return_value = mock_ticker

            res = stock_data_service.fetch_stock_price_history("AAPL", return_meta=True)
            assert res["has_missing_data"] is False
            assert len(res["prices"]) == 2
            assert res["prices"][-1]["date"] == date(2026, 10, 26)
            assert res["prices"][-1]["close"] == 343.91


def test_fetch_stock_price_history_marks_historical_nan_as_missing_data():
    import numpy as np
    import pandas as pd

    with patch.object(stock_data_service, "_require_yfinance"):
        with patch("portfolio.services.stock_data_service.yf.download") as mock_download:
            mock_df = pd.DataFrame(
                {
                    "Open": [np.nan, 349.12],
                    "High": [np.nan, 351.73],
                    "Low": [np.nan, 345.75],
                    "Close": [np.nan, 347.73],
                    "Volume": [0, 39496500],
                },
                index=[pd.Timestamp("2025-05-10"), pd.Timestamp("2025-05-11")],
            )
            mock_download.return_value = mock_df

            res = stock_data_service.fetch_stock_price_history("AAPL", return_meta=True)
            assert res["has_missing_data"] is True
            assert len(res["prices"]) == 1
