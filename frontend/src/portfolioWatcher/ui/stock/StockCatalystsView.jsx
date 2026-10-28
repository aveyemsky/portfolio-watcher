import React, { useEffect, useState, useMemo } from "react";
import { fetchStockCatalysts } from "../../api/portfolioApi";

function formatCurrency(val) {
  if (!val && val !== 0) return "$0";
  const num = Number(val);
  if (num >= 1000000000) return `$${(num / 1000000000).toFixed(2)}B`;
  if (num >= 1000000) return `$${(num / 1000000).toFixed(2)}M`;
  if (num >= 1000) return `$${(num / 1000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function formatDate(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return isoStr.slice(0, 10);
  }
}

export default function StockCatalystsView({ apiBaseUrl, stock }) {
  const symbol = stock?.symbol || "";
  const companyName = stock?.name || symbol;

  const [catalysts, setCatalysts] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchFilter, setSearchFilter] = useState("");

  const loadCatalysts = async (bypassCache = false) => {
    if (!symbol) return;
    setIsLoading(true);
    setError(null);
    try {
      const resp = await fetchStockCatalysts(apiBaseUrl, symbol, { refresh: bypassCache });
      if (resp?.status === "success" && Array.isArray(resp.data)) {
        setCatalysts(resp.data);
      } else {
        setCatalysts([]);
      }
    } catch (err) {
      setError(err.message || "Failed to load catalyst intelligence");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCatalysts(false);
  }, [symbol, apiBaseUrl]);

  const filteredCatalysts = useMemo(() => {
    if (!searchFilter.trim()) return catalysts;
    const q = searchFilter.toLowerCase();
    return catalysts.filter((c) => {
      const titleMatch = (c.title || "").toLowerCase().includes(q);
      const questionMatch = (c.markets || []).some((m) => (m.question || "").toLowerCase().includes(q));
      return titleMatch || questionMatch;
    });
  }, [catalysts, searchFilter]);

  return (
    <div className="pw-catalyst-container">
      {/* Header bar */}
      <div className="pw-catalyst-header">
        <div className="pw-catalyst-header-titles">
          <div className="pw-catalyst-title-row">
            <span className="pw-catalyst-icon">🎯</span>
            <h4 className="pw-catalyst-title">Forward-Looking Catalyst Radar</h4>
            <span className="pw-catalyst-badge-live">LIVE PROBABILITIES</span>
          </div>
          <p className="pw-catalyst-subtitle">
            Real-money prediction market contracts tied to <strong>{symbol}</strong> ({companyName}) from Polymarket.
          </p>
        </div>

        <div className="pw-catalyst-header-actions">
          <input
            type="text"
            className="pw-catalyst-search-input"
            placeholder="Filter contracts..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
          />
          <button
            type="button"
            className="pw-catalyst-refresh-btn"
            onClick={() => loadCatalysts(true)}
            disabled={isLoading}
            title="Refresh latest probabilities from Polymarket"
          >
            {isLoading ? "⟳ Updating..." : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* Content states */}
      {error && (
        <div className="pw-catalyst-error-card">
          <span className="pw-catalyst-error-icon">⚠️</span>
          <div className="pw-catalyst-error-text">
            <h5>Unable to load Polymarket contracts</h5>
            <p>{error}</p>
          </div>
          <button type="button" className="pw-catalyst-retry-btn" onClick={() => loadCatalysts(true)}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !catalysts.length && (
        <div className="pw-catalyst-loading-state">
          <div className="pw-catalyst-spinner" />
          <span>Querying prediction markets for {symbol}...</span>
        </div>
      )}

      {!isLoading && !error && filteredCatalysts.length === 0 && (
        <div className="pw-catalyst-empty-card">
          <div className="pw-catalyst-empty-icon">📊</div>
          <h5>No Active Prediction Contracts for {symbol}</h5>
          <p>
            There are currently no liquid prediction contracts directly mentioning {symbol} or {companyName}.
            Check the <strong>Catalyst Radar</strong> tab in your Portfolio view for macroeconomic and sector-wide drivers.
          </p>
          <button
            type="button"
            className="pw-catalyst-refresh-empty-btn"
            onClick={() => loadCatalysts(true)}
          >
            Check Again
          </button>
        </div>
      )}

      {/* Catalysts list */}
      <div className="pw-catalyst-grid">
        {filteredCatalysts.map((ev) => (
          <div key={ev.id} className="pw-catalyst-card">
            <div className="pw-catalyst-card-top">
              <div className="pw-catalyst-card-main">
                <span className="pw-catalyst-cat-tag">{ev.category || "Equity"}</span>
                <h5 className="pw-catalyst-card-title">{ev.title}</h5>
              </div>
              {ev.url && (
                <a
                  href={ev.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pw-catalyst-ext-link"
                  title="View on Polymarket"
                >
                  Polymarket ↗
                </a>
              )}
            </div>

            <div className="pw-catalyst-card-meta">
              <span className="pw-meta-item">
                <span className="pw-meta-label">Vol:</span> {formatCurrency(ev.volume)}
              </span>
              {ev.volume24hr > 0 && (
                <span className="pw-meta-item">
                  <span className="pw-meta-label">24h:</span> {formatCurrency(ev.volume24hr)}
                </span>
              )}
              {ev.end_date && (
                <span className="pw-meta-item">
                  <span className="pw-meta-label">Resolves:</span> {formatDate(ev.end_date)}
                </span>
              )}
            </div>

            {/* Markets & Probability meters */}
            <div className="pw-catalyst-markets-list">
              {(ev.markets || []).map((m) => {
                const isMultiOutcome = (m.outcomes || []).length > 2;
                return (
                  <div key={m.id} className="pw-catalyst-market-item">
                    {m.question && m.question !== ev.title && (
                      <div className="pw-market-question">{m.question}</div>
                    )}
                    <div className={`pw-outcomes-wrapper ${isMultiOutcome ? "pw-outcomes-multi" : ""}`}>
                      {(m.outcomes || []).map((outcome, idx) => {
                        const pct = outcome.probability_pct ?? 0;
                        const isHigh = pct >= 50;
                        return (
                          <div key={idx} className="pw-outcome-row">
                            <div className="pw-outcome-label-col">
                              <span className="pw-outcome-label">{outcome.label}</span>
                              <span className={`pw-outcome-pct ${isHigh ? "pw-pct-high" : ""}`}>
                                {pct.toFixed(1)}%
                              </span>
                            </div>
                            <div className="pw-prob-track">
                              <div
                                className={`pw-prob-fill ${isHigh ? "pw-fill-high" : "pw-fill-low"}`}
                                style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
