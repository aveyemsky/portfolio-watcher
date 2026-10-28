"""Polymarket Provider for Macro & Equity Catalyst Intelligence."""
import json
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from portfolio.core.logging import get_logger
from portfolio.plugins.catalysts.base import BaseCatalystProvider

logger = get_logger(__name__)

GAMMA_BASE_URL = "https://gamma-api.polymarket.com"


def _get_ssl_context():
    try:
        import certifi
        import ssl
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return None

# Company and sector aliases for ticker resolution
COMPANY_ALIASES: Dict[str, List[str]] = {
    "NVDA": ["Nvidia", "NVDA", "GPU"],
    "AAPL": ["Apple", "AAPL", "iPhone"],
    "MSFT": ["Microsoft", "OpenAI"],
    "GOOGL": ["Google", "Alphabet"],
    "GOOG": ["Google", "Alphabet"],
    "AMZN": ["Amazon", "Anthropic"],
    "TSLA": ["Tesla", "TSLA", "Elon Musk", "Robotaxi"],
    "META": ["Meta", "Instagram", "Zuckerberg"],
    "XOM": ["Exxon", "Crude Oil", "oil pipeline", "oil"],
    "CVX": ["Chevron", "Crude Oil", "oil pipeline", "oil"],
    "AMD": ["AMD", "Semiconductor"],
    "INTC": ["Intel", "CHIPS Act"],
    "TSM": ["TSMC", "Taiwan", "semiconductor"],
    "ASML": ["ASML", "lithography", "export restrictions"],
    "BA": ["Boeing", "FAA"],
    "COIN": ["Coinbase", "SEC", "crypto"],
}

MACRO_CATEGORIES: Dict[str, List[str]] = {
    "fed": ["Fed Decision", "interest rate"],
    "inflation": ["Core CPI", "inflation"],
    "recession": ["US recession", "GDP"],
    "tariffs": ["tariff", "trade war"],
    "energy": ["Crude Oil", "oil pipeline", "OPEC"],
    "tech": ["Anthropic IPO", "OpenAI IPO", "Nvidia", "antitrust"],
}


class PolymarketProvider(BaseCatalystProvider):
    """
    Polymarket prediction market provider querying Gamma API.
    Zero-auth, high-liquidity forward-looking probability distributions.
    """

    id = "polymarket"
    name = "Polymarket"
    description = "Decentralized prediction market aggregating real-money probabilities for macro catalysts and equities."
    enabled = True

    def __init__(self, timeout: int = 10):
        self.timeout = timeout

    def _fetch_json(self, url: str, params: Optional[Dict[str, Any]] = None) -> Any:
        if params:
            encoded = urllib.parse.urlencode({k: str(v) for k, v in params.items() if v is not None})
            url = f"{url}?{encoded}"

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; PortfolioWatcher/1.0)",
                "Accept": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout, context=_get_ssl_context()) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            logger.warning("Polymarket API request failed (%s): %s", url, exc)
            return None

    def _parse_event(self, ev: Dict[str, Any], min_volume: float = 0.0) -> Optional[Dict[str, Any]]:
        """Parse raw Polymarket event and normalize outcome probabilities."""
        if ev.get("closed", False):
            return None

        vol = float(ev.get("volume", 0) or 0)
        if vol < min_volume:
            return None

        markets = []
        for m in ev.get("markets", []):
            if m.get("closed", False):
                continue

            raw_outcomes = m.get("outcomes", ["Yes", "No"])
            if isinstance(raw_outcomes, str):
                try:
                    outcomes = json.loads(raw_outcomes)
                except Exception:
                    outcomes = ["Yes", "No"]
            else:
                outcomes = list(raw_outcomes)

            raw_prices = m.get("outcomePrices", [])
            if isinstance(raw_prices, str):
                try:
                    prices = [float(p) for p in json.loads(raw_prices)]
                except Exception:
                    prices = []
            elif isinstance(raw_prices, list):
                prices = [float(p) for p in raw_prices]
            else:
                prices = []

            clob_tokens = m.get("clobTokenIds", [])
            if isinstance(clob_tokens, str):
                try:
                    clob_tokens = json.loads(clob_tokens)
                except Exception:
                    clob_tokens = []

            # Format outcomes with probabilities as percentages
            outcomes_data = []
            for outcome_label, price in zip(outcomes, prices):
                prob_pct = round(max(0.0, min(1.0, price)) * 100.0, 1)
                outcomes_data.append({
                    "label": outcome_label,
                    "price": price,
                    "probability_pct": prob_pct,
                })

            markets.append({
                "id": m.get("id"),
                "question": m.get("question"),
                "outcomes": outcomes_data,
                "clob_token_ids": clob_tokens,
                "volume": float(m.get("volume", 0) or 0),
                "volume24hr": float(m.get("volume24hr", 0) or 0),
            })

        slug = ev.get("slug", "")
        return {
            "id": str(ev.get("id")),
            "provider": self.id,
            "title": ev.get("title"),
            "slug": slug,
            "category": ev.get("category", "macro"),
            "end_date": ev.get("endDate"),
            "volume": vol,
            "volume24hr": float(ev.get("volume24hr", 0) or 0),
            "liquidity": float(ev.get("liquidity", 0) or 0),
            "markets": markets,
            "url": f"https://polymarket.com/event/{slug}" if slug else None,
        }

    def search_catalysts(
        self,
        query: str,
        limit: int = 15,
        min_volume: float = 0.0,
    ) -> List[Dict[str, Any]]:
        if not query or not query.strip():
            return []

        data = self._fetch_json(
            f"{GAMMA_BASE_URL}/public-search",
            {
                "q": query.strip(),
                "events_status": "active",
                "limit_per_type": limit,
            },
        )
        if not data or not isinstance(data, dict):
            return []

        events = data.get("events", [])
        parsed_events: List[Dict[str, Any]] = []

        for ev in events:
            parsed = self._parse_event(ev, min_volume=min_volume)
            if parsed:
                parsed_events.append(parsed)

        return parsed_events[:limit]

    def get_macro_catalysts(
        self,
        category: Optional[str] = None,
        limit: int = 20,
        min_volume: float = 500.0,
    ) -> List[Dict[str, Any]]:
        categories_to_query = (
            {category.lower(): MACRO_CATEGORIES[category.lower()]}
            if category and category.lower() in MACRO_CATEGORIES
            else MACRO_CATEGORIES
        )

        all_events: List[Dict[str, Any]] = []
        seen_ids = set()

        for cat_name, search_terms in categories_to_query.items():
            for term in search_terms:
                events = self.search_catalysts(term, limit=limit, min_volume=min_volume)
                for ev in events:
                    if ev["id"] not in seen_ids:
                        seen_ids.add(ev["id"])
                        ev["category"] = cat_name
                        all_events.append(ev)

        # Sort by total volume descending (most liquid & skin-in-the-game first)
        all_events.sort(key=lambda x: x.get("volume", 0), reverse=True)
        return all_events[:limit]

    def get_stock_catalysts(
        self,
        symbol: str,
        limit: int = 15,
        min_volume: float = 0.0,
    ) -> List[Dict[str, Any]]:
        sym = (symbol or "").strip().upper()
        if not sym:
            return []

        search_terms = COMPANY_ALIASES.get(sym, [sym])
        all_events: List[Dict[str, Any]] = []
        seen_ids = set()

        for term in search_terms:
            events = self.search_catalysts(term, limit=limit, min_volume=min_volume)
            for ev in events:
                if ev["id"] not in seen_ids:
                    seen_ids.add(ev["id"])
                    all_events.append(ev)

        all_events.sort(key=lambda x: x.get("volume", 0), reverse=True)
        return all_events[:limit]
