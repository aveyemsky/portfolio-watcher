import { Fragment, useMemo } from "react";
import { fmtPct, getHolding } from "../viewModel";
import { groupStocksBySector } from "./stockGrouping";
import StockCard from "./StockCard";

export default function StockGridView({
  data,
  stocks,
  mode,
  state,
  dispatch,
  manageMode,
  isEditing,
  onDeleteStock,
  onRemoveHolding,
  onRemoveSection,
  onUpdateHolding,
  apiBaseUrl
}) {
  const query = state?.search?.trim().toLowerCase() || "";
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

  const isSectorGrouping =
    state?.gridGroupBy === "sector" && !stocks.some((s) => s.isSectionHeader);

  const sectorGroups = useMemo(() => {
    if (!isSectorGrouping) return [];
    return groupStocksBySector(filteredStocks, data);
  }, [isSectorGrouping, filteredStocks, data]);

  const activeAccount = (data?.accounts || []).find((a) => a.id === state?.activeAccountId);

  if (!filteredStocks.length) {
    const emptyMessage = mode === "all"
      ? query
        ? `No stocks match "${state.search}".`
        : manageMode
          ? "No stocks yet. Add a symbol above to begin."
          : "No stocks yet. Click + to add a tracked stock."
      : query
        ? `No holdings match "${state.search}".`
        : manageMode
          ? "No holdings yet. Drag stocks from the right or add a holding above."
          : "No holdings yet. Click + to add a holding to this portfolio.";

    return (
      <div className="pw-empty-state pw-grid-empty-state">
        {emptyMessage}
      </div>
    );
  }

  function handleCardClick(stock) {
    dispatch({ type: "selectStock", symbol: stock.symbol });
    dispatch({ type: "setViewMode", mode: "list" });
  }

  function renderStockCard(stock) {
    const holding = getHolding(data, state?.activeAccountId, stock.symbol) || (stock.holdingId ? stock : null);
    return (
      <StockCard
        key={stock.symbol}
        stock={stock}
        holding={holding}
        account={activeAccount}
        data={data}
        state={state}
        dispatch={dispatch}
        mode={mode}
        manageMode={manageMode}
        isEditing={isEditing}
        onRemoveHolding={onRemoveHolding}
        onDeleteStock={onDeleteStock}
        onUpdateHolding={onUpdateHolding}
        onClick={handleCardClick}
      />
    );
  }

  if (isSectorGrouping) {
    const allGroupNames = sectorGroups.map((g) => g.sector);

    return (
      <div className="pw-selector-grid pw-stock-grid-view">
        <div className="pw-grid-group-toolbar">
          <div className="pw-grid-group-meta">
            <span className="pw-grid-group-count">
              {sectorGroups.length} {sectorGroups.length === 1 ? "sector" : "sectors"}
            </span>
            <span className="pw-dot-sep">·</span>
            <span className="pw-grid-total-count">{filteredStocks.length} stocks</span>
          </div>
          <div className="pw-grid-group-actions">
            <button
              type="button"
              className="pw-grid-group-action-btn"
              onClick={() =>
                dispatch?.({
                  type: "setAllSectorsCollapse",
                  collapsed: true,
                  sectors: allGroupNames
                })
              }
            >
              Collapse All
            </button>
            <button
              type="button"
              className="pw-grid-group-action-btn"
              onClick={() =>
                dispatch?.({
                  type: "setAllSectorsCollapse",
                  collapsed: false,
                  sectors: allGroupNames
                })
              }
            >
              Expand All
            </button>
          </div>
        </div>

        {sectorGroups.map((group) => {
          const isCollapsed = Boolean(state?.collapsedSectors?.[group.sector]);
          const isUp = group.avgChange >= 0;

          return (
            <Fragment key={`sector-${group.sector}`}>
              <div
                className={`pw-grid-section-divider pw-grid-sector-divider ${isCollapsed ? "pw-collapsed" : ""}`}
                onClick={() => dispatch?.({ type: "toggleSectorCollapse", sector: group.sector })}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    dispatch?.({ type: "toggleSectorCollapse", sector: group.sector });
                  }
                }}
                title={isCollapsed ? `Expand ${group.sector}` : `Collapse ${group.sector}`}
                aria-expanded={!isCollapsed}
              >
                <div className="pw-sector-header-left">
                  <span className="pw-sector-chevron">{isCollapsed ? "▶" : "▼"}</span>
                  <span className="pw-grid-section-label">{group.sector}</span>
                  <span className="pw-sector-count-pill">{group.count}</span>
                </div>
                <div className="pw-sector-header-right">
                  <span className={`pw-sector-perf-badge ${isUp ? "pw-up" : "pw-down"}`}>
                    {fmtPct(group.avgChange)} avg
                  </span>
                </div>
              </div>

              {!isCollapsed && group.stocks.map((stock) => renderStockCard(stock))}
            </Fragment>
          );
        })}
      </div>
    );
  }

  return (
    <div className="pw-selector-grid pw-stock-grid-view">
      {filteredStocks.map((stock, index) => {
        if (stock.isSectionHeader) {
          return (
            <div key={`section-${stock.id || index}`} className="pw-grid-section-divider">
              <span className="pw-grid-section-label">{stock.sectionLabel}</span>
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
        return renderStockCard(stock);
      })}
    </div>
  );
}
