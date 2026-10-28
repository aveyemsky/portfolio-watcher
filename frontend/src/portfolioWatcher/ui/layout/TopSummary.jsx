import { useEffect, useRef, useState } from "react";
import ModalDialog from "../shared/ModalDialog";
import MacroCatalystRadarTab from "../account/MacroCatalystRadarTab";
import { fetchMacroCatalysts } from "../../api/portfolioApi";
import {
  fmtIndexValue,
  fmtMoney0,
  fmtObservationDate,
  fmtPct,
  getCategoryKey,
  getSkewRegime,
  getUsMarketSession,
  getVixNeedleCoords,
  getVixRegime,
  latestPrice,
  stockChange,
  stockPriceChange
} from "../viewModel";

export function extractMacroHeadlines(events) {
  const CATEGORY_ICONS = {
    fed: "🏛️",
    tech: "🤖",
    energy: "🛢️",
    recession: "📉",
    inflation: "📊",
    tariffs: "🚢",
    crypto: "🪙"
  };

  const byCategory = {};
  const seenLabels = new Set();

  for (const ev of events || []) {
    const rawCat = (ev.category || "macro").toLowerCase();
    const icon = CATEGORY_ICONS[rawCat] || "🎯";
    const catLabel = rawCat.charAt(0).toUpperCase() + rawCat.slice(1);
    const title = ev.title || "";
    const markets = ev.markets || [];
    if (!markets.length) continue;

    let candidate = null;

    if (rawCat === "fed" || title.toLowerCase().includes("fed decision")) {
      let topFed = null;
      for (const m of markets) {
        const yes = (m.outcomes || []).find((o) => o.label === "Yes");
        if (!yes || yes.probability_pct == null) continue;
        const q = (m.question || "").toLowerCase();
        let shortLabel = "Fed Decision";
        if (q.includes("no change")) shortLabel = "Fed Hold";
        else if (q.includes("decrease") && q.includes("25")) shortLabel = "Fed Cut 25bps";
        else if (q.includes("decrease") && q.includes("50")) shortLabel = "Fed Cut 50bps";
        else if (q.includes("increase") && q.includes("25")) shortLabel = "Fed Hike 25bps";
        else if (q.includes("increase")) shortLabel = "Fed Hike";

        const prob = Math.round(yes.probability_pct);
        if (!topFed || prob > topFed.prob) {
          topFed = {
            title: `${shortLabel} ${prob}%`,
            category: "Fed",
            rawCategory: "fed",
            searchKeyword: "Fed",
            icon: "🏛️",
            prob,
            fullQuestion: m.question
          };
        }
      }
      if (topFed && !seenLabels.has(topFed.title)) {
        candidate = topFed;
      }
    } else {
      for (const m of markets) {
        const yes = (m.outcomes || []).find((o) => o.label === "Yes");
        if (!yes || yes.probability_pct == null) continue;
        const prob = Math.round(yes.probability_pct);
        if (prob < 3 || prob > 97) continue;

        const q = m.question || "";
        const qLower = q.toLowerCase();
        let label = null;
        let searchKeyword = null;

        if (qLower.includes("nvidia") && qLower.includes("largest company")) {
          label = `NVDA #1 Co ${prob}%`;
          searchKeyword = "NVIDIA";
        } else if (qLower.includes("anthropic ipo") && qLower.includes("2026")) {
          label = `Anthropic IPO ${prob}%`;
          searchKeyword = "Anthropic";
        } else if (qLower.includes("openai ipo") && qLower.includes("2026")) {
          label = `OpenAI IPO ${prob}%`;
          searchKeyword = "OpenAI";
        } else if (qLower.includes("spacex") && qLower.includes("highest ipo")) {
          label = `SpaceX Top IPO ${prob}%`;
          searchKeyword = "SpaceX";
        } else if (qLower.includes("crude oil") && (qLower.includes("all-time high") || qLower.includes("ath"))) {
          label = `Crude Oil ATH ${prob}%`;
          searchKeyword = "Crude Oil";
        } else if (qLower.includes("wti crude") && qLower.includes("100")) {
          label = `WTI $100+ ${prob}%`;
          searchKeyword = "WTI Crude";
        } else if (qLower.includes("recession")) {
          label = `US Recession ${prob}%`;
          searchKeyword = "recession";
        } else if (qLower.includes("treasury yield") && qLower.includes("5.5%")) {
          label = `10Y Yield 5.5% ${prob}%`;
          searchKeyword = "Treasury yield";
        } else if (qLower.includes("inflation") && qLower.includes("4.5%")) {
          label = `Inflation >4.5% ${prob}%`;
          searchKeyword = "inflation";
        } else if (qLower.includes("trade deal") || qLower.includes("economic deal")) {
          label = `US Trade Deal ${prob}%`;
          searchKeyword = "trade deal";
        } else if (qLower.includes("best ai model")) {
          label = `Anthropic #1 AI ${prob}%`;
          searchKeyword = "Anthropic";
        }

        if (label && !seenLabels.has(label)) {
          candidate = {
            title: label,
            category: catLabel,
            rawCategory: rawCat,
            searchKeyword: searchKeyword || catLabel.toLowerCase(),
            icon,
            prob,
            fullQuestion: q
          };
          break;
        }
      }
    }

    if (!candidate) {
      for (const m of markets) {
        const yes = (m.outcomes || []).find((o) => o.label === "Yes");
        if (!yes || yes.probability_pct == null) continue;
        const prob = Math.round(yes.probability_pct);
        if (prob < 4 || prob > 96) continue;
        const cleanTitle = title.replace(/\?|\(.*?\)/g, "").trim();
        const shortTitle = cleanTitle.length > 13 ? cleanTitle.slice(0, 13).trim() : cleanTitle;
        const label = `${shortTitle} ${prob}%`;
        if (!seenLabels.has(label)) {
          candidate = {
            title: label,
            category: catLabel,
            rawCategory: rawCat,
            searchKeyword: cleanTitle.split(" ").slice(0, 2).join(" ").toLowerCase(),
            icon,
            prob,
            fullQuestion: m.question || title
          };
          break;
        }
      }
    }

    if (candidate) {
      seenLabels.add(candidate.title);
      if (!byCategory[rawCat]) byCategory[rawCat] = [];
      byCategory[rawCat].push(candidate);
    }
  }

  const order = ["fed", "tech", "energy", "recession", "inflation", "tariffs"];
  const interleaved = [];
  let added = true;
  let round = 0;
  while (added && round < 10) {
    added = false;
    for (const cat of order) {
      if (byCategory[cat] && byCategory[cat][round]) {
        interleaved.push(byCategory[cat][round]);
        added = true;
      }
    }
    for (const cat of Object.keys(byCategory)) {
      if (!order.includes(cat) && byCategory[cat][round]) {
        interleaved.push(byCategory[cat][round]);
        added = true;
      }
    }
    round++;
  }

  return interleaved;
}

export default function TopSummary({ data, state, dispatch, apiBaseUrl, initialRotatingView = null }) {
  const marketSession = getUsMarketSession();
  const [isRadarOpen, setIsRadarOpen] = useState(false);
  const [macroHeadlines, setMacroHeadlines] = useState([]);
  const [headlineIndex, setHeadlineIndex] = useState(0);
  const macroHeadlinesRef = useRef(macroHeadlines);
  macroHeadlinesRef.current = macroHeadlines;

  useEffect(() => {
    if (!apiBaseUrl) return;
    let isMounted = true;
    fetchMacroCatalysts(apiBaseUrl, { limit: 30 })
      .then((res) => {
        if (!isMounted || !res?.data?.length) return;
        const parsed = extractMacroHeadlines(res.data);
        if (parsed.length > 0) {
          setMacroHeadlines(parsed);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl]);

  // Extract indices sorted by displayOrder
  const allIndices = (data?.indices && data.indices.length > 0)
    ? [...data.indices].sort((a, b) => (a.displayOrder || 99) - (b.displayOrder || 99))
    : (data?.stocks || []).filter((s) => s.assetType === "index" || s.symbol.startsWith("^"));

  const skewIndex = allIndices.find((index) => index.symbol === "^SKEW")
    || (data?.stocks || []).find((s) => s.symbol === "^SKEW");
  const indices = allIndices.filter((index) => index.symbol !== "^SKEW");

  const [activeRotatingView, setActiveRotatingView] = useState(() => (
    initialRotatingView || (skewIndex ? "skew" : "radar")
  ));
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    if (!skewIndex) {
      setActiveRotatingView("radar");
    }
  }, [skewIndex]);

  useEffect(() => {
    if (isHovered) return undefined;
    const timer = setInterval(() => {
      if (skewIndex) {
        setActiveRotatingView((current) => {
          if (current === "skew") {
            setHeadlineIndex((idx) => {
              const len = macroHeadlinesRef.current.length || 1;
              return (idx + 1) % len;
            });
            return "radar";
          }
          return "skew";
        });
      } else {
        setHeadlineIndex((idx) => {
          const len = macroHeadlinesRef.current.length || 1;
          return (idx + 1) % len;
        });
      }
    }, 10000);
    return () => clearInterval(timer);
  }, [skewIndex, isHovered]);

  const isSkewSelected = state?.selectedType === "stock" && state?.selectedStockSymbol === "^SKEW";
  const skewPrice = skewIndex ? latestPrice(data, "^SKEW") : null;
  const skewCurrentPrice = skewPrice?.close ?? skewIndex?.lastPrice ?? 0;
  const skewPriceDiff = skewIndex ? stockPriceChange(data, "^SKEW") : 0;
  const skewChange = skewIndex ? stockChange(data, "^SKEW") : 0;
  const isSkewPositive = (skewPriceDiff ?? 0) >= 0;
  const skewRegime = getSkewRegime(skewCurrentPrice);
  const skewDate = fmtObservationDate(skewPrice?.date || skewIndex?.quoteDate || skewIndex?.updatedAt);
  const skewDateLabel = skewDate ? `${skewDate} Close` : "";
  const currentHeadline = macroHeadlines[headlineIndex] || null;

  return (
    <div className="pw-indices-bar">
      <div className="pw-indices-grid">
        {indices.map((index) => {
          const isVix = index.symbol === "^VIX";
          const price = latestPrice(data, index.symbol);
          const currentPrice = price?.close ?? index.lastPrice ?? 0;
          const priceDiff = stockPriceChange(data, index.symbol);
          const change = stockChange(data, index.symbol);
          const tone = change >= 0 ? "up" : "down";
          const isPositive = (priceDiff ?? 0) >= 0;
          const isSelected = state?.selectedType === "stock" && state?.selectedStockSymbol === index.symbol;
          let displayName = index.shortName || index.name;
          if (index.symbol === "^DJI" || index.shortName === "Dow Jones") {
            displayName = "Dow Jones";
          } else if (index.symbol === "^IXIC") {
            displayName = "Nasdaq Comp";
          } else if (index.symbol === "^NDX") {
            displayName = "Nasdaq 100";
          }

          if (isVix) {
            const regime = getVixRegime(currentPrice);
            const { x: needleX, y: needleY } = getVixNeedleCoords(currentPrice);

            return (
              <div
                key={index.symbol}
                className={`pw-index-card pw-index-card--vix ${isSelected ? "pw-index-card-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => dispatch?.({ type: "selectStock", symbol: index.symbol })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    dispatch?.({ type: "selectStock", symbol: index.symbol });
                  }
                }}
              >
                <div className="pw-index-card-header">
                  <span className="pw-index-name" title={index.name}>
                    {displayName}
                  </span>
                  <span className={`pw-vix-regime-badge pw-vix-regime--${regime.key}`}>
                    {regime.label}
                  </span>
                </div>
                <div className="pw-vix-card-body">
                  <div className="pw-vix-gauge-container" title={`VIX Level: ${fmtIndexValue(currentPrice, true)} (${regime.label})`}>
                    <svg viewBox="0 0 64 36" className="pw-vix-gauge-svg" aria-hidden="true">
                      <defs>
                        <linearGradient id="pwVixGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                          <stop offset="0%" stopColor="#10b981" />
                          <stop offset="45%" stopColor="#22c55e" />
                          <stop offset="70%" stopColor="#f59e0b" />
                          <stop offset="100%" stopColor="#ef4444" />
                        </linearGradient>
                      </defs>
                      <path
                        d="M 8 32 A 24 24 0 0 1 56 32"
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.15)"
                        strokeWidth="4.5"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 8 32 A 24 24 0 0 1 56 32"
                        fill="none"
                        stroke="url(#pwVixGradient)"
                        strokeWidth="4"
                        strokeLinecap="round"
                      />
                      <line
                        x1="32"
                        y1="32"
                        x2={needleX.toFixed(1)}
                        y2={needleY.toFixed(1)}
                        stroke="#ffffff"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <circle cx="32" cy="32" r="2.5" fill="#ffffff" />
                    </svg>
                  </div>
                  <div className="pw-vix-values">
                    <div className="pw-index-price">{fmtIndexValue(currentPrice, true)}</div>
                    <div className="pw-index-card-bottom pw-vix-diff">
                      <span className="pw-index-arrow">{isPositive ? "▲" : "▼"}</span>
                      <span className="pw-index-diff">
                        {`${isPositive ? "+" : ""}${Number(priceDiff || 0).toFixed(2)}`}
                      </span>
                      <span className="pw-index-pct">
                        {fmtPct(change)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div
              key={index.symbol}
              className={`pw-index-card pw-index-card--${tone} ${isSelected ? "pw-index-card-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => dispatch?.({ type: "selectStock", symbol: index.symbol })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  dispatch?.({ type: "selectStock", symbol: index.symbol });
                }
              }}
            >
              <div className="pw-index-card-header">
                <span className="pw-index-name" title={index.name}>
                  {displayName}
                </span>
              </div>
              <div className="pw-index-card-price-row">
                <span className="pw-index-price">{fmtIndexValue(currentPrice, isVix)}</span>
              </div>
              <div className={`pw-index-card-bottom pw-${tone}`}>
                <span className="pw-index-arrow">{isPositive ? "▲" : "▼"}</span>
                <span className="pw-index-diff">
                  {`${isPositive ? "+" : ""}${Number(priceDiff || 0).toFixed(2)}`}
                </span>
                <span className="pw-index-pct">
                  {fmtPct(change)}
                </span>
              </div>
            </div>
          );
        })}

        {/* Forward-Looking Macro Catalyst Radar & SKEW Rotating Panel */}
        <div
          key="macro-radar-card"
          className={`pw-index-card ${
            activeRotatingView === "skew" ? "pw-index-card--skew" : "pw-index-card--macro"
          } pw-index-card--rotating ${
            (activeRotatingView === "skew" ? isSkewSelected : isRadarOpen) ? "pw-index-card-active" : ""
          }`}
          role="button"
          tabIndex={0}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={() => {
            if (activeRotatingView === "skew") {
              dispatch?.({ type: "selectStock", symbol: skewIndex?.symbol || "^SKEW" });
            } else {
              setIsRadarOpen(true);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              if (activeRotatingView === "skew") {
                dispatch?.({ type: "selectStock", symbol: skewIndex?.symbol || "^SKEW" });
              } else {
                setIsRadarOpen(true);
              }
            }
          }}
          title={
            activeRotatingView === "skew"
              ? "Tail Risk (CBOE SKEW): Click to view chart. Rotates with Polymarket Macro Radar every 10s."
              : "Macro Catalyst Radar: Live Polymarket crowd probabilities for Fed rates, recession, oil, & tariffs"
          }
        >
          {activeRotatingView === "skew" && skewIndex ? (
            <div className="pw-rotating-card-slide" key="skew-view">
              <div className="pw-index-card-header">
                <span className="pw-index-name" title={skewIndex.name || "CBOE SKEW Index"}>
                  SKEW Index
                </span>
              </div>
              <div className="pw-macro-card-body">
                <div className="pw-macro-icon-box" aria-hidden="true">
                  ⚠️
                </div>
                <div className="pw-macro-values">
                  <div className="pw-macro-val">
                    {fmtIndexValue(skewCurrentPrice, true)}
                  </div>
                  <div className="pw-macro-sub">
                    {skewDateLabel && <span className="pw-macro-date">{`${skewDateLabel} • `}</span>}
                    <span>Tail Risk ↗</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="pw-rotating-card-slide" key={`radar-view-${headlineIndex}`}>
              <div className="pw-index-card-header">
                <span className="pw-index-name">Macro Radar</span>
                <span className="pw-macro-badge">POLYMARKET</span>
              </div>
              <div className="pw-macro-card-body">
                <div className="pw-macro-icon-box" aria-hidden="true">
                  {currentHeadline?.icon || "🎯"}
                </div>
                <div className="pw-macro-values">
                  <div
                    className="pw-macro-val"
                    title={currentHeadline?.fullQuestion || currentHeadline?.title || "Fed & Macro"}
                  >
                    {currentHeadline ? currentHeadline.title : "Fed & Macro"}
                  </div>
                  <div className="pw-macro-sub">
                    {currentHeadline?.category && (
                      <span className="pw-macro-cat-name">{currentHeadline.category} • </span>
                    )}
                    <span>Crowd Odds ↗</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {skewIndex && (
            <div className="pw-rotating-dots" title="Rotating every 10s (Click to toggle)">
              <span
                className={`pw-rotating-dot ${activeRotatingView === "skew" ? "pw-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveRotatingView("skew");
                }}
                title="SKEW Index"
                aria-label="Switch to SKEW Index"
              />
              <span
                className={`pw-rotating-dot ${activeRotatingView === "radar" ? "pw-active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveRotatingView("radar");
                }}
                title="Polymarket Macro Radar"
                aria-label="Switch to Polymarket Macro Radar"
              />
            </div>
          )}
        </div>
      </div>

      {isRadarOpen && (
        <ModalDialog
          isOpen={isRadarOpen}
          onClose={() => setIsRadarOpen(false)}
          title="Forward-Looking Macro Catalyst Radar"
          maxWidth={960}
          className="pw-radar-modal"
        >
          <MacroCatalystRadarTab
            apiBaseUrl={apiBaseUrl}
            initialQuery={currentHeadline?.searchKeyword || ""}
            initialCategory={currentHeadline?.rawCategory || "all"}
          />
        </ModalDialog>
      )}
    </div>
  );
}

export function calculatePortfolioSummary(account, holdings, data) {
  if (!account) return null;
  const stockHoldings = (holdings || []).filter((h) => !h.isSectionHeader);
  const category = (data?.categories || []).find(
    (c) => c.id === (account.categoryId || account.category_id)
  );
  const catKey = getCategoryKey(category, account);
  const isPercentMode =
    catKey !== "accounts" ||
    (account.sizing_mode || account.sizingMode || "PERCENT") === "PERCENT";

  if (isPercentMode) {
    // In PERCENT mode (or Sector/Watchlist baskets): hide fake dollar total, compute portfolio daily % change weighted by effective_weight_pct
    let weightedDailyPct = 0;
    const N = stockHoldings.length;
    stockHoldings.forEach((h) => {
      const chg = stockChange(data, h.symbol);
      const effWeight =
        h.effective_weight_pct ??
        h.effectiveWeightPct ??
        (N > 0 ? 100 / N : 0);
      weightedDailyPct += chg * (effWeight / 100);
    });
    return {
      mode: "PERCENT",
      isPercentMode: true,
      hideDollarTotal: true,
      dailyPctChange: weightedDailyPct,
      holdingCount: stockHoldings.length,
      displayText: `${stockHoldings.length} ${
        stockHoldings.length === 1 ? "holding" : "holdings"
      } · ${weightedDailyPct >= 0 ? "+" : ""}${weightedDailyPct.toFixed(2)}%`
    };
  } else {
    // In SHARES mode: compute real dollar total (cash + sum(shares * price)) where 0 shares = $0
    let totalValue = Number(account.cash || 0);
    let totalPreviousValue = Number(account.cash || 0);
    stockHoldings.forEach((h) => {
      const price = latestPrice(data, h.symbol)?.close || h.avgCost || 0;
      const prevClose = latestPrice(data, h.symbol)?.previousClose || price;
      const sh = Number(h.shares || 0);
      totalValue += sh * price;
      totalPreviousValue += sh * prevClose;
    });
    const dailyPctChange =
      totalPreviousValue > 0
        ? ((totalValue - totalPreviousValue) / totalPreviousValue) * 100
        : 0;
    return {
      mode: "SHARES",
      isPercentMode: false,
      hideDollarTotal: false,
      totalValue,
      dailyPctChange,
      holdingCount: stockHoldings.length,
      displayText: fmtMoney0(totalValue)
    };
  }
}

export function mockAccountReturn(accountId) {
  const returns = {
    1: 18.42,
    2: 9.86,
    3: 6.15,
    4: 24.73
  };
  return returns[accountId] || 5.2;
}
