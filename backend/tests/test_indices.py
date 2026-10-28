"""Guardrail tests for market indices configuration.

Ensures core indices such as NASDAQ 100 (^NDX), S&P 500 (^GSPC), and Dow Jones (^DJI)
are protected against accidental removal or schema divergence.
"""
from portfolio.config.indices import DEFAULT_INDICES


def test_default_indices_include_nasdaq_100():
    symbols = {item["symbol"] for item in DEFAULT_INDICES}
    assert "^NDX" in symbols, "NASDAQ 100 (^NDX) must be present in default market indices"


def test_default_indices_essential_suite():
    expected_core = {"^DJI", "^GSPC", "^IXIC", "^NDX", "^RUT", "^VIX"}
    symbols = {item["symbol"] for item in DEFAULT_INDICES}
    missing = expected_core - symbols
    assert not missing, f"Missing essential core indices: {missing}"


def test_default_indices_schema_integrity():
    orders = []
    for item in DEFAULT_INDICES:
        assert item["symbol"].startswith("^"), f"Index symbol should start with ^: {item['symbol']}"
        assert item["name"], f"Index {item['symbol']} must have a name"
        assert item["short_name"], f"Index {item['symbol']} must have a short_name"
        assert item["sector"] == "Index", f"Index {item['symbol']} sector must be 'Index'"
        assert isinstance(item["display_order"], int), f"Index {item['symbol']} display_order must be int"
        orders.append(item["display_order"])

    # Ensure display order is sequentially unique
    assert len(orders) == len(set(orders)), "display_order must be unique among default indices"
