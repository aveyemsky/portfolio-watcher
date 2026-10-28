"""Pluggable Stock Document Framework."""
from portfolio.plugins.documents.base import BaseDocumentProvider
from portfolio.plugins.documents.registry import DocumentRegistry, get_document_registry

__all__ = ["BaseDocumentProvider", "DocumentRegistry", "get_document_registry"]
