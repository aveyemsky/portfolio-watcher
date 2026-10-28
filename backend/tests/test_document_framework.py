"""Tests for Pluggable Stock Document Framework."""
from unittest.mock import MagicMock, patch
import pandas as pd
import pytest
from app import create_app
from portfolio.data.db import db
from portfolio.data.models import Stock, StockNote
from portfolio.plugins.documents.base import BaseDocumentProvider
from portfolio.plugins.documents.providers.yahoo_insider_provider import YahooInsiderDocumentProvider
from portfolio.plugins.documents.providers.yahoo_filings_provider import YahooFilingsDocumentProvider
from portfolio.plugins.documents.registry import DocumentRegistry, get_document_registry
from portfolio.services import document_service


class DummyMockProvider(BaseDocumentProvider):
    id = "dummy_test"
    name = "Dummy Test Provider"
    category = "news"
    description = "Test mock provider"
    enabled = True
    read_only = True

    def get_documents(self, symbol: str, limit: int = 20):
        return [
            {
                "id": f"dummy_{symbol}_1",
                "provider": self.id,
                "category": self.category,
                "title": f"Headline for {symbol}",
                "timestamp": "2026-09-28T12:00:00Z",
                "source": "Dummy Wire",
                "summary": "Sample summary text",
                "body": None,
                "content_type": "link",
                "url": "https://example.com/news/1",
                "metadata": {},
            }
        ]


@pytest.fixture
def test_app():
    app = create_app()
    app.config["TESTING"] = True
    with app.app_context():
        # Ensure AAPL stock exists in master for route checks
        aapl = Stock.query.filter_by(symbol="AAPL").first()
        if not aapl:
            aapl = Stock(symbol="AAPL", name="Apple Inc.", sector="Technology")
            db.session.add(aapl)
            db.session.commit()
        yield app


def test_registry_register_and_list():
    reg = DocumentRegistry(cache_ttl_seconds=60)
    provider = DummyMockProvider()
    reg.register(provider)

    providers = reg.list_providers()
    assert any(p["id"] == "dummy_test" for p in providers)
    assert reg.get_provider("dummy_test") == provider


def test_registry_caching_and_filter():
    reg = DocumentRegistry(cache_ttl_seconds=60)
    provider = DummyMockProvider()
    reg.register(provider)

    docs = reg.get_documents_for_symbol("AAPL")
    assert len(docs) == 1
    assert docs[0]["title"] == "Headline for AAPL"

    # Category filtering
    assert len(reg.get_documents_for_symbol("AAPL", category="news")) == 1
    assert len(reg.get_documents_for_symbol("AAPL", category="insider")) == 0

    # Provider filtering
    assert len(reg.get_documents_for_symbol("AAPL", provider_id="dummy_test")) == 1
    assert len(reg.get_documents_for_symbol("AAPL", provider_id="nonexistent")) == 0


def test_notes_provider_crud(test_app):
    with test_app.app_context():
        # Clean any old test notes
        StockNote.query.filter_by(symbol="AAPL").delete()
        db.session.commit()

        # Create note
        payload = {"title": "Investment Thesis", "content": "## Bull Case\n- Great products"}
        doc = document_service.save_stock_note("AAPL", payload)
        assert doc["id"].startswith("note_")
        assert doc["title"] == "Investment Thesis"
        assert "Great products" in doc["body"]

        # Fetch notes via get_stock_documents
        docs = document_service.get_stock_documents("AAPL", category="notes")
        assert len(docs) >= 1
        note_doc = next(d for d in docs if d["title"] == "Investment Thesis")
        assert note_doc["content_type"] == "markdown"

        # Update note
        update_payload = {"id": doc["id"], "title": "Updated Thesis", "content": "Updated content"}
        updated = document_service.save_stock_note("AAPL", update_payload)
        assert updated["title"] == "Updated Thesis"

        # Delete note
        deleted = document_service.delete_stock_note("AAPL", doc["id"])
        assert deleted is True

        remaining = document_service.get_stock_documents("AAPL", category="notes")
        assert not any(d["id"] == doc["id"] for d in remaining)


def test_yahoo_insider_provider():
    provider = YahooInsiderDocumentProvider()
    sample_df = pd.DataFrame([
        {
            "Insider": "COOK TIMOTHY D",
            "Position": "Chief Executive Officer",
            "Shares": 50000,
            "Value": 11500000.0,
            "Text": "Sale at price 230.00 per share.",
            "Transaction": "Sale",
            "Start Date": pd.Timestamp("2026-09-20 00:00:00"),
            "URL": "https://example.com/form4",
            "Ownership": "D",
        }
    ])

    with patch("yfinance.Ticker") as mock_ticker:
        mock_instance = MagicMock()
        mock_instance.insider_transactions = sample_df
        mock_ticker.return_value = mock_instance

        docs = provider.get_documents("AAPL")
        assert len(docs) == 1
        doc = docs[0]
        assert doc["provider"] == "insider_activity"
        assert doc["category"] == "insider"
        assert "COOK TIMOTHY D" in doc["title"]
        assert "sold" in doc["title"]
        assert doc["metadata"]["shares"] == 50000
        assert doc["metadata"]["price"] == 230.0
        assert doc["url"] == "https://example.com/form4"


def test_yahoo_filings_provider():
    provider = YahooFilingsDocumentProvider()
    sample_filings = [
        {
            "type": "10-Q",
            "title": "Quarterly Report",
            "date": pd.Timestamp("2026-08-01 00:00:00"),
            "epochDate": 1785542400,
            "edgarUrl": "https://finance.yahoo.com/sec-filing/AAPL/10Q",
            "exhibits": {"10-Q": "https://cdn.example.com/10q.htm"},
        }
    ]

    with patch("yfinance.Ticker") as mock_ticker:
        mock_instance = MagicMock()
        mock_instance.sec_filings = sample_filings
        mock_ticker.return_value = mock_instance

        docs = provider.get_documents("AAPL")
        assert len(docs) == 1
        doc = docs[0]
        assert doc["provider"] == "sec_filings"
        assert doc["category"] == "filings"
        assert "10-Q" in doc["title"]
        assert doc["url"] == "https://cdn.example.com/10q.htm"
        assert doc["metadata"]["filing_type"] == "10-Q"


def test_document_api_endpoints(test_app):
    client = test_app.test_client()

    # Providers endpoint
    res = client.get("/api/portfolio/documents/providers")
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "success"
    provider_ids = [p["id"] for p in data["data"]]
    assert "notes" in provider_ids
    assert "yahoo_news" in provider_ids
    assert "insider_activity" in provider_ids
    assert "sec_filings" in provider_ids

    # Stock documents endpoint with mock to avoid external network latency
    with patch.object(document_service, "get_stock_documents", return_value=[{"id": "doc1", "title": "Test"}]):
        res = client.get("/api/portfolio/stocks/AAPL/documents")
        assert res.status_code == 200
        docs_data = res.get_json()
        assert docs_data["status"] == "success"
        assert len(docs_data["data"]) == 1

    # 404 for unknown stock
    res_404 = client.get("/api/portfolio/stocks/UNKNOWN999XYZ/documents")
    assert res_404.status_code == 404
