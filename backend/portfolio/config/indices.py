"""Default market indices configuration.

To add or modify indices in the future, simply update the DEFAULT_INDICES list.
Each index will be seeded with historical price data from yfinance, marked as
asset_type='index', and protected from accidental deletion.
"""

DEFAULT_INDICES = [
    {
        "symbol": "^DJI",
        "name": "Dow Jones Industrial Average",
        "short_name": "DJIA",
        "sector": "Index",
        "display_order": 1,
    },
    {
        "symbol": "^GSPC",
        "name": "S&P 500",
        "short_name": "S&P 500",
        "sector": "Index",
        "display_order": 2,
    },
    {
        "symbol": "^IXIC",
        "name": "NASDAQ Composite",
        "short_name": "NASDAQ",
        "sector": "Index",
        "display_order": 3,
    },
    {
        "symbol": "^NDX",
        "name": "NASDAQ 100",
        "short_name": "NASDAQ 100",
        "sector": "Index",
        "display_order": 4,
    },
    {
        "symbol": "^RUT",
        "name": "Russell 2000",
        "short_name": "Russell 2000",
        "sector": "Index",
        "display_order": 5,
    },
    {
        "symbol": "^VIX",
        "name": "CBOE Volatility Index",
        "short_name": "Volatility (VIX)",
        "sector": "Index",
        "display_order": 6,
    },
    {
        "symbol": "^SKEW",
        "name": "CBOE SKEW Index",
        "short_name": "Tail Risk (SKEW)",
        "sector": "Index",
        "display_order": 7,
    },
]
