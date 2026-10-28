import { useState } from "react";
import ListItem from "../shared/ListItem";
import { getStockCardBadges } from "./StockCard";
import { accountValue, fmtMoney, fmtMoney0, fmtTodayChange, getExtendedHoursQuote, getHolding, latestPrice, stockChange, stockPriceChange } from "../viewModel";

export default function StockList({
  data,
  stocks,
  mode,
  state,
  dispatch,
  manageMode,
  onDeleteStock,
  onRemoveHolding,
  onRemoveSection,
  onReorderItems
}) {
  const [draggedIdx, setDraggedIdx] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const isDndEnabled = Boolean(manageMode && mode === "holdings" && onReorderItems);

  const query = (state?.search || "").trim().toLowerCase();
  const filteredStocks = query
    ? stocks.filter((stock) =>
      stock.isSectionHeader
        ? (stock.sectionLabel || "").toLowerCase().includes(query)
        : (
          stock.symbol?.toLowerCase().includes(query) ||
          stock.name?.toLowerCase().includes(query) ||
          stock.sector?.toLowerCase().includes(query)
        )
    )
    : stocks;

  function handleDragStart(e, idx) {
    if (!isDndEnabled) return;
    setDraggedIdx(idx);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-pw-reorder", String(idx));
    e.dataTransfer.setData("text/plain", String(idx));
    e.stopPropagation();
  }

  function handleDragOver(e, idx) {
    if (!isDndEnabled || draggedIdx === null) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const isBottom = (e.clientY - rect.top) > (rect.height / 2);
    const position = isBottom ? "after" : "before";

    if (
      !dropTarget ||
      dropTarget.index !== idx ||
      dropTarget.position !== position
    ) {
      setDropTarget({ index: idx, position });
    }
  }

  function handleDragEnd(e) {
    if (e) e.stopPropagation();
    setDraggedIdx(null);
    setDropTarget(null);
  }

  function handleDrop(e, targetIdx) {
    if (!isDndEnabled || draggedIdx === null) return;
    e.preventDefault();
    e.stopPropagation();

    const fromIdx = draggedIdx;
    const target = dropTarget || { index: targetIdx, position: "before" };
    setDraggedIdx(null);
    setDropTarget(null);

    const destIdx = target.position === "after" ? target.index + 1 : target.index;
    if (fromIdx === destIdx || fromIdx === destIdx - 1) {
      return;
    }

    const insertIdx = fromIdx < destIdx ? destIdx - 1 : destIdx;
    const reordered = [...stocks];
    const [movedItem] = reordered.splice(fromIdx, 1);
    reordered.splice(insertIdx, 0, movedItem);

    onReorderItems?.(reordered);
  }

  if (!filteredStocks.length) {
    const emptyMessage = mode === "all"
      ? manageMode
        ? "No stocks yet. Add a symbol above to begin."
        : "No stocks yet. Click + to add a tracked stock."
      : manageMode
        ? "No holdings yet. Drag stocks from the right or add a holding above."
        : "No holdings yet. Click + to add a holding to this portfolio.";

    return (
      <div className="pw-empty-state">
        {emptyMessage}
      </div>
    );
  }

  const total = mode === "holdings" ? accountValue(data, state.activeAccountId) : 0;

  return (
    <div
      className="pw-list-wrap"
      onDragOver={(e) => {
        if (!isDndEnabled || draggedIdx === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.target === e.currentTarget && filteredStocks.length > 0) {
          setDropTarget({ index: filteredStocks.length - 1, position: "after" });
        }
      }}
      onDrop={(e) => {
        if (!isDndEnabled || draggedIdx === null) return;
        e.preventDefault();
        e.stopPropagation();
        if (dropTarget) {
          handleDrop(e, dropTarget.index);
        }
      }}
    >
      {filteredStocks.map((stock, index) => {
        const isDragging = draggedIdx === index;
        const isOverBefore = dropTarget?.index === index && dropTarget?.position === "before" && draggedIdx !== index;
        const isOverAfter = dropTarget?.index === index && dropTarget?.position === "after" && draggedIdx !== index;
        const dragOverClass = isOverBefore ? "pw-drag-over pw-drag-over-before" : isOverAfter ? "pw-drag-over-after" : "";

        if (stock.isSectionHeader) {
          return (
            <div
              key={`section-${stock.id || index}`}
              className={`pw-list-section-header ${isDndEnabled ? "pw-draggable-item" : ""} ${isDragging ? "pw-dragging" : ""} ${dragOverClass}`}
              draggable={isDndEnabled}
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, index)}
            >
              {isDndEnabled && <span className="pw-drag-handle" title="Drag to reorder">⠿</span>}
              <span className="pw-list-section-label">{stock.sectionLabel}</span>
              {manageMode && onRemoveSection && (
                <button
                  type="button"
                  className="pw-section-remove-btn"
                  title={`Delete section "${stock.sectionLabel}"`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveSection(stock.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        }

        const holding = getHolding(data, state.activeAccountId, stock.symbol);
        const price = stock?.lastPrice ?? latestPrice(data, stock.symbol)?.close ?? 0;
        const change = stockChange(data, stock.symbol);
        const priceDiff = stockPriceChange(data, stock.symbol);
        const hasShares = Boolean(holding && holding.shares > 0);
        const value = holding ? holding.shares * price : 0;
        const pnl = holding ? (price - holding.avgCost) * holding.shares : 0;
        const subtitle = mode === "holdings"
          ? hasShares
            ? `${stock.name || stock.symbol} · ${holding.shares} sh (${fmtMoney0(value)}) · ${total ? ((value / total) * 100).toFixed(1) : "0.0"}% weight`
            : (stock.name || stock.symbol)
          : `${stock.name || stock.symbol}${holding ? " · held in active portfolio" : ""}`;

        const extQuote = getExtendedHoursQuote(stock);
        const { earningsBadge, dividendBadge } = getStockCardBadges(stock);
        const titleNode = (earningsBadge || dividendBadge) ? (
          <span className="pw-item-title-with-badges">
            <span>{stock.symbol}</span>
            <span className="pw-stock-card-fundamental-badges" data-testid="stock-list-fundamental-badges">
              {earningsBadge && (
                <span
                  className={`pw-stock-card-earnings-badge ${
                    earningsBadge.type === "caution" ? "pw-earnings-caution" : "pw-earnings-muted"
                  }`}
                  data-testid="stock-list-earnings-badge"
                >
                  {earningsBadge.text}
                </span>
              )}
              {dividendBadge && (
                <span
                  className="pw-stock-card-dividend-badge"
                  data-testid="stock-list-dividend-badge"
                >
                  {dividendBadge.text}
                </span>
              )}
            </span>
          </span>
        ) : stock.symbol;

        const extra = extQuote ? (
          <span className={`pw-item-after-hours pw-${extQuote.tone}`}>
            <span className={`pw-ext-badge pw-${extQuote.type}`}>{extQuote.label}</span>
            {fmtTodayChange(extQuote.diff, extQuote.pct)}
            <span className="pw-ext-price">{fmtMoney(extQuote.price)}</span>
          </span>
        ) : null;

        return (
          <ListItem
            key={stock.symbol || `stock-${index}`}
            title={titleNode}
            subtitle={subtitle}
            rightTop={fmtMoney(price)}
            rightBottom={fmtTodayChange(priceDiff, change)}
            extra={extra}
            tone={change >= 0 ? "up" : "down"}
            active={state.selectedType === "stock" && state.selectedStockSymbol === stock.symbol}
            onClick={() => dispatch({ type: "selectStock", symbol: stock.symbol })}
            manageMode={manageMode}
            manageLabel={mode === "holdings" ? `Remove ${stock.symbol}` : `Delete ${stock.symbol}`}
            onManageAction={
              mode === "holdings"
                ? () => onRemoveHolding?.(stock.symbol)
                : () => onDeleteStock?.(stock.symbol)
            }
            className={`${isDndEnabled ? "pw-draggable-item" : ""} ${isDragging ? "pw-dragging" : ""} ${dragOverClass}`}
            draggable={isDndEnabled}
            dragHandle={isDndEnabled}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onDrop={(e) => handleDrop(e, index)}
          />
        );
      })}
    </div>
  );
}
