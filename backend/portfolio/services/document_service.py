"""Service orchestration for Stock Documents, Intel, and Notes."""
from typing import Any, Dict, List, Optional

from portfolio.core.logging import get_logger
from portfolio.plugins.documents.registry import get_document_registry

logger = get_logger(__name__)


def list_document_providers() -> List[Dict[str, Any]]:
    registry = get_document_registry()
    return registry.list_providers()


def get_stock_documents(
    symbol: str,
    category: Optional[str] = None,
    provider_id: Optional[str] = None,
    limit: int = 30,
    bypass_cache: bool = False,
) -> List[Dict[str, Any]]:
    registry = get_document_registry()
    return registry.get_documents_for_symbol(
        symbol=symbol,
        category=category,
        provider_id=provider_id,
        limit=limit,
        bypass_cache=bypass_cache,
    )


def save_stock_note(symbol: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    registry = get_document_registry()
    notes_provider = registry.get_provider("notes")
    if not notes_provider:
        raise ValueError("Notes provider is not registered or disabled.")
    return notes_provider.save_document(symbol, payload)


def delete_stock_note(symbol: str, note_id: str) -> bool:
    registry = get_document_registry()
    notes_provider = registry.get_provider("notes")
    if not notes_provider:
        return False
    return notes_provider.delete_document(symbol, note_id)
