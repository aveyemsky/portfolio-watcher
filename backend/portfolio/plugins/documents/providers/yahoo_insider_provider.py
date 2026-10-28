"""Yahoo Insider Transactions Document Provider using yfinance."""
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List

import pandas as pd
import yfinance as yf

from portfolio.core.logging import get_logger
from portfolio.plugins.documents.base import BaseDocumentProvider

logger = get_logger(__name__)


class YahooInsiderDocumentProvider(BaseDocumentProvider):
    id: str = "insider_activity"
    name: str = "Insider Transactions"
    category: str = "insider"
    description: str = "Live SEC Form 4 insider transactions, officer/director purchases and sales."
    enabled: bool = True
    read_only: bool = True

    def get_documents(self, symbol: str, limit: int = 30) -> List[Dict[str, Any]]:
        sym = (symbol or "").strip().upper()
        if not sym:
            return []

        try:
            from portfolio.services.stock_data_service import ensure_yfinance_session
            ensure_yfinance_session()
            ticker = yf.Ticker(sym)
            df = getattr(ticker, "insider_transactions", None)
            if df is None or not isinstance(df, pd.DataFrame) or df.empty:
                return []
        except Exception as exc:
            logger.warning("Could not fetch insider transactions for %s: %s", sym, exc)
            return []

        documents: List[Dict[str, Any]] = []
        default_filing_url = f"https://finance.yahoo.com/quote/{sym}/insider-transactions"

        for idx, row in df.head(limit).iterrows():
            try:
                insider_raw = row.get("Insider")
                insider = str(insider_raw).strip() if pd.notna(insider_raw) else "Insider"
                position_raw = row.get("Position")
                position = str(position_raw).strip() if pd.notna(position_raw) else "Officer / Director"

                # Shares
                shares_val = row.get("Shares")
                shares = 0
                if pd.notna(shares_val):
                    try:
                        shares = int(shares_val)
                    except (ValueError, TypeError):
                        shares = 0

                # Value
                val_raw = row.get("Value")
                total_val = None
                if pd.notna(val_raw) and not math.isnan(float(val_raw)):
                    total_val = float(val_raw)

                # Text / description
                text_raw = str(row.get("Text") or "").strip()
                tx_raw = str(row.get("Transaction") or "").strip()

                # Action and Price inference
                action = "Transaction"
                price = None
                if text_raw:
                    if "sale" in text_raw.lower():
                        action = "Sale"
                    elif "purchase" in text_raw.lower() or "buy" in text_raw.lower():
                        action = "Purchase"
                    elif "grant" in text_raw.lower() or "award" in text_raw.lower():
                        action = "Grant / Award"
                    elif "exercise" in text_raw.lower():
                        action = "Option Exercise"

                    price_match = re.search(r"price\s+([\d,.]+)", text_raw, re.IGNORECASE)
                    if price_match:
                        try:
                            price = float(price_match.group(1).replace(",", ""))
                        except ValueError:
                            pass
                elif tx_raw:
                    action = tx_raw

                if price is None and total_val and shares > 0:
                    price = round(total_val / shares, 2)
                elif total_val is None and price and shares > 0:
                    total_val = round(shares * price, 2)

                # Date parsing
                start_date = row.get("Start Date")
                ts_iso = ""
                if pd.notna(start_date):
                    if isinstance(start_date, (datetime, pd.Timestamp)):
                        ts_iso = start_date.strftime("%Y-%m-%dT00:00:00Z")
                    else:
                        ts_iso = str(start_date)
                if not ts_iso:
                    ts_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT00:00:00Z")

                # Action verb for readable title
                verb = "traded"
                if "sale" in action.lower():
                    verb = "sold"
                elif "purchase" in action.lower() or "buy" in action.lower():
                    verb = "bought"
                elif "grant" in action.lower() or "award" in action.lower():
                    verb = "acquired"

                shares_str = f"{shares:,} shares" if shares > 0 else "shares"
                title = f"{insider} ({position}) {verb} {shares_str}"

                # URL
                url_raw = str(row.get("URL") or "").strip()
                doc_url = url_raw if (url_raw.startswith("http://") or url_raw.startswith("https://")) else default_filing_url

                # Summary
                if text_raw:
                    summary = text_raw
                else:
                    price_str = f" at ${price:.2f}" if price else ""
                    summary = f"{action} of {shares_str}{price_str} by {insider} ({position})."

                documents.append(
                    {
                        "id": f"insider_{sym}_{idx}_{ts_iso[:10]}",
                        "provider": self.id,
                        "category": self.category,
                        "title": title,
                        "timestamp": ts_iso,
                        "source": "SEC Form 4",
                        "summary": summary,
                        "body": None,
                        "content_type": "table",
                        "url": doc_url,
                        "metadata": {
                            "insider_name": insider,
                            "position": position,
                            "transaction_type": action,
                            "shares": shares,
                            "price": price,
                            "total_value": total_val,
                            "raw_text": text_raw,
                        },
                    }
                )
            except Exception as row_exc:
                logger.debug("Skipping unparseable insider row for %s: %s", sym, row_exc)
                continue

        return documents
