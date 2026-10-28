import { useMemo, useState } from "react";
import { fmtMoney, fmtPct, fmtSignedMoney, latestPrice, stockChange, stockPriceChange } from "../viewModel";

export default function AccountStockSelector({
  data,
  account,
  onAddStock
}) {
  const [search, setSearch] = useState("");
  const [addingSymbol, setAddingSymbol] = useState(null);
  const [error, setError] = useState("");

  const holdings = data.holdingsByAccount[String(account?.id)] || [];
  const heldSymbolSet = useMemo(() => new Set(holdings.map((h) => h.symbol)), [holdings]);

  const availableStocks = useMemo(() => {
    return (data?.stocks || [])
      .filter((stock) => !heldSymbolSet.has(stock.symbol))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [data?.stocks, heldSymbolSet]);

  const filteredStocks = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return availableStocks;
    return availableStocks.filter((stock) =>
      stock.symbol.toLowerCase().includes(query) ||
      (stock.name || "").toLowerCase().includes(query) ||
      (stock.sector || "").toLowerCase().includes(query)
    );
  }, [availableStocks, search]);

  async function handleQuickAdd(stock) {
    if (!onAddStock || addingSymbol) return;
    setAddingSymbol(stock.symbol);
    setError("");
    try {
      await onAddStock(stock.symbol);
    } catch (err) {
      setError(err?.message || `Failed to add ${stock.symbol} to portfolio.`);
    } finally {
      setAddingSymbol(null);
    }
  }

  function handleDragStart(event, stock) {
    event.dataTransfer.setData("text/plain", stock.symbol);
    event.dataTransfer.setData("application/json", JSON.stringify({
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector
    }));
    event.dataTransfer.effectAllowed = "copy";
  }

  return (
    <div className="pw-stock-selector">
      <div className="pw-stock-selector-head">
        <div className="pw-stock-selector-titles">
          <div className="pw-selector-badge">Portfolio Edit Mode</div>
          <h4 className="pw-selector-title">
            Add Stocks to <span>{account?.name}</span>
          </h4>
          <p className="pw-selector-desc">
            Drag any stock to the left <strong>Holdings</strong> list, or click <strong>+ Add</strong>.
          </p>
        </div>
        <div className="pw-selector-meta">
          <span className="pw-selector-count">
            {availableStocks.length} {availableStocks.length === 1 ? "stock" : "stocks"} available
          </span>
        </div>
      </div>

      <div className="pw-selector-search-bar">
        <input
          type="text"
          placeholder="Filter by ticker, company, or sector..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter available stocks"
          autoComplete="off"
          spellCheck="false"
        />
        {search && (
          <button
            type="button"
            className="pw-search-clear-btn"
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {error && <div className="pw-inline-error pw-selector-error">{error}</div>}

      <div className="pw-selector-list-wrap">
        {availableStocks.length === 0 ? (
          <div className="pw-empty-state">
            All tracked stocks in the database are already held in <strong>{account?.name}</strong>.
          </div>
        ) : filteredStocks.length === 0 ? (
          <div className="pw-empty-state">
            No available stocks match &quot;{search}&quot;.
          </div>
        ) : (
          <div className="pw-selector-grid">
            {filteredStocks.map((stock) => {
              const price = stock?.lastPrice ?? latestPrice(data, stock.symbol)?.close ?? 0;
              const change = stockChange(data, stock.symbol);
              const priceDiff = stockPriceChange(data, stock.symbol);
              const isAdding = addingSymbol === stock.symbol;

              return (
                <div
                  key={stock.symbol}
                  className={`pw-draggable-stock-card ${isAdding ? "pw-stock-adding" : ""}`}
                  draggable={!isAdding}
                  onDragStart={(e) => handleDragStart(e, stock)}
                  title={`Drag ${stock.symbol} to the left holdings list, or click + Add`}
                >
                  <div className="pw-drag-grip" aria-hidden="true" title="Drag me">
                    ⋮⋮
                  </div>
                  <div className="pw-stock-card-main">
                    <div className="pw-stock-card-top">
                      <strong className="pw-stock-card-symbol">{stock.symbol}</strong>
                      {stock.sector && (
                        <span className="pw-stock-card-sector">{stock.sector}</span>
                      )}
                    </div>
                    <div className="pw-stock-card-name" title={stock.name}>
                      {stock.name || "—"}
                    </div>
                  </div>
                  <div className="pw-stock-card-metrics">
                    <span className="pw-stock-card-price">{fmtMoney(price)}</span>
                    <span
                      className={`pw-stock-card-change ${change >= 0 ? "pw-up" : "pw-down"}`}
                    >
                      {fmtSignedMoney(priceDiff)} ({fmtPct(change)})
                    </span>
                  </div>
                  <button
                    type="button"
                    className="pw-stock-add-btn"
                    disabled={isAdding}
                    onClick={() => handleQuickAdd(stock)}
                    title={`Add ${stock.symbol} to ${account?.name}`}
                    aria-label={`Add ${stock.symbol}`}
                  >
                    {isAdding ? "…" : "+ Add"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
