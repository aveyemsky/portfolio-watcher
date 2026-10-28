"""Base abstract class and contracts for Pluggable Stock Document Providers."""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseDocumentProvider(ABC):
    """
    Abstract base class for Stock Document Providers.
    Pluggable providers supply news, filings, insider trades, analyst research,
    personal notes, or proprietary intelligence for any given stock ticker.
    """

    id: str = "base"
    name: str = "Base Provider"
    category: str = "general"  # "news", "filings", "insider", "notes", "research"
    description: str = ""
    enabled: bool = True
    read_only: bool = True

    @abstractmethod
    def get_documents(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch documents for a specific stock symbol.

        Each returned dictionary must conform to the StockDocument contract:
        {
            "id": str,
            "provider": str (matches provider id),
            "category": str ("news" | "filings" | "insider" | "notes" | "research"),
            "title": str,
            "timestamp": str (ISO-8601 UTC timestamp e.g. "2026-09-28T16:00:00Z"),
            "source": str (e.g. "Yahoo Finance", "SEC Form 4", "Personal Notes"),
            "summary": Optional[str],
            "body": Optional[str] (markdown or text body),
            "content_type": str ("text" | "markdown" | "table" | "link"),
            "url": Optional[str],
            "metadata": Dict[str, Any]
        }
        """
        raise NotImplementedError

    def save_document(self, symbol: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Optional save/create/update method for editable providers (like notes)."""
        raise NotImplementedError("This provider is read-only.")

    def delete_document(self, symbol: str, doc_id: str) -> bool:
        """Optional delete method for editable providers."""
        raise NotImplementedError("This provider is read-only.")
