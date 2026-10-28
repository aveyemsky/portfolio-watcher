"""Yahoo SEC Filings Document Provider using yfinance."""
from datetime import date, datetime, timezone
from typing import Any, Dict, List

import yfinance as yf

from portfolio.core.logging import get_logger
from portfolio.plugins.documents.base import BaseDocumentProvider

logger = get_logger(__name__)


class YahooFilingsDocumentProvider(BaseDocumentProvider):
    id: str = "sec_filings"
    name: str = "SEC Filings"
    category: str = "filings"
    description: str = "Official SEC EDGAR periodic reports and filings (10-K, 10-Q, 8-K, Proxy Statements)."
    enabled: bool = True
    read_only: bool = True

    def get_documents(self, symbol: str, limit: int = 25) -> List[Dict[str, Any]]:
        sym = (symbol or "").strip().upper()
        if not sym:
            return []

        try:
            from portfolio.services.stock_data_service import ensure_yfinance_session
            ensure_yfinance_session()
            ticker = yf.Ticker(sym)
            raw_filings = getattr(ticker, "sec_filings", None)
            if not raw_filings or not isinstance(raw_filings, list):
                return []
        except Exception as exc:
            logger.warning("Could not fetch SEC filings for %s: %s", sym, exc)
            return []

        documents: List[Dict[str, Any]] = []

        for idx, item in enumerate(raw_filings[:limit]):
            if not isinstance(item, dict):
                continue

            try:
                filing_type = str(item.get("type") or "Filing").strip()
                title = str(item.get("title") or f"SEC Form {filing_type}").strip()
                edgar_url = item.get("edgarUrl")
                exhibits = item.get("exhibits") or {}

                # Preferred document link: first exhibit URL (direct .htm document) or edgarUrl
                direct_doc_url = None
                if isinstance(exhibits, dict) and exhibits:
                    # Pick the primary form exhibit if present, else first available
                    direct_doc_url = exhibits.get(filing_type) or next(iter(exhibits.values()), None)

                primary_url = direct_doc_url or edgar_url or f"https://www.sec.gov/edgar/searchedgar/companysearch"

                # Parse date
                d_val = item.get("date")
                ts_iso = ""
                date_str = ""
                if isinstance(d_val, (date, datetime)):
                    ts_iso = d_val.strftime("%Y-%m-%dT00:00:00Z")
                    date_str = d_val.strftime("%b %d, %Y")
                elif item.get("epochDate"):
                    try:
                        dt = datetime.fromtimestamp(item["epochDate"], tz=timezone.utc)
                        ts_iso = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                        date_str = dt.strftime("%b %d, %Y")
                    except Exception:
                        pass

                if not ts_iso:
                    ts_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

                summary = f"Official SEC Form {filing_type} filing: {title}"
                if date_str:
                    summary += f" filed on {date_str}."

                documents.append(
                    {
                        "id": f"sec_{sym}_{filing_type}_{idx}_{ts_iso[:10]}",
                        "provider": self.id,
                        "category": self.category,
                        "title": f"SEC Form {filing_type}: {title}",
                        "timestamp": ts_iso,
                        "source": f"SEC Form {filing_type}",
                        "summary": summary,
                        "body": None,
                        "content_type": "filing",
                        "url": primary_url,
                        "metadata": {
                            "filing_type": filing_type,
                            "title": title,
                            "edgar_url": edgar_url,
                            "direct_url": direct_doc_url,
                            "exhibits": exhibits,
                        },
                    }
                )
            except Exception as item_exc:
                logger.debug("Skipping unparseable filing for %s: %s", sym, item_exc)
                continue

        return documents
