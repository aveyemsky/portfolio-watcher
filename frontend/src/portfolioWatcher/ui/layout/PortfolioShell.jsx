import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import DetailPanel from "./DetailPanel";
import LeftNavigator from "./LeftNavigator";
import TopSummary from "./TopSummary";
import Panel from "../shared/Panel";
import { getActiveAccount, getSelectedAccount, getSelectedStock, getUsMarketSession } from "../viewModel";
import { addHoldingToAccount } from "../../api/portfolioApi";
import { normalizeError } from "../../core/errors";
import { logger } from "../../core/logger";
import appLogo from "../../../assets/icon.svg";

const MIN_NAVIGATOR_HEIGHT = 600;

export default function PortfolioShell({
  apiBaseUrl,
  readOnly = false,
  allowManualSync = true,
  banner = null,
  hideHeader = false,
  appIcon = null,
  appName = "Portfolio Watcher",
  stockTabs = null,
  accountTabs = null,
  extraStockTabs = [],
  extraAccountTabs = [],
  enableQuantAlpha = false,
  customRightPanel = null,
  data,
  state,
  dispatch,
  onStockAdded,
  onStockDeleted,
  onBootstrapRefreshed,
  onAccountCreated,
  onAccountUpdated,
  onAccountDeleted,
  onCategoryCreated,
  onCategoryUpdated,
  onCategoryDeleted,
  onSectionAdded,
  onSectionDeleted,
  onItemsReordered,
  onHoldingAdded,
  onHoldingDeleted,
  onPricesLoaded
}) {
  const leftPanelRef = useRef(null);
  const detailPanelRef = useRef(null);
  const [leftPanelHeight, setLeftPanelHeight] = useState(MIN_NAVIGATOR_HEIGHT);
  const isGridView = state.viewMode === "grid";
  const hasDetailSelection = Boolean(customRightPanel) || (state.selectedType === "stock"
    ? Boolean(getSelectedStock(data, state))
    : Boolean(getSelectedAccount(data, state)));

  async function handleAddHoldingStock(symbol) {
    const activeAccount = getActiveAccount(data, state);
    if (!activeAccount || !symbol) return;
    try {
      const payload = await addHoldingToAccount(apiBaseUrl, activeAccount.id, {
        symbol: symbol.trim().toUpperCase(),
        shares: 0,
        avgCost: 0
      });
      onHoldingAdded(payload);
      return payload;
    } catch (error) {
      const normalized = normalizeError(error);
      logger.error("Add holding stock failed", normalized);
      throw normalized;
    }
  }

  useLayoutEffect(() => {
    if (isGridView || !hasDetailSelection || !detailPanelRef.current) {
      setLeftPanelHeight(MIN_NAVIGATOR_HEIGHT);
      return undefined;
    }

    function updatePanelHeight() {
      if (!detailPanelRef.current) return;
      const headEl = detailPanelRef.current.querySelector(".pw-detail-head");
      const bodyEl = detailPanelRef.current.querySelector(".pw-detail-body");
      const selectorEl = detailPanelRef.current.querySelector(".pw-stock-selector");
      const missionEl = detailPanelRef.current.querySelector(".fowa-mission-hub");
      const naturalHeight = (headEl && bodyEl)
        ? (headEl.offsetHeight + bodyEl.offsetHeight)
        : (missionEl?.offsetHeight || selectorEl?.offsetHeight || 0);
      const detailHeight = naturalHeight || detailPanelRef.current.scrollHeight || detailPanelRef.current.getBoundingClientRect().height;
      setLeftPanelHeight(Math.ceil(Math.max(MIN_NAVIGATOR_HEIGHT, detailHeight)));
    }

    updatePanelHeight();
    const resizeObserver = new ResizeObserver(updatePanelHeight);
    resizeObserver.observe(detailPanelRef.current);
    window.addEventListener("resize", updatePanelHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updatePanelHeight);
    };
  }, [
    hasDetailSelection,
    state.rightTab,
    state.selectedStockSymbol,
    state.selectedAccountId,
    state.chartMode,
    state.selectedIndicators,
    state.navigatorMode,
    state.leftTab,
    state.viewMode
  ]);

  useEffect(() => {
    // Prevent browser auto-scroll restoration on refresh so top index and header stay in view
    if (typeof window !== "undefined" && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  const scrollToDetail = useCallback(() => {
    requestAnimationFrame(() => {
      const target = detailPanelRef.current || leftPanelRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const targetTop = window.scrollY + rect.top - 12;
      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: "smooth"
      });
    });
  }, []);

  const handleDispatch = useCallback((action) => {
    dispatch(action);
    if (action?.type === "selectStock" || action?.type === "selectAccount") {
      scrollToDetail();
    }
  }, [dispatch, scrollToDetail]);

  const marketSession = getUsMarketSession();

  return (
    <>
      {!hideHeader && (
        <header className="pw-header">
          <div className="pw-brand">
            <img src={appIcon || appLogo} alt={appName || "Portfolio Watcher"} className="pw-brand-logo" />
            <h1 className="pw-page-title">{appName || "Portfolio Watcher"}</h1>
          </div>
          <div className="pw-indices-header pw-header-market-status">
            <span className="pw-indices-badge">Major US Indices</span>
            <span className={`pw-indices-live-indicator pw-session-${marketSession.status}`}>
              <span className="pw-live-dot" />
              {marketSession.label}
            </span>
          </div>
        </header>
      )}
      <section className={`pw-layout ${isGridView ? "pw-layout--grid" : ""}`}>
        <Panel className="pw-summary-panel">
          <TopSummary data={data} state={state} dispatch={handleDispatch} apiBaseUrl={apiBaseUrl} />
        </Panel>
        {banner && (
          <div className="pw-banner-panel">
            {banner}
          </div>
        )}
        <Panel
          ref={leftPanelRef}
          className={`pw-left-panel ${isGridView ? "pw-panel--grid" : ""}`}
          style={(!isGridView && leftPanelHeight) ? { height: `${leftPanelHeight}px` } : undefined}
        >
          <LeftNavigator
            apiBaseUrl={apiBaseUrl}
            readOnly={readOnly}
            allowManualSync={allowManualSync}
            data={data}
            state={state}
            dispatch={handleDispatch}
            onStockAdded={onStockAdded}
            onStockDeleted={onStockDeleted}
            onBootstrapRefreshed={onBootstrapRefreshed}
            onAccountCreated={onAccountCreated}
            onAccountUpdated={onAccountUpdated}
            onAccountDeleted={onAccountDeleted}
            onCategoryCreated={onCategoryCreated}
            onCategoryUpdated={onCategoryUpdated}
            onCategoryDeleted={onCategoryDeleted}
            onSectionAdded={onSectionAdded}
            onSectionDeleted={onSectionDeleted}
            onItemsReordered={onItemsReordered}
            onHoldingAdded={onHoldingAdded}
            onHoldingDeleted={onHoldingDeleted}
            onAddHoldingStock={handleAddHoldingStock}
          />
        </Panel>
        {!isGridView && hasDetailSelection && (
          <Panel ref={detailPanelRef} className="pw-detail-panel">
            {customRightPanel ? (
              typeof customRightPanel === "function"
                ? customRightPanel({
                    apiBaseUrl,
                    readOnly,
                    data,
                    state,
                    dispatch: handleDispatch,
                    onAddStock: handleAddHoldingStock,
                    onPricesLoaded,
                    stockTabs,
                    accountTabs,
                    extraStockTabs,
                    extraAccountTabs,
                    enableQuantAlpha
                  })
                : customRightPanel
            ) : (
              <DetailPanel
                apiBaseUrl={apiBaseUrl}
                readOnly={readOnly}
                data={data}
                state={state}
                dispatch={handleDispatch}
                onAddStock={handleAddHoldingStock}
                onPricesLoaded={onPricesLoaded}
                stockTabs={stockTabs}
                accountTabs={accountTabs}
                extraStockTabs={extraStockTabs}
                extraAccountTabs={extraAccountTabs}
                enableQuantAlpha={enableQuantAlpha}
              />
            )}
          </Panel>
        )}
      </section>
    </>
  );
}
