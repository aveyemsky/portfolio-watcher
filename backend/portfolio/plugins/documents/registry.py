"""Registry and aggregation manager for Stock Document Providers."""
import time
from typing import Any, Dict, List, Optional

from portfolio.core.logging import get_logger
from portfolio.plugins.documents.base import BaseDocumentProvider

logger = get_logger(__name__)


class DocumentRegistry:
    def __init__(self, cache_ttl_seconds: int = 300):
        self._providers: Dict[str, BaseDocumentProvider] = {}
        # Cache maps cache_key (e.g. "yahoo_news:AAPL") -> (timestamp, List[documents])
        self._cache: Dict[str, tuple[float, List[Dict[str, Any]]]] = {}
        self.cache_ttl = cache_ttl_seconds

    def register(self, provider: BaseDocumentProvider) -> None:
        self._providers[provider.id] = provider
        logger.info("Registered stock document provider: %s (%s)", provider.id, provider.name)

    def unregister(self, provider_id: str) -> Optional[BaseDocumentProvider]:
        provider = self._providers.pop(provider_id, None)
        self.clear_cache(provider_id=provider_id)
        return provider

    def get_provider(self, provider_id: str) -> Optional[BaseDocumentProvider]:
        return self._providers.get(provider_id)

    def list_providers(self) -> List[Dict[str, Any]]:
        return [
            {
                "id": p.id,
                "name": p.name,
                "category": p.category,
                "description": p.description,
                "enabled": p.enabled,
                "read_only": p.read_only,
            }
            for p in self._providers.values()
        ]

    def get_documents_for_symbol(
        self,
        symbol: str,
        category: Optional[str] = None,
        provider_id: Optional[str] = None,
        limit: int = 30,
        bypass_cache: bool = False,
    ) -> List[Dict[str, Any]]:
        sym = (symbol or "").strip().upper()
        if not sym:
            return []

        now = time.time()
        providers_to_query: List[BaseDocumentProvider] = []

        if provider_id:
            p = self.get_provider(provider_id)
            if p and p.enabled:
                providers_to_query.append(p)
        else:
            for p in self._providers.values():
                if not p.enabled:
                    continue
                if not category or category == "all" or p.category == category:
                    providers_to_query.append(p)

        all_docs: List[Dict[str, Any]] = []

        for p in providers_to_query:
            cache_key = f"{p.id}:{sym}"
            cached = self._cache.get(cache_key)

            if not bypass_cache and cached and (now - cached[0] < self.cache_ttl):
                docs = cached[1]
            else:
                try:
                    docs = p.get_documents(sym, limit=limit) or []
                    # Cache only read-only providers to prevent stale user notes
                    if p.read_only:
                        self._cache[cache_key] = (now, docs)
                except Exception as exc:
                    logger.warning("Error fetching documents from provider '%s' for %s: %s", p.id, sym, exc)
                    docs = []

            all_docs.extend(docs)

        # Sort combined documents descending by timestamp (newest first)
        def _doc_sort_key(doc: Dict[str, Any]) -> str:
            ts = doc.get("timestamp")
            if not ts:
                return ""
            return str(ts)

        all_docs.sort(key=_doc_sort_key, reverse=True)
        return all_docs[:limit]

    def clear_cache(self, symbol: Optional[str] = None, provider_id: Optional[str] = None) -> None:
        if not symbol and not provider_id:
            self._cache.clear()
            return

        target_sym = symbol.upper() if symbol else None
        keys_to_del = []
        for k in self._cache:
            p_id, sym = k.split(":", 1) if ":" in k else ("", "")
            match_provider = not provider_id or p_id == provider_id
            match_sym = not target_sym or sym == target_sym
            if match_provider and match_sym:
                keys_to_del.append(k)

        for k in keys_to_del:
            self._cache.pop(k, None)


_registry_instance: Optional[DocumentRegistry] = None


def get_document_registry() -> DocumentRegistry:
    global _registry_instance
    if _registry_instance is None:
        _registry_instance = DocumentRegistry()
        _register_builtin_providers(_registry_instance)
    return _registry_instance


def _register_builtin_providers(registry: DocumentRegistry) -> None:
    try:
        from portfolio.plugins.documents.providers.notes_provider import NotesDocumentProvider
        registry.register(NotesDocumentProvider())
    except Exception as exc:
        logger.warning("Could not register NotesDocumentProvider: %s", exc)

    try:
        from portfolio.plugins.documents.providers.yahoo_news_provider import YahooNewsDocumentProvider
        registry.register(YahooNewsDocumentProvider())
    except Exception as exc:
        logger.warning("Could not register YahooNewsDocumentProvider: %s", exc)

    try:
        from portfolio.plugins.documents.providers.yahoo_insider_provider import YahooInsiderDocumentProvider
        registry.register(YahooInsiderDocumentProvider())
    except Exception as exc:
        logger.warning("Could not register YahooInsiderDocumentProvider: %s", exc)

    try:
        from portfolio.plugins.documents.providers.yahoo_filings_provider import YahooFilingsDocumentProvider
        registry.register(YahooFilingsDocumentProvider())
    except Exception as exc:
        logger.warning("Could not register YahooFilingsDocumentProvider: %s", exc)
