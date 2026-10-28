"""Personal Stock Notes Document Provider."""
from datetime import datetime
from typing import Any, Dict, List

from portfolio.core.logging import get_logger
from portfolio.data.db import db
from portfolio.data.models import StockNote
from portfolio.plugins.documents.base import BaseDocumentProvider

logger = get_logger(__name__)


class NotesDocumentProvider(BaseDocumentProvider):
    id: str = "notes"
    name: str = "My Research Notes"
    category: str = "notes"
    description: str = "Personal stock investment thesis, earnings notes, and markdown research."
    enabled: bool = True
    read_only: bool = False

    def get_documents(self, symbol: str, limit: int = 20) -> List[Dict[str, Any]]:
        sym = (symbol or "").strip().upper()
        if not sym:
            return []

        try:
            notes = (
                StockNote.query.filter_by(symbol=sym)
                .order_by(StockNote.updated_at.desc())
                .limit(limit)
                .all()
            )
        except Exception as exc:
            logger.warning("Could not query StockNotes for %s: %s", sym, exc)
            return []

        documents = []
        for n in notes:
            ts = (n.updated_at or n.created_at or datetime.utcnow()).isoformat() + "Z"
            # Extract first 150 chars as preview summary
            summary = n.content.strip()[:160] if n.content else ""
            if len(n.content or "") > 160:
                summary += "..."

            documents.append(
                {
                    "id": f"note_{n.id}",
                    "provider": self.id,
                    "category": self.category,
                    "title": n.title or f"{sym} Research Note",
                    "timestamp": ts,
                    "source": "Personal Notes",
                    "summary": summary,
                    "body": n.content or "",
                    "content_type": "markdown",
                    "url": None,
                    "metadata": {
                        "note_id": n.id,
                        "created_at": (n.created_at or datetime.utcnow()).isoformat() + "Z",
                        "updated_at": ts,
                    },
                }
            )
        return documents

    def save_document(self, symbol: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        sym = (symbol or "").strip().upper()
        if not sym:
            raise ValueError("Stock symbol is required.")

        note_id = payload.get("id") or payload.get("note_id")
        title = (payload.get("title") or "").strip()
        content = (payload.get("content") or payload.get("body") or "").strip()

        if note_id:
            try:
                numeric_id = int(str(note_id).replace("note_", ""))
            except ValueError:
                numeric_id = None
            note = StockNote.query.filter_by(id=numeric_id, symbol=sym).first() if numeric_id else None
            if note:
                note.title = title or note.title
                note.content = content
                note.updated_at = datetime.utcnow()
                db.session.commit()
                return self._serialize_note(note)

        if not note_id and payload.get("upsert_same_title"):
            today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            note_title = title or f"{sym} Note"
            existing = (
                StockNote.query.filter(
                    StockNote.symbol == sym,
                    StockNote.title == note_title,
                    StockNote.created_at >= today_start,
                )
                .order_by(StockNote.updated_at.desc())
                .first()
            )
            if existing:
                existing.content = content
                existing.updated_at = datetime.utcnow()
                db.session.commit()
                return self._serialize_note(existing)

        # Create new note
        note = StockNote(
            symbol=sym,
            title=title or f"{sym} Note",
            content=content,
        )
        db.session.add(note)
        db.session.commit()
        return self._serialize_note(note)

    def delete_document(self, symbol: str, doc_id: str) -> bool:
        sym = (symbol or "").strip().upper()
        try:
            numeric_id = int(str(doc_id).replace("note_", ""))
        except ValueError:
            return False

        note = StockNote.query.filter_by(id=numeric_id, symbol=sym).first()
        if not note:
            return False

        db.session.delete(note)
        db.session.commit()
        return True

    def _serialize_note(self, n: StockNote) -> Dict[str, Any]:
        ts = (n.updated_at or n.created_at or datetime.utcnow()).isoformat() + "Z"
        summary = n.content.strip()[:160] if n.content else ""
        if len(n.content or "") > 160:
            summary += "..."
        return {
            "id": f"note_{n.id}",
            "provider": self.id,
            "category": self.category,
            "title": n.title or f"{n.symbol} Research Note",
            "timestamp": ts,
            "source": "Personal Notes",
            "summary": summary,
            "body": n.content or "",
            "content_type": "markdown",
            "url": None,
            "metadata": {
                "note_id": n.id,
                "created_at": (n.created_at or datetime.utcnow()).isoformat() + "Z",
                "updated_at": ts,
            },
        }
