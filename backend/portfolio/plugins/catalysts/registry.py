"""Registry and aggregation manager for Prediction Market & Catalyst Providers."""
import time
from typing import Any, Dict, List, Optional

from portfolio.core.logging import get_logger
from portfolio.plugins.catalysts.base import BaseCatalystProvider

logger = get_logger(__name__)


class CatalystRegistry:
    """
    Central registry managing pluggable catalyst providers.
    Supports in-memory caching with TTL to ensure rapid response times and avoid external rate-limiting.
    """

    def __init__(self, cache_ttl_seconds: int = 180):
        self._providers: Dict[str, BaseCatalystProvider] = {}
        # Cache maps cache_key -> (timestamp, List[events])
        self._cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}
        self.cache_ttl = cache_ttl_seconds

    def register(self, provider: BaseCatalystProvider) -> None:
        self._providers[provider.id] = provider
        logger.info("Registered catalyst provider: %s (%s)", provider.id, provider.name)

    def unregister(self, provider_id: str) -> Optional[BaseCatalystProvider]:
        provider = self._providers.pop(provider_id, None)
        self.clear_cache(provider_id=provider_id)
        return provider

    def get_provider(self, provider_id: str) -> Optional[BaseCatalystProvider]:
        return self._providers.get(provider_id)

    def list_providers(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": p.id,
                "name": p.name,
                "description": p.description,
                "enabled": p.enabled,
            }
            for p in self._providers.values()
        ]

    def get_macro_catalysts(
        self,
        category: Optional[str] = None,
        provider_id: Optional[str] = None,
        limit: int = 20,
        min_volume: float = 500.0,
        bypass_cache: bool = False,
    ) -> List[Dict[str, Any]]:
        now = time.time()
        providers = [self._providers[provider_id]] if provider_id and provider_id in self._providers else [
            p for p in self._providers.values() if p.enabled
        ]

        all_events: List[Dict[str, Any]] = []
        for p in providers:
            cache_key = f"macro:{p.id}:{category or 'all'}:{limit}:{min_volume}"
            cached = self._cache.get(cache_key)

            if not bypass_cache and cached and (now - cached[0] < self.cache_ttl):
                events = cached[1]
            else:
                try:
                    events = p.get_macro_catalysts(category=category, limit=limit, min_volume=min_volume) or []
                    self._cache[cache_key] = (now, events)
                except Exception as exc:
                    logger.warning("Error fetching macro catalysts from '%s': %s", p.id, exc)
                    events = []

            all_events.extend(events)

        # Deduplicate and sort by volume descending
        seen = set()
        deduped = []
        for ev in all_events:
            ev_id = f"{ev.get('provider')}:{ev.get('id')}"
            if ev_id not in seen:
                seen.add(ev_id)
                deduped.append(ev)

        deduped.sort(key=lambda x: x.get("volume", 0), reverse=True)
        return deduped[:limit]

    def get_stock_catalysts(
        self,
        symbol: str,
        provider_id: Optional[str] = None,
        limit: int = 15,
        min_volume: float = 0.0,
        bypass_cache: bool = False,
    ) -> List[Dict[str, Any]]:
        sym = (symbol or "").strip().upper()
        if not sym:
            return []

        now = time.time()
        providers = [self._providers[provider_id]] if provider_id and provider_id in self._providers else [
            p for p in self._providers.values() if p.enabled
        ]

        all_events: List[Dict[str, Any]] = []
        for p in providers:
            cache_key = f"stock:{p.id}:{sym}:{limit}:{min_volume}"
            cached = self._cache.get(cache_key)

            if not bypass_cache and cached and (now - cached[0] < self.cache_ttl):
                events = cached[1]
            else:
                try:
                    events = p.get_stock_catalysts(sym, limit=limit, min_volume=min_volume) or []
                    self._cache[cache_key] = (now, events)
                except Exception as exc:
                    logger.warning("Error fetching stock catalysts from '%s' for %s: %s", p.id, sym, exc)
                    events = []

            all_events.extend(events)

        seen = set()
        deduped = []
        for ev in all_events:
            ev_id = f"{ev.get('provider')}:{ev.get('id')}"
            if ev_id not in seen:
                seen.add(ev_id)
                deduped.append(ev)

        deduped.sort(key=lambda x: x.get("volume", 0), reverse=True)
        return deduped[:limit]

    def search_catalysts(
        self,
        query: str,
        provider_id: Optional[str] = None,
        limit: int = 15,
        min_volume: float = 0.0,
        bypass_cache: bool = False,
    ) -> List[Dict[str, Any]]:
        q = (query or "").strip()
        if not q:
            return []

        now = time.time()
        providers = [self._providers[provider_id]] if provider_id and provider_id in self._providers else [
            p for p in self._providers.values() if p.enabled
        ]

        all_events: List[Dict[str, Any]] = []
        for p in providers:
            cache_key = f"search:{p.id}:{q.lower()}:{limit}:{min_volume}"
            cached = self._cache.get(cache_key)

            if not bypass_cache and cached and (now - cached[0] < self.cache_ttl):
                events = cached[1]
            else:
                try:
                    events = p.search_catalysts(q, limit=limit, min_volume=min_volume) or []
                    self._cache[cache_key] = (now, events)
                except Exception as exc:
                    logger.warning("Error searching catalysts from '%s' for '%s': %s", p.id, q, exc)
                    events = []

            all_events.extend(events)

        seen = set()
        deduped = []
        for ev in all_events:
            ev_id = f"{ev.get('provider')}:{ev.get('id')}"
            if ev_id not in seen:
                seen.add(ev_id)
                deduped.append(ev)

        deduped.sort(key=lambda x: x.get("volume", 0), reverse=True)
        return deduped[:limit]

    def clear_cache(self, provider_id: Optional[str] = None) -> None:
        if not provider_id:
            self._cache.clear()
        else:
            self._cache = {k: v for k, v in self._cache.items() if not k.startswith(f"{provider_id}:") and f":{provider_id}:" not in k}


_registry_instance: Optional[CatalystRegistry] = None


def get_catalyst_registry() -> CatalystRegistry:
    """Return singleton instance of CatalystRegistry with default providers registered."""
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = CatalystRegistry()
        _register_builtin_providers(_registry_instance)
    return _registry_instance


def _register_builtin_providers(registry: CatalystRegistry) -> None:
    try:
        from portfolio.plugins.catalysts.providers.polymarket_provider import PolymarketProvider
        registry.register(PolymarketProvider())
    except Exception as exc:
        logger.warning("Could not register default PolymarketProvider: %s", exc)
