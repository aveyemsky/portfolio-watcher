import React, { useEffect, useMemo, useState } from "react";
import { fetchStockFundamentals } from "../../api/portfolioApi";
import { getSelectedStock } from "../viewModel";

function formatSurpriseTag(surprisePct, epsReported) {
  if (surprisePct === null || surprisePct === undefined || epsReported === null || epsReported === undefined) {
    return {
      text: "PENDING",
      tone: "pending"
    };
  }
  const num = Number(surprisePct);
  if (!Number.isFinite(num)) {
    return {
      text: "PENDING",
      tone: "pending"
    };
  }
  if (num >= 0) {
    return {
      text: `+${num.toFixed(2)}% BEAT`,
      tone: "beat"
    };
  }
  return {
    text: `${num.toFixed(2)}% MISS`,
    tone: "miss"
  };
}

export default function FundamentalsCatalystDrawer({
  apiBaseUrl = "/api/portfolio",
  stock: propStock = null,
  data = null,
  state = null,
  fundamentals: propFundamentals = null,
  symbol: propSymbol = null,
  onClose = null
}) {
  const resolvedStock = propStock || (data && state ? getSelectedStock(data, state) : null);
  const symbol = propSymbol || resolvedStock?.symbol || state?.selectedStockSymbol || "";

  const initialFundamentals =
    propFundamentals ||
    (resolvedStock?.earnings_history || resolvedStock?.dividend_snapshot
      ? {
          symbol: resolvedStock.symbol,
          calendar: resolvedStock.calendar || {
            next_earnings_date: resolvedStock.next_earnings_date || resolvedStock.nextEarningsDate || null,
            earnings_avg_est: resolvedStock.earnings_avg_est ?? null,
            ex_dividend_date: resolvedStock.ex_dividend_date ?? null
          },
          dividend_snapshot: resolvedStock.dividend_snapshot || resolvedStock.dividendSnapshot || null,
          earnings_history: resolvedStock.earnings_history || resolvedStock.earningsHistory || [],
          dividend_history: resolvedStock.dividend_history || resolvedStock.dividendHistory || []
        }
      : null);

  const [fetchedFundamentals, setFetchedFundamentals] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;
    let retryTimer = null;
    if (!symbol || (propFundamentals && propFundamentals.status !== "pending_sync")) return undefined;

    async function load(retryCount = 0) {
      if (retryCount === 0) setIsLoading(true);
      setError("");
      try {
        const res = await fetchStockFundamentals(apiBaseUrl || "/api/portfolio", symbol);
        if (isMounted && res) {
          setFetchedFundamentals(res);
          if (res.status === "pending_sync" && retryCount < 6) {
            retryTimer = setTimeout(() => {
              if (isMounted) load(retryCount + 1);
            }, 2000);
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err?.message || "Unable to load fundamental data.");
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    load(0);
    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [apiBaseUrl, symbol, propFundamentals]);

  const validFetched =
    fetchedFundamentals && (!fetchedFundamentals.symbol || fetchedFundamentals.symbol === symbol)
      ? fetchedFundamentals
      : null;
  const activeData =
    (propFundamentals && propFundamentals.status !== "pending_sync" ? propFundamentals : null) ||
    validFetched ||
    propFundamentals ||
    initialFundamentals ||
    {};
  const calendar = activeData.calendar || {};
  const dividendSnapshot = activeData.dividend_snapshot || activeData.dividendSnapshot || {};
  const earningsHistory = activeData.earnings_history || activeData.earningsHistory || [];

  const annualRate = Number(dividendSnapshot.annual_rate ?? dividendSnapshot.annualRate ?? 0);
  const hasDividend = Number.isFinite(annualRate) && annualRate > 0;
  const yieldPct = Number(dividendSnapshot.yield_pct ?? dividendSnapshot.yieldPct ?? 0);
  const payoutRatioPct = dividendSnapshot.payout_ratio_pct ?? dividendSnapshot.payoutRatioPct ?? null;
  const fiveYearAvgYield = dividendSnapshot.five_year_avg_yield ?? dividendSnapshot.fiveYearAvgYield ?? null;

  const sortedEarningsHistory = useMemo(() => {
    return [...(earningsHistory || [])].sort((a, b) => {
      const dateA = String(a?.date || a?.earnings_date || "");
      const dateB = String(b?.date || b?.earnings_date || "");
      return dateB.localeCompare(dateA);
    });
  }, [earningsHistory]);

  return (
    <div
      className="fowa-fundamentals-drawer pw-fundamentals-catalyst-drawer bg-white border border-slate-200 rounded-xl p-5"
      data-testid="fundamentals-catalyst-drawer"
      style={{
        backgroundColor: "#ffffff",
        border: "1px solid var(--pw-line, #e2e8f0)",
        borderRadius: "14px",
        padding: "20px",
        color: "var(--pw-text, #162033)",
        boxShadow: "0 4px 16px rgba(22, 32, 51, 0.04)",
        display: "flex",
        flexDirection: "column",
        gap: "20px"
      }}
    >
      {/* Header */}
      <div
        className="fowa-fundamentals-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--pw-line, #e2e8f0)",
          paddingBottom: "12px"
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "16px" }}>📊</span>
            <h4 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--pw-text, #162033)" }}>
              Fundamentals &amp; Catalysts {symbol ? `· ${symbol}` : ""}
            </h4>
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--pw-muted, #64748b)" }}>
            Corporate earnings release horizon, dividend payout profile, and historical EPS surprise log.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Fundamentals Drawer"
            style={{
              background: "#f8fafc",
              border: "1px solid var(--pw-line, #cbd5e1)",
              color: "#475569",
              borderRadius: "8px",
              padding: "5px 11px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            ✕ Close
          </button>
        )}
      </div>

      {isLoading && !fetchedFundamentals && !propFundamentals && (
        <div style={{ fontSize: "13px", color: "var(--pw-muted, #64748b)", padding: "8px 0" }}>
          Loading fundamentals &amp; catalyst data for {symbol}...
        </div>
      )}

      {error && !fetchedFundamentals && !propFundamentals && (
        <div
          style={{
            fontSize: "13px",
            color: "#b91c1c",
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: "8px",
            padding: "10px 12px"
          }}
        >
          {error}
        </div>
      )}

      {/* Section 1: Upcoming Event Horizon */}
      <section className="fowa-fundamentals-section" data-testid="upcoming-event-horizon">
        <h5
          style={{
            margin: "0 0 10px",
            fontSize: "11.5px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--pw-muted, #64748b)"
          }}
        >
          Upcoming Event Horizon
        </h5>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "12px"
          }}
        >
          {/* Card A: Next Earnings Release date + Consensus EPS Est. */}
          <div
            className="fowa-event-horizon-card"
            data-testid="event-card-earnings"
            style={{
              background: "var(--pw-panel-soft, #f8fafc)",
              border: "1px solid var(--pw-line, #e2e8f0)",
              borderRadius: "12px",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "6px"
            }}
          >
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--pw-muted, #64748b)", textTransform: "uppercase" }}>
              Next Earnings Release
            </span>
            <strong style={{ fontSize: "18px", fontWeight: 800, color: "var(--pw-text, #162033)" }}>
              {calendar.next_earnings_date || "TBD"}
            </strong>
            <span style={{ fontSize: "12px", color: "#475569" }}>
              Consensus EPS Est:{" "}
              <strong style={{ color: "var(--pw-blue, #2563eb)" }}>
                {calendar.earnings_avg_est != null ? `$${Number(calendar.earnings_avg_est).toFixed(2)}` : "N/A"}
              </strong>
            </span>
          </div>

          {/* Card B: Next Ex-Dividend Date + Forward Annual Dollar Payout */}
          <div
            className="fowa-event-horizon-card"
            data-testid="event-card-dividend"
            style={{
              background: "var(--pw-panel-soft, #f8fafc)",
              border: "1px solid var(--pw-line, #e2e8f0)",
              borderRadius: "12px",
              padding: "14px 16px",
              display: "flex",
              flexDirection: "column",
              gap: "6px"
            }}
          >
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--pw-muted, #64748b)", textTransform: "uppercase" }}>
              Next Ex-Dividend Date
            </span>
            <strong style={{ fontSize: "18px", fontWeight: 800, color: "var(--pw-text, #162033)" }}>
              {calendar.ex_dividend_date || (hasDividend ? "TBD" : "Non-Dividend Payer")}
            </strong>
            <span style={{ fontSize: "12px", color: "#475569" }}>
              Forward Annual Payout:{" "}
              <strong style={{ color: hasDividend ? "var(--pw-blue, #2563eb)" : "#64748b" }}>
                {hasDividend ? `$${annualRate.toFixed(2)} / sh` : "$0.00 / sh"}
              </strong>
            </span>
          </div>
        </div>
      </section>

      {/* Section 2: Dividend Snapshot (Conditioned on annual_rate > 0) */}
      {hasDividend && (
        <section className="fowa-fundamentals-section" data-testid="dividend-snapshot-strip">
          <h5
            style={{
              margin: "0 0 10px",
              fontSize: "11.5px",
              fontWeight: 800,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--pw-muted, #64748b)"
            }}
          >
            Dividend Snapshot
          </h5>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "10px",
              background: "var(--pw-panel-soft, #f8fafc)",
              border: "1px solid var(--pw-line, #e2e8f0)",
              borderRadius: "12px",
              padding: "12px 16px"
            }}
          >
            <div>
              <div style={{ fontSize: "11px", color: "var(--pw-muted, #64748b)", fontWeight: 600 }}>Forward Yield %</div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#0284c7", marginTop: "2px" }}>
                {`${yieldPct.toFixed(2)}%`}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--pw-muted, #64748b)", fontWeight: 600 }}>Payout Ratio %</div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--pw-text, #162033)", marginTop: "2px" }}>
                {payoutRatioPct != null ? `${Number(payoutRatioPct).toFixed(1)}%` : "N/A"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--pw-muted, #64748b)", fontWeight: 600 }}>Annual Cash Rate ($)</div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#059669", marginTop: "2px" }}>
                {`$${annualRate.toFixed(2)}`}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "var(--pw-muted, #64748b)", fontWeight: 600 }}>5-Year Avg Yield %</div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "var(--pw-text, #162033)", marginTop: "2px" }}>
                {fiveYearAvgYield != null ? `${Number(fiveYearAvgYield).toFixed(2)}%` : "N/A"}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Section 3: Historical Earnings Surprise Log */}
      <section className="fowa-fundamentals-section" data-testid="earnings-surprise-log">
        <h5
          style={{
            margin: "0 0 10px",
            fontSize: "11.5px",
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--pw-muted, #64748b)"
          }}
        >
          Historical Earnings Surprise Log
        </h5>
        {sortedEarningsHistory.length === 0 ? (
          <div
            style={{
              background: "var(--pw-panel-soft, #f8fafc)",
              border: "1px solid var(--pw-line, #e2e8f0)",
              borderRadius: "10px",
              padding: "16px",
              fontSize: "13px",
              color: "var(--pw-muted, #64748b)",
              textAlign: "center"
            }}
          >
            No historical earnings records available yet.
          </div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid var(--pw-line, #e2e8f0)", borderRadius: "12px" }}>
            <table
              className="fowa-surprise-log-table"
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "13px",
                textAlign: "left",
                background: "#ffffff"
              }}
            >
              <thead>
                <tr style={{ background: "#f8fafc", color: "#475569", borderBottom: "1px solid var(--pw-line, #e2e8f0)" }}>
                  <th style={{ padding: "10px 14px", fontWeight: 700 }}>Report Date</th>
                  <th style={{ padding: "10px 14px", fontWeight: 700 }}>Consensus Est.</th>
                  <th style={{ padding: "10px 14px", fontWeight: 700 }}>Reported EPS</th>
                  <th style={{ padding: "10px 14px", fontWeight: 700 }}>Surprise %</th>
                </tr>
              </thead>
              <tbody>
                {sortedEarningsHistory.map((item, idx) => {
                  const reportDate = item.date || item.earnings_date || "—";
                  const est = item.eps_estimate ?? item.epsEstimate;
                  const rep = item.eps_reported ?? item.epsReported;
                  const surp = item.surprise_pct ?? item.surprisePct;
                  const badge = formatSurpriseTag(surp, rep);

                  return (
                    <tr
                      key={`${reportDate}-${idx}`}
                      style={{
                        borderBottom:
                          idx < sortedEarningsHistory.length - 1 ? "1px solid var(--pw-line, #f1f5f9)" : "none"
                      }}
                    >
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--pw-text, #162033)" }}>{reportDate}</td>
                      <td style={{ padding: "10px 14px", color: "#475569" }}>
                        {est !== null && est !== undefined ? `$${Number(est).toFixed(2)}` : "—"}
                      </td>
                      <td style={{ padding: "10px 14px", fontWeight: 700, color: "var(--pw-text, #162033)" }}>
                        {rep !== null && rep !== undefined ? `$${Number(rep).toFixed(2)}` : "Pending"}
                      </td>
                      <td style={{ padding: "10px 14px" }}>
                        <span
                          className={`fowa-surprise-pill fowa-surprise-${badge.tone}`}
                          data-testid="earnings-surprise-pill"
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: "9999px",
                            fontSize: "11px",
                            fontWeight: 700,
                            backgroundColor:
                              badge.tone === "beat"
                                ? "rgba(16, 185, 129, 0.14)"
                                : badge.tone === "miss"
                                ? "rgba(239, 68, 68, 0.14)"
                                : "#f1f5f9",
                            color:
                              badge.tone === "beat"
                                ? "#059669"
                                : badge.tone === "miss"
                                ? "#dc2626"
                                : "#64748b",
                            border:
                              badge.tone === "beat"
                                ? "1px solid rgba(16, 185, 129, 0.35)"
                                : badge.tone === "miss"
                                ? "1px solid rgba(239, 68, 68, 0.35)"
                                : "1px solid #cbd5e1"
                          }}
                        >
                          {badge.text}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
