import React, { useEffect, useState, useMemo } from "react";
import { fetchMacroCatalysts, searchCatalysts } from "../../api/portfolioApi";

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

const CATEGORIES = [
  { id: "all", label: "All Macro Movers", icon: "🌐" },
  { id: "fed", label: "Fed & Rates", icon: "🏛️" },
  { id: "inflation", label: "Inflation & CPI", icon: "📊" },
  { id: "recession", label: "Recession & GDP", icon: "📉" },
  { id: "tariffs", label: "Tariffs & Trade", icon: "🚢" },
  { id: "energy", label: "Energy & Oil", icon: "🛢️" },
  { id: "tech", label: "Tech & AI IPOs", icon: "🤖" },
];

export default function MacroCatalystRadarTab({
  apiBaseUrl,
  account,
  initialQuery = "",
  initialCategory = "all",
}) {
  const [activeCategory, setActiveCategory] = useState(initialCategory || "all");
  const [events, setEvents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState(initialQuery || "");
  const [minVolume, setMinVolume] = useState(500);

  const loadMacroEvents = async (bypassCache = false, queryOverride = null) => {
    setIsLoading(true);
    setError(null);
    const query = queryOverride !== null ? queryOverride : searchQuery;
    try {
      let resp;
      if (query && query.trim()) {
        resp = await searchCatalysts(apiBaseUrl, query.trim(), {
          minVolume,
          refresh: bypassCache,
        });
      } else {
        resp = await fetchMacroCatalysts(apiBaseUrl, {
          category: activeCategory,
          minVolume,
          limit: 30,
          refresh: bypassCache,
        });
      }

      if (resp?.status === "success" && Array.isArray(resp.data)) {
        setEvents(resp.data);
      } else {
        setEvents([]);
      }
    } catch (err) {
      setError(err.message || "Failed to load macro catalyst radar");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadMacroEvents(false);
  }, [activeCategory, minVolume, apiBaseUrl]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadMacroEvents(false);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    loadMacroEvents(false, "");
  };

  // Find top macro highlights for summary cards
  const fedEvent = useMemo(
    () => events.find((e) => (e.title || "").toLowerCase().includes("fed decision")),
    [events]
  );
  const fedTopMarket = useMemo(() => {
    if (!fedEvent?.markets || fedEvent.markets.length === 0) return null;
    if (fedEvent.markets.length === 1) return fedEvent.markets[0];
    let best = fedEvent.markets[0];
    let maxProb = -1;
    for (const m of fedEvent.markets) {
      const yesOutcome = m.outcomes?.find((o) => (o.label || "").toLowerCase() === "yes");
      const prob = yesOutcome
        ? yesOutcome.probability_pct
        : Math.max(...(m.outcomes || []).map((o) => o.probability_pct || 0), 0);
      if (prob > maxProb) {
        maxProb = prob;
        best = m;
      }
    }
    return best;
  }, [fedEvent]);
  const recessionEvent = useMemo(
    () => events.find((e) => (e.title || "").toLowerCase().includes("recession")),
    [events]
  );
  const oilEvent = useMemo(
    () => events.find((e) => (e.title || "").toLowerCase().includes("crude oil") || (e.title || "").toLowerCase().includes("wti")),
    [events]
  );

  return (
    <div className="pw-macro-radar-container">
      {/* Top Banner & Header */}
      <div className="pw-radar-header">
        <div className="pw-radar-titles">
          <div className="pw-radar-title-row">
            <span className="pw-radar-header-icon">🧭</span>
            <h3 className="pw-radar-title">Macro Catalyst & Prediction Radar</h3>
            <span className="pw-radar-badge-live">SKIN-IN-THE-GAME PROBABILITIES</span>
          </div>
          <p className="pw-radar-desc">
            Leading market-implied probabilities from Polymarket. Unlike lagging technical indicators,
            prediction markets price impending monetary shifts, inflation prints, and trade policies in real time.
          </p>
        </div>

        <div className="pw-radar-controls">
          <form className="pw-radar-search-form" onSubmit={handleSearchSubmit}>
            <div className="pw-radar-search-input-wrapper">
              <input
                type="text"
                className="pw-radar-search-input"
                placeholder="Search catalysts (e.g. CPI, tariff, Taiwan)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="pw-radar-search-clear-btn"
                  onClick={handleClearSearch}
                  title="Clear search"
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
            <button type="submit" className="pw-radar-search-btn">
              Search
            </button>
          </form>

          <button
            type="button"
            className="pw-radar-refresh-btn"
            onClick={() => loadMacroEvents(true)}
            disabled={isLoading}
            title="Refresh latest prediction data"
          >
            {isLoading ? "⟳ Updating..." : "⟳ Refresh"}
          </button>
        </div>
      </div>

      {/* Highlights Bar */}
      <div className="pw-macro-highlights-grid">
        <div className="pw-macro-highlight-card">
          <div className="pw-highlight-top">
            <span className="pw-highlight-badge">FOMC Interest Rates</span>
            <span className="pw-highlight-source">Polymarket</span>
          </div>
          <h5 className="pw-highlight-title">
            {fedTopMarket?.question || fedEvent?.title || "Upcoming Fed Decision"}
          </h5>
          <div className="pw-highlight-content">
            {(fedTopMarket || fedEvent?.markets?.[0])?.outcomes?.map((o, idx) => (
              <div key={idx} className="pw-highlight-outcome">
                <span className="pw-highlight-label">{o.label}</span>
                <span className={`pw-highlight-pct ${o.probability_pct >= 50 ? "pw-pct-high" : ""}`}>
                  {o.probability_pct}%
                </span>
              </div>
            )) || <span className="pw-highlight-muted">Monitoring FOMC probability curves</span>}
          </div>
        </div>

        <div className="pw-macro-highlight-card">
          <div className="pw-highlight-top">
            <span className="pw-highlight-badge">U.S. Recession Odds</span>
            <span className="pw-highlight-source">Polymarket</span>
          </div>
          <h5 className="pw-highlight-title">
            {recessionEvent ? recessionEvent.title : "U.S. Recession"}
          </h5>
          <div className="pw-highlight-content">
            {recessionEvent?.markets?.[0]?.outcomes?.map((o, idx) => (
              <div key={idx} className="pw-highlight-outcome">
                <span className="pw-highlight-label">{o.label}</span>
                <span className={`pw-highlight-pct ${o.probability_pct >= 50 ? "pw-pct-high" : ""}`}>
                  {o.probability_pct}%
                </span>
              </div>
            )) || <span className="pw-highlight-muted">Tracking macro growth indicators</span>}
          </div>
        </div>

        <div className="pw-macro-highlight-card">
          <div className="pw-highlight-top">
            <span className="pw-highlight-badge">Energy / Oil Shocks</span>
            <span className="pw-highlight-source">Polymarket</span>
          </div>
          <h5 className="pw-highlight-title">
            {oilEvent ? oilEvent.title : "WTI Crude Target"}
          </h5>
          <div className="pw-highlight-content">
            {oilEvent?.markets?.[0]?.outcomes?.map((o, idx) => (
              <div key={idx} className="pw-highlight-outcome">
                <span className="pw-highlight-label">{o.label}</span>
                <span className={`pw-highlight-pct ${o.probability_pct >= 50 ? "pw-pct-high" : ""}`}>
                  {o.probability_pct}%
                </span>
              </div>
            )) || <span className="pw-highlight-muted">Tracking commodity supply risk</span>}
          </div>
        </div>
      </div>

      {/* Category Pills & Volume Filter */}
      <div className="pw-radar-filter-bar">
        <div className="pw-category-pills">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`pw-category-pill ${activeCategory === cat.id ? "pw-category-pill-active" : ""}`}
              onClick={() => {
                setSearchQuery("");
                if (activeCategory === cat.id) {
                  loadMacroEvents(false, "");
                } else {
                  setActiveCategory(cat.id);
                }
              }}
            >
              <span className="pw-pill-icon">{cat.icon}</span>
              {cat.label}
            </button>
          ))}
        </div>

        <div className="pw-volume-selector">
          <span className="pw-vol-label">Min Volume:</span>
          <select
            className="pw-vol-select"
            value={minVolume}
            onChange={(e) => setMinVolume(Number(e.target.value))}
          >
            <option value={0}>All Active</option>
            <option value={500}>&gt; $500</option>
            <option value={5000}>&gt; $5,000</option>
            <option value={25000}>&gt; $25,000</option>
            <option value={100000}>&gt; $100,000</option>
          </select>
        </div>
      </div>

      {/* Content Area */}
      {error && (
        <div className="pw-catalyst-error-card">
          <span className="pw-catalyst-error-icon">⚠️</span>
          <div className="pw-catalyst-error-text">
            <h5>Error loading prediction contracts</h5>
            <p>{error}</p>
          </div>
          <button type="button" className="pw-catalyst-retry-btn" onClick={() => loadMacroEvents(true)}>
            Retry
          </button>
        </div>
      )}

      {isLoading && !events.length && (
        <div className="pw-catalyst-loading-state">
          <div className="pw-catalyst-spinner" />
          <span>Fetching real-time market probability distributions...</span>
        </div>
      )}

      {!isLoading && !error && events.length === 0 && (
        <div className="pw-catalyst-empty-card">
          <div className="pw-catalyst-empty-icon">🔍</div>
          <h5>No Matching Prediction Contracts</h5>
          <p>Try clearing your search query or lowering the minimum volume filter.</p>
          <button
            type="button"
            className="pw-catalyst-refresh-empty-btn"
            onClick={() => {
              setSearchQuery("");
              setMinVolume(0);
            }}
          >
            Reset Filters
          </button>
        </div>
      )}

      {/* Event Cards Grid */}
      <div className="pw-radar-events-grid">
        {events.map((ev) => (
          <div key={ev.id} className="pw-catalyst-card pw-radar-event-card">
            <div className="pw-catalyst-card-top">
              <div className="pw-catalyst-card-main">
                <span className="pw-catalyst-cat-tag">{ev.category?.toUpperCase() || "MACRO"}</span>
                <h5 className="pw-catalyst-card-title">{ev.title}</h5>
              </div>
              {ev.url && (
                <a
                  href={ev.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pw-catalyst-ext-link"
                  title="Trade or view contract on Polymarket"
                >
                  Polymarket ↗
                </a>
              )}
            </div>

            <div className="pw-catalyst-card-meta">
              <span className="pw-meta-item">
                <span className="pw-meta-label">Total Vol:</span> {formatCurrency(ev.volume)}
              </span>
              {ev.volume24hr > 0 && (
                <span className="pw-meta-item">
                  <span className="pw-meta-label">24h Vol:</span> {formatCurrency(ev.volume24hr)}
                </span>
              )}
              {ev.end_date && (
                <span className="pw-meta-item">
                  <span className="pw-meta-label">Resolves:</span> {formatDate(ev.end_date)}
                </span>
              )}
            </div>

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
