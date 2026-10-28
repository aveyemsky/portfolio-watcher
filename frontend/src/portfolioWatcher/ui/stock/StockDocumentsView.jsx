import React, { useEffect, useState, useMemo } from "react";
import {
  fetchStockDocuments,
  fetchDocumentProviders,
  saveStockNote,
  deleteStockNote
} from "../../api/portfolioApi";
import { ConfirmDialog } from "../shared/ModalDialog";

function formatRelativeTime(isoString) {
  if (!isoString) return "";
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);
    if (diffSec < 60) return "just now";
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return isoString;
  }
}

function SimpleMarkdown({ content }) {
  if (!content) return null;
  const lines = content.split("\n");

  return (
    <div className="pw-markdown-body">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="pw-markdown-spacer" />;
        }
        if (trimmed.startsWith("### ")) {
          return <h5 key={idx} className="pw-markdown-h3">{trimmed.replace(/^###\s+/, "")}</h5>;
        }
        if (trimmed.startsWith("## ")) {
          return <h4 key={idx} className="pw-markdown-h2">{trimmed.replace(/^##\s+/, "")}</h4>;
        }
        if (trimmed.startsWith("# ")) {
          return <h3 key={idx} className="pw-markdown-h1">{trimmed.replace(/^#\s+/, "")}</h3>;
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          const itemText = trimmed.replace(/^[-*]\s+/, "");
          return (
            <li key={idx} className="pw-markdown-li">
              {renderFormattedInline(itemText)}
            </li>
          );
        }
        return (
          <p key={idx} className="pw-markdown-p">
            {renderFormattedInline(line)}
          </p>
        );
      })}
    </div>
  );
}

function renderFormattedInline(text) {
  // Simple regex for **bold** and `code`
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
    const codeMatch = remaining.match(/`(.*?)`/);

    let nextMatch = null;
    let type = null;

    if (boldMatch && (!codeMatch || boldMatch.index < codeMatch.index)) {
      nextMatch = boldMatch;
      type = "bold";
    } else if (codeMatch) {
      nextMatch = codeMatch;
      type = "code";
    }

    if (!nextMatch) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    if (nextMatch.index > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, nextMatch.index)}</span>);
    }

    if (type === "bold") {
      parts.push(<strong key={key++}>{nextMatch[1]}</strong>);
    } else if (type === "code") {
      parts.push(<code key={key++} className="pw-markdown-inline-code">{nextMatch[1]}</code>);
    }

    remaining = remaining.slice(nextMatch.index + nextMatch[0].length);
  }

  return parts;
}

export default function StockDocumentsView({
  apiBaseUrl,
  readOnly = false,
  stock,
}) {
  const symbol = stock?.symbol;
  const [documents, setDocuments] = useState([]);
  const [providers, setProviders] = useState([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Note composer state
  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Load available providers once
  useEffect(() => {
    let isMounted = true;
    fetchDocumentProviders(apiBaseUrl)
      .then((res) => {
        if (isMounted && res?.data) {
          setProviders(res.data);
        }
      })
      .catch((err) => {
        console.warn("Could not load document providers:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl]);

  // Reset composer if active stock changes
  useEffect(() => {
    setIsComposerOpen(false);
    setEditingNoteId(null);
    setNoteTitle("");
    setNoteContent("");
  }, [symbol]);

  // Load documents for current symbol & category
  const loadDocuments = async (bypassCache = false) => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchStockDocuments(apiBaseUrl, symbol, {
        category: activeCategory,
        refresh: bypassCache
      });
      setDocuments(res?.data || []);
    } catch (err) {
      setError(err?.message || "Failed to load documents");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let isCurrent = true;
    if (!symbol) {
      setDocuments([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    fetchStockDocuments(apiBaseUrl, symbol, {
      category: activeCategory,
      refresh: false
    })
      .then((res) => {
        if (isCurrent) {
          setDocuments(res?.data || []);
        }
      })
      .catch((err) => {
        if (isCurrent) {
          setError(err?.message || "Failed to load documents");
        }
      })
      .finally(() => {
        if (isCurrent) {
          setLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [apiBaseUrl, symbol, activeCategory]);

  const handleOpenNewNote = () => {
    setEditingNoteId(null);
    setNoteTitle("");
    setNoteContent("");
    setIsComposerOpen(true);
  };

  const handleEditNote = (doc) => {
    setEditingNoteId(doc.metadata?.note_id || doc.id);
    setNoteTitle(doc.title || "");
    setNoteContent(doc.body || "");
    setIsComposerOpen(true);
  };

  const handleSaveNote = async (e) => {
    e.preventDefault();
    if (!symbol || !noteContent.trim()) return;
    setSavingNote(true);
    try {
      await saveStockNote(apiBaseUrl, symbol, {
        id: editingNoteId,
        title: noteTitle.trim(),
        content: noteContent.trim()
      });
      setIsComposerOpen(false);
      setEditingNoteId(null);
      setNoteTitle("");
      setNoteContent("");
      await loadDocuments(true);
    } catch (err) {
      alert(err?.message || "Failed to save note");
    } finally {
      setSavingNote(false);
    }
  };

  const [noteToDelete, setNoteToDelete] = useState(null);
  const [isDeletingNote, setIsDeletingNote] = useState(false);

  const handleDeleteNote = (doc) => {
    setNoteToDelete(doc);
  };

  const handleConfirmDeleteNote = async () => {
    if (!noteToDelete) return;
    const noteId = noteToDelete.metadata?.note_id || noteToDelete.id;
    setIsDeletingNote(true);
    try {
      await deleteStockNote(apiBaseUrl, symbol, noteId);
      setNoteToDelete(null);
      await loadDocuments(true);
    } catch (err) {
      alert(err?.message || "Failed to delete note");
    } finally {
      setIsDeletingNote(false);
    }
  };

  const categories = [
    { id: "all", label: "All Intel" },
    { id: "notes", label: "My Notes" },
    { id: "news", label: "News" },
    { id: "insider", label: "Insider Trades" },
    { id: "filings", label: "SEC Filings" }
  ];

  return (
    <div className="pw-docs-view">
      {/* Top Filter and Actions Strip */}
      <div className="pw-docs-header">
        <div className="pw-docs-filter-group">
          {categories.map((cat) => (
            <button
              key={cat.id}
              className={`pw-docs-filter-btn ${activeCategory === cat.id ? "active" : ""}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="pw-docs-actions">
          {!readOnly && (
            <button
              className="pw-docs-btn pw-docs-btn-primary"
              onClick={handleOpenNewNote}
              title="Add personal research note"
            >
              + Add Note
            </button>
          )}
          <button
            className="pw-docs-btn pw-docs-btn-icon"
            onClick={() => loadDocuments(true)}
            disabled={loading}
            title="Refresh intel feeds"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Note Composer Modal/Panel */}
      {isComposerOpen && (
        <div className="pw-docs-composer">
          <div className="pw-docs-composer-header">
            <h4>{editingNoteId ? "Edit Research Note" : "New Research Note"} ({symbol})</h4>
            <button
              type="button"
              className="pw-docs-close-btn"
              onClick={() => setIsComposerOpen(false)}
            >
              ✕
            </button>
          </div>
          <form onSubmit={handleSaveNote}>
            <input
              type="text"
              className="pw-docs-input"
              placeholder="Note title (e.g. Valuation thesis, Q3 earnings recap)"
              value={noteTitle}
              onChange={(e) => setNoteTitle(e.target.value)}
            />
            <textarea
              className="pw-docs-textarea"
              placeholder="Write your research notes in Markdown... (e.g. # Thesis, - Bull point, - Risk)"
              rows={6}
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
              required
            />
            <div className="pw-docs-composer-footer">
              <button
                type="button"
                className="pw-docs-btn pw-docs-btn-subtle"
                onClick={() => setIsComposerOpen(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pw-docs-btn pw-docs-btn-primary"
                disabled={savingNote || !noteContent.trim()}
              >
                {savingNote ? "Saving..." : "Save Note"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Loading & Error States */}
      {loading && (
        <div className="pw-docs-loading">
          <div className="pw-spinner" />
          <span>Fetching intel & documents...</span>
        </div>
      )}

      {error && !loading && (
        <div className="pw-docs-error">
          <span>⚠️ {error}</span>
          <button className="pw-docs-btn pw-docs-btn-subtle" onClick={() => loadDocuments(true)}>
            Retry
          </button>
        </div>
      )}

      {/* Document Feed Cards */}
      {!loading && !error && documents.length === 0 && (
        <div className="pw-docs-empty">
          <div className="pw-docs-empty-icon">📑</div>
          <div className="pw-docs-empty-title">No documents found</div>
          <p className="pw-docs-empty-desc">
            {activeCategory === "notes"
              ? "You haven't added any notes for this stock yet. Click '+ Add Note' to write your first thesis."
              : "No feeds available for this filter. Customize your own providers in the pluggable document framework."}
          </p>
        </div>
      )}

      {!loading && !error && documents.length > 0 && (
        <div className="pw-docs-list">
          {documents.map((doc) => {
            if (doc.category === "notes") {
              return (
                <div key={doc.id} className="pw-doc-card pw-doc-card--note">
                  <div className="pw-doc-card-header">
                    <div className="pw-doc-badge pw-doc-badge--note">{doc.source || "Note"}</div>
                    <span className="pw-doc-time">{formatRelativeTime(doc.timestamp)}</span>
                    {!readOnly && (
                      <div className="pw-doc-card-tools">
                        <button
                          className="pw-doc-tool-btn"
                          onClick={() => handleEditNote(doc)}
                          title="Edit note"
                        >
                          ✎
                        </button>
                        <button
                          className="pw-doc-tool-btn pw-doc-tool-btn--danger"
                          onClick={() => handleDeleteNote(doc)}
                          title="Delete note"
                        >
                          🗑
                        </button>
                      </div>
                    )}
                  </div>
                  <h4 className="pw-doc-card-title">{doc.title}</h4>
                  <div className="pw-doc-card-body">
                    <SimpleMarkdown content={doc.body || doc.summary} />
                  </div>
                </div>
              );
            }

            if (doc.category === "insider" && doc.content_type === "table") {
              const meta = doc.metadata || {};
              const isBuy = (meta.transaction_type || "").toLowerCase().includes("buy") ||
                            (meta.transaction_type || "").toLowerCase().includes("purchase");
              return (
                <div key={doc.id} className="pw-doc-card pw-doc-card--insider">
                  <div className="pw-doc-card-header">
                    <div className={`pw-doc-badge ${isBuy ? "pw-doc-badge--buy" : "pw-doc-badge--sale"}`}>
                      {meta.transaction_type || "Insider Trade"}
                    </div>
                    <span className="pw-doc-time">{formatRelativeTime(doc.timestamp)}</span>
                    <span className="pw-doc-source-tag">{doc.source}</span>
                  </div>
                  <h4 className="pw-doc-card-title">{doc.title}</h4>
                  <div className="pw-insider-grid">
                    <div className="pw-insider-item">
                      <span className="pw-insider-label">Insider</span>
                      <span className="pw-insider-val">{meta.insider_name || "—"}</span>
                    </div>
                    <div className="pw-insider-item">
                      <span className="pw-insider-label">Title</span>
                      <span className="pw-insider-val">{meta.position || "—"}</span>
                    </div>
                    <div className="pw-insider-item">
                      <span className="pw-insider-label">Shares</span>
                      <span className="pw-insider-val">
                        {meta.shares ? Number(meta.shares).toLocaleString() : "—"}
                      </span>
                    </div>
                    <div className="pw-insider-item">
                      <span className="pw-insider-label">Price / Val</span>
                      <span className="pw-insider-val">
                        {meta.price ? `$${Number(meta.price).toFixed(2)}` : "—"}
                        {meta.total_value ? ` ($${(meta.total_value / 1e3).toFixed(1)}k)` : ""}
                      </span>
                    </div>
                  </div>
                  {doc.url && (
                    <div className="pw-doc-card-footer">
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="pw-doc-link-btn"
                      >
                        View Official Filing ↗
                      </a>
                    </div>
                  )}
                </div>
              );
            }

            if (doc.category === "filings") {
              const meta = doc.metadata || {};
              const filingType = meta.filing_type || "Filing";
              return (
                <div key={doc.id} className="pw-doc-card pw-doc-card--filing">
                  <div className="pw-doc-card-header">
                    <div className="pw-doc-badge pw-doc-badge--filing">{filingType}</div>
                    <span className="pw-doc-time">{formatRelativeTime(doc.timestamp)}</span>
                    <span className="pw-doc-source-tag">{doc.source}</span>
                  </div>
                  <h4 className="pw-doc-card-title">
                    {doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="pw-doc-title-link"
                      >
                        {doc.title} ↗
                      </a>
                    ) : (
                      doc.title
                    )}
                  </h4>
                  {doc.summary && <p className="pw-doc-card-snippet">{doc.summary}</p>}
                  <div className="pw-doc-card-footer">
                    {doc.url && (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="pw-doc-link-btn"
                      >
                        Open Document (.htm) ↗
                      </a>
                    )}
                    {meta.edgar_url && meta.edgar_url !== doc.url && (
                      <a
                        href={meta.edgar_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="pw-doc-read-more"
                        style={{ marginLeft: "8px" }}
                      >
                        EDGAR Page ↗
                      </a>
                    )}
                  </div>
                </div>
              );
            }

            // Default News / Article Card
            return (
              <div key={doc.id} className="pw-doc-card pw-doc-card--news">
                <div className="pw-doc-card-header">
                  <div className="pw-doc-badge pw-doc-badge--news">{doc.source || "News"}</div>
                  <span className="pw-doc-time">{formatRelativeTime(doc.timestamp)}</span>
                </div>
                <h4 className="pw-doc-card-title">
                  {doc.url ? (
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="pw-doc-title-link"
                    >
                      {doc.title} ↗
                    </a>
                  ) : (
                    doc.title
                  )}
                </h4>
                {doc.summary && <p className="pw-doc-card-snippet">{doc.summary}</p>}
                {doc.url && (
                  <div className="pw-doc-card-footer">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="pw-doc-read-more"
                    >
                      Read on {doc.source} →
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {noteToDelete && (
        <ConfirmDialog
          isOpen={Boolean(noteToDelete)}
          title="Delete Research Note"
          message={`Are you sure you want to delete "${noteToDelete.title || "this note"}"? This action cannot be undone.`}
          confirmLabel="Delete Note"
          cancelLabel="Cancel"
          isDanger={true}
          isSubmitting={isDeletingNote}
          onConfirm={handleConfirmDeleteNote}
          onCancel={() => setNoteToDelete(null)}
        />
      )}
    </div>
  );
}
