"""Yahoo News & Real-Time Financial Feed Document Provider.

Fetches real-time market headlines, press releases, and articles via
Yahoo Finance RSS with resilient fallback to Google News Financial RSS.
"""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import html
import re
from typing import Any, Dict, List
import urllib.request
import xml.etree.ElementTree as ET

import yfinance as yf

from portfolio.core.logging import get_logger
from portfolio.plugins.documents.base import BaseDocumentProvider

logger = get_logger(__name__)

USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
HTTP_TIMEOUT = 5  # seconds


def _get_ssl_context():
    try:
        import certifi
        import ssl
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return None


def _clean_text(raw: str) -> str:
    """Strip HTML markup and unescape XML/HTML entities."""
    if not raw:
        return ""
    cleaned = re.sub(r"<[^>]+>", "", raw)
    return html.unescape(cleaned).strip()


def _parse_pub_date(pub_date_str: str) -> str:
    """Parse RFC 2822 pubDate string to ISO 8601 UTC timestamp."""
    if not pub_date_str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    try:
        dt = parsedate_to_datetime(pub_date_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class YahooNewsDocumentProvider(BaseDocumentProvider):
    id: str = "yahoo_news"
    name: str = "Yahoo Finance News"
    category: str = "news"
    description: str = "Real-time news stories, press releases, and analyst coverage via Yahoo Finance & Financial Wire."
    enabled: bool = True
    read_only: bool = True

    def get_documents(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        sym = (symbol or "").strip().upper()
        if not sym:
            return []

        # 1. Fetch from direct Yahoo Finance RSS feed
        documents = self._fetch_yahoo_rss(sym, limit=limit)

        # 2. If Yahoo RSS returns few or no items, fallback / supplement with Google News Financial RSS
        if len(documents) < 3:
            google_docs = self._fetch_google_rss(sym, limit=limit - len(documents))
            # Merge and deduplicate by title
            existing_titles = {d["title"].lower() for d in documents}
            for gdoc in google_docs:
                if gdoc["title"].lower() not in existing_titles:
                    documents.append(gdoc)
                    existing_titles.add(gdoc["title"].lower())

        # 3. Fallback to yfinance ticker.news if both RSS feeds returned empty
        if not documents:
            documents = self._fetch_yfinance_news(sym, limit=limit)

        return documents[:limit]

    def _fetch_yahoo_rss(self, sym: str, limit: int = 20) -> List[Dict[str, Any]]:
        url = f"https://finance.yahoo.com/rss/headline?s={sym}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT, context=_get_ssl_context()) as resp:
                xml_content = resp.read()
            root = ET.fromstring(xml_content)
        except Exception as exc:
            logger.debug("Could not fetch Yahoo RSS for %s: %s", sym, exc)
            return []

        items = root.findall("./channel/item")
        documents = []

        for idx, item in enumerate(items[:limit]):
            title = _clean_text(item.findtext("title") or "Market News")
            link = item.findtext("link") or ""
            guid = item.findtext("guid") or f"{sym}_{idx}"
            pub_date = item.findtext("pubDate") or ""
            desc = _clean_text(item.findtext("description") or title)

            ts_iso = _parse_pub_date(pub_date)

            # Detect specific publisher from text snippet if available
            source = "Yahoo Finance"
            for known in (
                "GLOBE NEWSWIRE",
                "PR Newswire",
                "Business Wire",
                "Reuters",
                "Bloomberg",
                "MarketWatch",
                "Barrons",
                "Benzinga",
                "The Wall Street Journal",
                "CNBC",
                "Seeking Alpha",
                "InvestorPlace",
                "Motley Fool",
            ):
                if known.lower() in desc.lower() or known.lower() in title.lower():
                    source = known
                    break

            documents.append(
                {
                    "id": f"ynews_{guid}",
                    "provider": self.id,
                    "category": self.category,
                    "title": title,
                    "timestamp": ts_iso,
                    "source": source,
                    "summary": desc,
                    "body": None,
                    "content_type": "link",
                    "url": link,
                    "metadata": {
                        "thumbnail": None,
                        "related_tickers": [sym],
                        "story_type": "STORY",
                    },
                }
            )

        return documents

    def _fetch_google_rss(self, sym: str, limit: int = 20) -> List[Dict[str, Any]]:
        url = f"https://news.google.com/rss/search?q={sym}+stock&hl=en-US&gl=US&ceid=US:en"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT, context=_get_ssl_context()) as resp:
                xml_content = resp.read()
            root = ET.fromstring(xml_content)
        except Exception as exc:
            logger.debug("Could not fetch Google News RSS for %s: %s", sym, exc)
            return []

        items = root.findall("./channel/item")
        documents = []

        for idx, item in enumerate(items[:limit]):
            title = _clean_text(item.findtext("title") or "Market News")
            link = item.findtext("link") or ""
            guid = item.findtext("guid") or f"g_{sym}_{idx}"
            pub_date = item.findtext("pubDate") or ""
            desc = _clean_text(item.findtext("description") or title)

            src_elem = item.find("source")
            source = _clean_text(src_elem.text) if src_elem is not None and src_elem.text else "Market News"

            ts_iso = _parse_pub_date(pub_date)

            documents.append(
                {
                    "id": f"ynews_{guid}",
                    "provider": self.id,
                    "category": self.category,
                    "title": title,
                    "timestamp": ts_iso,
                    "source": source,
                    "summary": desc,
                    "body": None,
                    "content_type": "link",
                    "url": link,
                    "metadata": {
                        "thumbnail": None,
                        "related_tickers": [sym],
                        "story_type": "STORY",
                    },
                }
            )

        return documents

    def _fetch_yfinance_news(self, sym: str, limit: int = 20) -> List[Dict[str, Any]]:
        try:
            from portfolio.services.stock_data_service import ensure_yfinance_session
            ensure_yfinance_session()
            ticker = yf.Ticker(sym)
            raw_news = getattr(ticker, "news", None)
            if not raw_news or not isinstance(raw_news, list):
                return []
        except Exception as exc:
            logger.warning("Could not fetch yfinance news for %s: %s", sym, exc)
            return []

        documents = []
        for idx, item in enumerate(raw_news[:limit]):
            if not isinstance(item, dict):
                continue

            uuid = item.get("uuid") or f"{sym}_{idx}"
            title = item.get("title") or "Market News"
            publisher = item.get("publisher") or "Yahoo Finance"
            link = item.get("link")

            publish_time = item.get("providerPublishTime")
            if publish_time and isinstance(publish_time, (int, float)):
                ts_dt = datetime.fromtimestamp(publish_time, tz=timezone.utc)
                ts_iso = ts_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
            else:
                ts_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

            thumbnail_url = None
            thumb = item.get("thumbnail")
            if isinstance(thumb, dict):
                resolutions = thumb.get("resolutions")
                if isinstance(resolutions, list) and len(resolutions) > 0:
                    thumbnail_url = resolutions[0].get("url")

            summary = item.get("summary") or title

            documents.append(
                {
                    "id": f"ynews_{uuid}",
                    "provider": self.id,
                    "category": self.category,
                    "title": title,
                    "timestamp": ts_iso,
                    "source": publisher,
                    "summary": summary,
                    "body": None,
                    "content_type": "link",
                    "url": link,
                    "metadata": {
                        "thumbnail": thumbnail_url,
                        "related_tickers": item.get("relatedTickers", []),
                        "story_type": item.get("type", "STORY"),
                    },
                }
            )

        return documents
