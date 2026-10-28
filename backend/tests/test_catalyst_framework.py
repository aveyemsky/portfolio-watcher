"""Tests for Pluggable Catalyst & Prediction Market Framework."""
from unittest.mock import MagicMock, patch
import pytest

from app import create_app
from portfolio.plugins.catalysts.base import BaseCatalystProvider
from portfolio.plugins.catalysts.providers.polymarket_provider import PolymarketProvider
from portfolio.plugins.catalysts.registry import CatalystRegistry, get_catalyst_registry
from portfolio.services import catalyst_service


class DummyCatalystProvider(BaseCatalystProvider):
    id = "dummy_catalyst"
    name = "Dummy Catalyst Provider"
    description = "Test mock provider"
    enabled = True

    def get_macro_catalysts(self, category=None, limit=20, min_volume=500.0):
        return [
            {
                "id": "macro_fed_1",
                "provider": self.id,
                "title": "Fed Decision in October?",
                "slug": "fed-decision-october",
                "category": category or "fed",
                "end_date": "2026-10-28",
                "volume": 32000000.0,
                "volume24hr": 450000.0,
                "markets": [
                    {
                        "id": "m1",
                        "question": "Will Fed hold rates?",
                        "outcomes": [
                            {"label": "Yes", "price": 0.835, "probability_pct": 83.5},
                            {"label": "No", "price": 0.165, "probability_pct": 16.5},
                        ],
                    }
                ],
                "url": "https://polymarket.com/event/fed-decision-october",
            }
        ]

    def get_stock_catalysts(self, symbol, limit=15, min_volume=0.0):
        return [
            {
                "id": f"stock_{symbol}_1",
                "provider": self.id,
                "title": f"DOJ probe on {symbol}",
                "slug": f"doj-probe-{symbol.lower()}",
                "category": "regulatory",
                "end_date": "2026-12-31",
                "volume": 50000.0,
                "volume24hr": 1200.0,
                "markets": [
                    {
                        "id": "m2",
                        "question": f"Will DOJ fine {symbol}?",
                        "outcomes": [
                            {"label": "Yes", "price": 0.115, "probability_pct": 11.5},
                            {"label": "No", "price": 0.885, "probability_pct": 88.5},
                        ],
                    }
                ],
                "url": f"https://polymarket.com/event/doj-probe-{symbol.lower()}",
            }
        ]

    def search_catalysts(self, query, limit=15, min_volume=0.0):
        return [
            {
                "id": f"search_{query}_1",
                "provider": self.id,
                "title": f"Event matching {query}",
                "slug": f"match-{query.lower()}",
                "category": "macro",
                "volume": 10000.0,
                "markets": [],
            }
        ]


@pytest.fixture
def test_app():
    app = create_app()
    app.config["TESTING"] = True
    yield app


def test_registry_registration_and_list():
    reg = CatalystRegistry(cache_ttl_seconds=60)
    provider = DummyCatalystProvider()
    reg.register(provider)

    providers = reg.list_providers()
    assert len(providers) == 1
    assert providers[0]["id"] == "dummy_catalyst"
    assert providers[0]["name"] == "Dummy Catalyst Provider"


def test_registry_caching():
    reg = CatalystRegistry(cache_ttl_seconds=60)
    provider = DummyCatalystProvider()
    reg.register(provider)

    with patch.object(provider, "get_macro_catalysts", wraps=provider.get_macro_catalysts) as mock_call:
        res1 = reg.get_macro_catalysts(category="fed")
        assert len(res1) == 1
        assert mock_call.call_count == 1

        # Second call should be served from memory cache
        res2 = reg.get_macro_catalysts(category="fed")
        assert len(res2) == 1
        assert mock_call.call_count == 1

        # Bypass cache should trigger fetch
        res3 = reg.get_macro_catalysts(category="fed", bypass_cache=True)
        assert len(res3) == 1
        assert mock_call.call_count == 2


def test_polymarket_provider_parse_event():
    provider = PolymarketProvider()

    raw_event = {
        "id": "12345",
        "title": "Fed Decision in October?",
        "slug": "fed-decision-in-october",
        "closed": False,
        "volume": 32000000,
        "volume24hr": 450000,
        "endDate": "2026-10-28T18:00:00Z",
        "markets": [
            {
                "id": "m1",
                "question": "Will Fed hold rates?",
                "closed": False,
                "outcomes": '["Yes", "No"]',
                "outcomePrices": '["0.835", "0.165"]',
                "volume": 30000000,
            }
        ],
    }

    parsed = provider._parse_event(raw_event, min_volume=1000)
    assert parsed is not None
    assert parsed["id"] == "12345"
    assert parsed["title"] == "Fed Decision in October?"
    assert len(parsed["markets"]) == 1
    market = parsed["markets"][0]
    assert market["outcomes"][0]["label"] == "Yes"
    assert market["outcomes"][0]["probability_pct"] == 83.5
    assert market["outcomes"][1]["label"] == "No"
    assert market["outcomes"][1]["probability_pct"] == 16.5


def test_catalyst_api_endpoints(test_app):
    client = test_app.test_client()

    dummy = DummyCatalystProvider()
    registry = get_catalyst_registry()
    registry.register(dummy)

    # 1. Macro Catalysts
    resp_macro = client.get("/api/portfolio/catalysts/macro?provider=dummy_catalyst")
    assert resp_macro.status_code == 200
    data_macro = resp_macro.get_json()
    assert data_macro["status"] == "success"
    assert len(data_macro["data"]) >= 1
    assert data_macro["data"][0]["title"] == "Fed Decision in October?"

    # 2. Stock Catalysts
    resp_stock = client.get("/api/portfolio/stocks/NVDA/catalysts?provider=dummy_catalyst")
    assert resp_stock.status_code == 200
    data_stock = resp_stock.get_json()
    assert data_stock["status"] == "success"
    assert data_stock["symbol"] == "NVDA"
    assert len(data_stock["data"]) >= 1

    # 3. Search Catalysts
    resp_search = client.get("/api/portfolio/catalysts/search?q=CPI&provider=dummy_catalyst")
    assert resp_search.status_code == 200
    data_search = resp_search.get_json()
    assert data_search["status"] == "success"
    assert data_search["query"] == "CPI"

    # 4. Providers List
    resp_prov = client.get("/api/portfolio/catalysts/providers")
    assert resp_prov.status_code == 200
    data_prov = resp_prov.get_json()
    assert data_prov["status"] == "success"
    assert any(p["id"] == "dummy_catalyst" for p in data_prov["data"])
    assert any(p["id"] == "polymarket" for p in data_prov["data"])
