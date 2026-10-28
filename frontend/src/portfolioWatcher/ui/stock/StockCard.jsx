import React, { useState, useEffect } from "react";
import {
  accountValue,
  fmtMoney,
  fmtMoney0,
  fmtPct,
  fmtSignedMoney,
  fmtTodayChange,
  getCategoryKey,
  getExtendedHoursQuote,
  latestPrice,
  stockChange,
  stockPriceChange
} from "../viewModel";

export function getStockCardBadges(stock, fundamentals = null, refDate = null) {
  let resolvedFundamentals = fundamentals;
  let resolvedRefDate = refDate;
  if (
    fundamentals instanceof Date ||
    typeof fundamentals === "string" ||
    typeof fundamentals === "number"
  ) {
    resolvedRefDate = fundamentals;
    resolvedFundamentals = null;
  }

  if (!stock && !resolvedFundamentals) {
    return { earningsBadge: null, dividendBadge: null };
  }

  const rawEarningsDate =
    resolvedFundamentals?.calendar?.next_earnings_date ??
    resolvedFundamentals?.next_earnings_date ??
    stock?.next_earnings_date ??
    stock?.nextEarningsDate ??
    stock?.calendar?.next_earnings_date ??
    stock?.calendar?.nextEarningsDate ??
    stock?.fundamentals?.calendar?.next_earnings_date ??
    null;

  const rawYieldPct =
    resolvedFundamentals?.dividend_snapshot?.yield_pct ??
    resolvedFundamentals?.dividend_snapshot?.yieldPct ??
    stock?.dividend_snapshot?.yield_pct ??
    stock?.dividend_snapshot?.yieldPct ??
    stock?.dividendSnapshot?.yield_pct ??
    stock?.dividendSnapshot?.yieldPct ??
    stock?.fundamentals?.dividend_snapshot?.yield_pct ??
    stock?.yield_pct ??
    stock?.dividendYieldPct ??
    null;

  let earningsBadge = null;
  if (rawEarningsDate) {
    const match = String(rawEarningsDate).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, yr, mo, dy] = match;
      const mmdd = `${mo}/${dy}`;
      const targetUtc = Date.UTC(Number(yr), Number(mo) - 1, Number(dy));
      const now = resolvedRefDate ? new Date(resolvedRefDate) : new Date();
      const todayUtc = resolvedRefDate
        ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
        : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
      const diffDays = Math.round((targetUtc - todayUtc) / 86400000);

      if (diffDays >= 0 && diffDays <= 7) {
        earningsBadge = {
          type: "caution",
          text: `⚠️ EPS in ${diffDays}d (${mmdd})`,
          daysUntil: diffDays,
          mmdd,
          date: `${yr}-${mo}-${dy}`
        };
      } else if (diffDays > 7) {
        earningsBadge = {
          type: "muted",
          text: `📅 EPS: ${mmdd}`,
          daysUntil: diffDays,
          mmdd,
          date: `${yr}-${mo}-${dy}`
        };
      }
    }
  }

  let dividendBadge = null;
  const yieldNum = rawYieldPct != null ? Number(rawYieldPct) : 0;
  if (Number.isFinite(yieldNum) && yieldNum > 0) {
    dividendBadge = {
      text: `Div ${yieldNum.toFixed(2)}%`,
      yieldPct: yieldNum
    };
  }

  return { earningsBadge, dividendBadge };
}

export default function StockCard({
  stock,
  holding,
  account,
  category,
  data,
  state,
  dispatch,
  mode = "holdings",
  manageMode = false,
  isEditing = false,
  onRemoveHolding,
  onDeleteStock,
  onUpdateHolding,
  onClick,
  fundamentals = null,
  refDate = null
}) {
  const currentCategory = category || (data?.categories || []).find(
    (c) => c.id === (account?.categoryId || account?.category_id)
  );
  const isBrokerage = getCategoryKey(currentCategory, account) === "accounts";
  const sizingMode = account?.sizing_mode || account?.sizingMode || "PERCENT";
  const isPercentMode = !isBrokerage || sizingMode === "PERCENT";

  const price = stock?.lastPrice ?? latestPrice(data, stock?.symbol)?.close ?? 0;
  const change = stockChange(data, stock?.symbol);
  const priceDiff = stockPriceChange(data, stock?.symbol);
  const isUp = change >= 0;
  const extQuote = getExtendedHoursQuote(stock);
  const { earningsBadge, dividendBadge } = getStockCardBadges(stock, fundamentals, refDate);


  // Inline edit state
  const [editShares, setEditShares] = useState(holding?.shares ?? "");
  const [editWeight, setEditWeight] = useState(holding?.weight_pct ?? holding?.weightPct ?? "");
  const [editAvgCost, setEditAvgCost] = useState(holding?.avgCost ?? "");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditShares(holding?.shares ?? "");
    setEditWeight(holding?.weight_pct ?? holding?.weightPct ?? "");
    setEditAvgCost(holding?.avgCost ?? "");
  }, [holding?.shares, holding?.weight_pct, holding?.weightPct, holding?.avgCost]);

  const handleCardClick = () => {
    if (onClick) {
      onClick(stock);
    } else if (dispatch && stock?.symbol) {
      dispatch({ type: "selectStock", symbol: stock.symbol });
      dispatch({ type: "setViewMode", mode: "list" });
    }
  };

  const handleSaveHolding = async (e) => {
    e.stopPropagation();
    if (!onUpdateHolding || !account?.id || !stock?.symbol) return;
    setIsSaving(true);
    try {
      const payload = {};
      if (isBrokerage) {
        if (sizingMode === "SHARES") {
          payload.shares = editShares !== "" ? parseFloat(editShares) : 0;
        } else {
          payload.weight_pct = editWeight !== "" ? parseFloat(editWeight) : null;
        }
        if (editAvgCost !== "") {
          payload.avgCost = parseFloat(editAvgCost);
        }
      }
      await onUpdateHolding(account.id, stock.symbol, payload);
    } finally {
      setIsSaving(false);
    }
  };

  // Compute allocation metrics
  const totalAccValue = accountValue(data, account?.id || state?.activeAccountId);
  const effWeight = holding?.effective_weight_pct ?? holding?.effectiveWeightPct;
  const isAutoWeight = (holding?.weight_pct == null && holding?.weightPct == null);

  const sharesNum = Number(holding?.shares || 0);
  const holdingVal = sharesNum * price;
  const sharesWeight = totalAccValue > 0 ? ((holdingVal / totalAccValue) * 100).toFixed(1) : "0.0";
  const displayWeightPct = effWeight != null ? Number(effWeight).toFixed(1) : sharesWeight;

  const avgCostNum = Number(holding?.avgCost || 0);
  const unrealizedPnl = avgCostNum > 0 && sharesNum > 0 ? (price - avgCostNum) * sharesNum : 0;
  const unrealizedPct = avgCostNum > 0 ? ((price - avgCostNum) / avgCostNum) * 100 : 0;

  const showInlineEditor = (isEditing || manageMode) && isBrokerage && mode === "holdings" && holding;

  return (
    <div
      className={`pw-stock-grid-card ${state?.selectedType === "stock" && state?.selectedStockSymbol === stock?.symbol ? "pw-active" : ""}`}
      onClick={handleCardClick}
      title={`Click to view ${stock?.symbol} chart and details`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <div className="pw-stock-card-main">
        <div className="pw-stock-card-top">
          <strong className="pw-stock-card-symbol">{stock?.symbol}</strong>
          {(earningsBadge || dividendBadge) && (
            <span className="pw-stock-card-fundamental-badges" data-testid="stock-card-fundamental-badges">
              {earningsBadge && (
                <span
                  className={`pw-stock-card-earnings-badge ${
                    earningsBadge.type === "caution" ? "pw-earnings-caution" : "pw-earnings-muted"
                  }`}
                  data-testid="stock-card-earnings-badge"
                >
                  {earningsBadge.text}
                </span>
              )}
              {dividendBadge && (
                <span
                  className="pw-stock-card-dividend-badge"
                  data-testid="stock-card-dividend-badge"
                >
                  {dividendBadge.text}
                </span>
              )}
            </span>
          )}
          {stock?.sector && (
            <span className="pw-stock-card-sector">{stock.sector}</span>
          )}
          {mode === "all" && holding && (
            <span className="pw-stock-card-held-pill" title="Held in active portfolio">
              Held
            </span>
          )}
        </div>
        <div className="pw-stock-card-name" title={stock?.name}>
          {stock?.name || "—"}
        </div>

        {/* Allocation Badge */}
        {mode === "holdings" && holding && (
          <div className="pw-grid-holding-badge" data-testid="stock-card-allocation-badge">
            {isPercentMode ? (
              <span className="pw-allocation-pct">
                {`Weight: ${displayWeightPct}%${isAutoWeight ? " (Auto)" : ""}`}
              </span>
            ) : (
              <div className="pw-allocation-shares" style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                <span>{`${sharesNum} sh`}</span>
                <span className="pw-dot-sep">·</span>
                <span>{`${displayWeightPct}% of acc`}</span>
                {avgCostNum > 0 && sharesNum > 0 && (
                  <>
                    <span className="pw-dot-sep">·</span>
                    <span className={unrealizedPnl >= 0 ? "pw-up" : "pw-down"} style={{ fontWeight: 700 }}>
                      {`${unrealizedPnl >= 0 ? "+" : ""}${fmtMoney(unrealizedPnl)} (${fmtPct(unrealizedPct)})`}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Inline Card Editor for Brokerage Accounts */}
        {showInlineEditor && (
          <div
            className="pw-card-inline-editor"
            style={{
              marginTop: "8px",
              padding: "6px",
              background: "rgba(255, 255, 255, 0.04)",
              borderRadius: "6px",
              display: "flex",
              flexDirection: "column",
              gap: "4px"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", gap: "4px" }}>
              {isPercentMode ? (
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  placeholder="Weight %"
                  value={editWeight}
                  onChange={(e) => setEditWeight(e.target.value)}
                  style={{ width: "50%", padding: "2px 4px", fontSize: "11px", borderRadius: "4px", border: "1px solid var(--pw-line, #334155)", background: "#0f172a", color: "#f8fafc" }}
                />
              ) : (
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="Shares"
                  value={editShares}
                  onChange={(e) => setEditShares(e.target.value)}
                  style={{ width: "50%", padding: "2px 4px", fontSize: "11px", borderRadius: "4px", border: "1px solid var(--pw-line, #334155)", background: "#0f172a", color: "#f8fafc" }}
                />
              )}
              <input
                type="number"
                min="0"
                step="any"
                placeholder="Avg Cost"
                value={editAvgCost}
                onChange={(e) => setEditAvgCost(e.target.value)}
                style={{ width: "50%", padding: "2px 4px", fontSize: "11px", borderRadius: "4px", border: "1px solid var(--pw-line, #334155)", background: "#0f172a", color: "#f8fafc" }}
              />
            </div>
            <button
              type="button"
              className="pw-btn-primary"
              style={{ padding: "2px 8px", fontSize: "10px", alignSelf: "flex-end" }}
              disabled={isSaving}
              onClick={handleSaveHolding}
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        )}
      </div>

      <div className="pw-stock-card-metrics">
        <span className="pw-stock-card-price">{fmtMoney(price)}</span>
        <span className={`pw-stock-card-change ${isUp ? "pw-up" : "pw-down"}`}>
          {fmtSignedMoney(priceDiff)} ({fmtPct(change)})
        </span>
        {extQuote && (
          <span className={`pw-item-after-hours pw-grid-ext pw-${extQuote.tone}`}>
            <span className={`pw-ext-badge pw-${extQuote.type}`}>{extQuote.label}</span>
            {fmtTodayChange(extQuote.diff, extQuote.pct)}
            <span className="pw-ext-price">{fmtMoney(extQuote.price)}</span>
          </span>
        )}
      </div>

      {manageMode && (
        <button
          type="button"
          className="pw-grid-card-manage-btn"
          aria-label={mode === "holdings" ? `Remove ${stock?.symbol}` : `Delete ${stock?.symbol}`}
          title={mode === "holdings" ? `Remove ${stock?.symbol} from portfolio` : `Delete ${stock?.symbol} from database`}
          onClick={(e) => {
            e.stopPropagation();
            if (mode === "holdings") {
              onRemoveHolding?.(stock?.symbol);
            } else {
              onDeleteStock?.(stock?.symbol);
            }
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
