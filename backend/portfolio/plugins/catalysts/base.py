"""Base abstract class and contracts for Pluggable Prediction Market & Catalyst Providers."""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseCatalystProvider(ABC):
    """
    Abstract base class for Prediction Market & Catalyst Providers.
    Pluggable providers supply forward-looking market probability distributions
    (e.g. Polymarket, Kalshi, Metaculus) for macro events and individual equities.
    """

    id: str = "base"
    name: str = "Base Catalyst Provider"
    description: str = ""
    enabled: bool = True

    @abstractmethod
    def get_macro_catalysts(
        self,
        category: Optional[str] = None,
        limit: int = 20,
        min_volume: float = 500.0,
    ) -> List[Dict[str, Any]]:
        """
        Fetch forward-looking macroeconomic catalysts (Fed decisions, CPI, recession, oil, tariffs).
        """
        raise NotImplementedError

    @abstractmethod
    def get_stock_catalysts(
        self,
        symbol: str,
        limit: int = 15,
        min_volume: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        Fetch active forward-looking catalysts directly tied to a given equity ticker or company.
        """
        raise NotImplementedError

    @abstractmethod
    def search_catalysts(
        self,
        query: str,
        limit: int = 15,
        min_volume: float = 0.0,
    ) -> List[Dict[str, Any]]:
        """
        Search prediction events by arbitrary keyword query.
        """
        raise NotImplementedError
