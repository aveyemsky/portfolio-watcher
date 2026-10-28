import { useState, useRef, useEffect } from "react";
import { accountValue, fmtMoney0, fmtPct, stockChange } from "../viewModel";

export default function CategoryAccordion({
  category,
  portfolios = [],
  isCollapsed = false,
  onToggleCollapse,
  onSelectPortfolio,
  activePortfolioId,
  isPortfolioActive = false,
  manageMode = false,
  onAddPortfolioToCategory,
  onRenameCategory,
  onDeleteCategory,
  onDeletePortfolio,
  data
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  function getPortfolioMetrics(portfolio) {
    const holdings = data?.holdingsByAccount?.[String(portfolio.id)] || [];
    const stockHoldings = holdings.filter((h) => !h.isSectionHeader);
    const totalVal = accountValue(data, portfolio.id);

    // If portfolio has active capital balance (> 0)
    if (totalVal > 0) {
      return {
        type: "capital",
        primaryText: fmtMoney0(totalVal),
        subText: null
      };
    }

    // Otherwise calculate ticker count and average change
    const tickerCount = stockHoldings.length;
    let avgChange = 0;
    if (tickerCount > 0) {
      const sum = stockHoldings.reduce((acc, h) => acc + stockChange(data, h.symbol), 0);
      avgChange = sum / tickerCount;
    }

    return {
      type: "basket",
      primaryText: `${tickerCount} ${tickerCount === 1 ? "ticker" : "tickers"}`,
      changePct: tickerCount > 0 ? avgChange : null
    };
  }

  return (
    <div className="pw-category-accordion">
      <div className="pw-category-header">
        <button
          type="button"
          className="pw-category-collapse-btn"
          aria-label={isCollapsed ? `Expand ${category.name}` : `Collapse ${category.name}`}
          onClick={() => onToggleCollapse?.(category.id)}
        >
          <span className="pw-category-chevron">{isCollapsed ? "▶" : "▼"}</span>
          <span className="pw-category-title">{category.name}</span>
        </button>

        <div className="pw-category-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="pw-category-menu-trigger"
            aria-label={`Options for ${category.name}`}
            title="Category options"
            onClick={() => setMenuOpen((curr) => !curr)}
          >
            ⋮
          </button>
          {menuOpen && (
            <div className="pw-category-dropdown" role="menu">
              {onAddPortfolioToCategory && (
                <button
                  type="button"
                  className="pw-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onAddPortfolioToCategory?.(category.id);
                  }}
                >
                  + Add Portfolio to Category
                </button>
              )}
              {onRenameCategory && (
                <button
                  type="button"
                  className="pw-dropdown-item"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onRenameCategory?.(category);
                  }}
                >
                  ✏️ Rename Category
                </button>
              )}
              {onDeleteCategory && (
                <button
                  type="button"
                  className="pw-dropdown-item pw-dropdown-item--danger"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onDeleteCategory?.(category);
                  }}
                >
                  🗑️ Delete Category
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {!isCollapsed && (
        <div className="pw-category-portfolios">
          {portfolios.length === 0 ? (
            <div className="pw-category-empty-hint">
              <span>No portfolios yet</span>
              {manageMode && (
                <button
                  type="button"
                  className="pw-inline-link-btn"
                  onClick={() => onAddPortfolioToCategory?.(category.id)}
                >
                  + Add one
                </button>
              )}
            </div>
          ) : (
            portfolios.map((p) => {
              const metrics = getPortfolioMetrics(p);
              const isSelected = isPortfolioActive && activePortfolioId === p.id;

              return (
                <div
                  key={p.id}
                  className={`pw-portfolio-tree-row ${isSelected ? "pw-active" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectPortfolio?.(p.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectPortfolio?.(p.id);
                    }
                  }}
                >
                  <div className="pw-portfolio-tree-left">
                    <span className="pw-portfolio-bullet">•</span>
                    <span className="pw-portfolio-name" title={p.name}>{p.name}</span>
                  </div>

                  <div className="pw-portfolio-tree-right">
                    {metrics.type === "capital" ? (
                      <span className="pw-portfolio-value">{metrics.primaryText}</span>
                    ) : (
                      <div className="pw-portfolio-basket-metrics">
                        <span className="pw-portfolio-count">({metrics.primaryText})</span>
                        {metrics.changePct !== null && (
                          <span className={`pw-portfolio-pct ${metrics.changePct >= 0 ? "pw-up" : "pw-down"}`}>
                            {fmtPct(metrics.changePct)}
                          </span>
                        )}
                      </div>
                    )}

                    {onDeletePortfolio && (
                      <button
                        type="button"
                        className={`pw-portfolio-delete-btn ${manageMode ? "pw-visible" : ""}`}
                        aria-label={`Delete ${p.name}`}
                        title={`Delete ${p.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeletePortfolio?.(p);
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
