"""Service orchestration for Macro Catalysts and Stock Prediction Markets."""
from typing import Any, Dict, List, Optional

from portfolio.core.logging import get_logger
from portfolio.plugins.catalysts.registry import get_catalyst_registry

logger = get_logger(__name__)


def list_catalyst_providers() -> List[Dict[str, Any]]:
    """Return all registered prediction market & catalyst providers."""
    registry = get_catalyst_registry()
    return registry.list_providers()


def get_macro_catalysts(
    category: Optional[str] = None,
    provider_id: Optional[str] = None,
    limit: int = 20,
    min_volume: float = 500.0,
    bypass_cache: bool = False,
) -> List[Dict[str, Any]]:
    """
    Fetch forward-looking macro prediction events across Fed rates, inflation, recession, oil, tariffs.
    """
    registry = get_catalyst_registry()
    return registry.get_macro_catalysts(
        category=category,
        provider_id=provider_id,
        limit=limit,
        min_volume=min_volume,
        bypass_cache=bypass_cache,
    )


def get_stock_catalysts(
    symbol: str,
    provider_id: Optional[str] = None,
    limit: int = 15,
    min_volume: float = 0.0,
    bypass_cache: bool = False,
) -> List[Dict[str, Any]]:
    """
    Fetch impending catalysts for an equity ticker mapped across corporate names and sector themes.
    """
    registry = get_catalyst_registry()
    return registry.get_stock_catalysts(
        symbol=symbol,
        provider_id=provider_id,
        limit=limit,
        min_volume=min_volume,
        bypass_cache=bypass_cache,
    )


def search_catalysts(
    query: str,
    provider_id: Optional[str] = None,
    limit: int = 15,
    min_volume: float = 0.0,
    bypass_cache: bool = False,
) -> List[Dict[str, Any]]:
    """
    Search active prediction markets by arbitrary keyword query.
    """
    registry = get_catalyst_registry()
    return registry.search_catalysts(
        query=query,
        provider_id=provider_id,
        limit=limit,
        min_volume=min_volume,
        bypass_cache=bypass_cache,
    )
