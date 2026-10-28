import AccountAllocation from "../account/AccountAllocation";
import AccountOverview from "../account/AccountOverview";
import AccountPerformance from "../account/AccountPerformance";
import AccountStockSelector from "../account/AccountStockSelector";
import StockChart from "../stock/StockChart";
import StockDocumentsView from "../stock/StockDocumentsView";
import StockIndicators from "../stock/StockIndicators";
import PerformanceLabTab from "../stock/PerformanceLabTab";
import SegmentedControl from "./SegmentedControl";
import {
  fmtMoney,
  fmtTodayChange,
  getExtendedHoursQuote,
  getSelectedAccount,
  getSelectedStock,
  latestPrice,
  stockChange,
  stockPriceChange
} from "../viewModel";

export const DEFAULT_ACCOUNT_TABS = [
  { value: "overview", label: "Overview", component: AccountOverview },
  { value: "allocation", label: "Allocation", component: AccountAllocation },
  { value: "performance", label: "Performance", component: AccountPerformance }
];

export const DEFAULT_STOCK_TABS = [
  { value: "chart", label: "Chart", component: StockChart },
  { value: "documents", label: "Intel", component: StockDocumentsView, dividerAfter: true },
  { value: "indicators", label: "Indicators", component: StockIndicators, dividerAfter: true },
  { value: "performance_lab", label: "Performance Lab", component: PerformanceLabTab, dividerBefore: true }
];

export function resolveTabs(defaultTabs, customTabs, extraTabs) {
  let tabs = defaultTabs;
  if (typeof customTabs === "function") {
    tabs = customTabs(defaultTabs);
  } else if (Array.isArray(customTabs) && customTabs.length > 0) {
    tabs = customTabs;
  } else if (Array.isArray(extraTabs) && extraTabs.length > 0) {
    tabs = [...defaultTabs, ...extraTabs];
  }
  return (tabs || []).map((tab) => ({
    value: tab.value || tab.id,
    label: tab.label || tab.name || tab.value || tab.id,
    component: tab.component,
    render: tab.render,
    ...(tab.dividerBefore ? { dividerBefore: true } : {}),
    ...(tab.dividerAfter ? { dividerAfter: true } : {})
  }));
}

export default function DetailPanel({
  apiBaseUrl,
  readOnly = false,
  data,
  state,
  dispatch,
  onAddStock,
  onPricesLoaded,
  stockTabs = null,
  accountTabs = null,
  extraStockTabs = [],
  extraAccountTabs = [],
  enableQuantAlpha = false
}) {
  const isStock = state.selectedType === "stock";
  const account = getSelectedAccount(data, state);
  const stock = getSelectedStock(data, state);
  const hasSelection = isStock ? Boolean(stock) : Boolean(account);
  const isAccountEditMode = !isStock && state.accountDrilldown && state.navigatorMode === "manage";
  const tabs = isStock
    ? resolveTabs(DEFAULT_STOCK_TABS, stockTabs, extraStockTabs)
    : resolveTabs(DEFAULT_ACCOUNT_TABS, accountTabs, extraAccountTabs);
  const activeTabDef = tabs.find((t) => t.value === state.rightTab && t.value !== "performance") || tabs[0];
  const activeTabValue = activeTabDef ? activeTabDef.value : (state.rightTab === "performance" ? tabs[0]?.value : state.rightTab);

  const tabProps = {
    apiBaseUrl,
    readOnly,
    data,
    state,
    dispatch,
    onAddStock,
    onPricesLoaded,
    stock,
    account,
    isStock,
    enableQuantAlpha
  };

  function renderTabContent(tabDef) {
    if (!tabDef) return null;
    if (typeof tabDef.render === "function") {
      return tabDef.render(tabProps);
    }
    if (tabDef.component) {
      const Component = tabDef.component;
      return <Component {...tabProps} />;
    }
    return null;
  }

  if (isAccountEditMode && account) {
    return (
      <AccountStockSelector
        data={data}
        state={state}
        account={account}
        onAddStock={onAddStock}
      />
    );
  }

  const isIndex = isStock && (stock?.assetType === "index" || stock?.symbol?.startsWith("^"));
  const cleanSector = stock?.sector && stock.sector !== "Unknown" ? stock.sector : (isIndex ? "Index" : "");
  const detailTitle = hasSelection
    ? (isStock
        ? (isIndex ? stock?.name : stock?.symbol)
        : account?.name)
    : "Getting started";
  const companyName = isStock
    ? (isIndex ? stock?.symbol : (stock?.name || stock?.symbol))
    : (account?.type ? `${account.type} · detailed portfolio view` : "");
  const detailSubtitle = hasSelection
    ? (isStock
        ? (isIndex
            ? `${stock?.symbol}${cleanSector ? ` · ${cleanSector}` : ""}`
            : `${stock?.name}${cleanSector ? ` · ${cleanSector}` : ""}`)
        : `${account?.type} · detailed portfolio view`)
    : "Create a portfolio or add a stock to begin.";

  const latest = isStock && stock ? latestPrice(data, stock.symbol) : null;
  const change = isStock && stock ? stockChange(data, stock.symbol) : 0;
  const priceDiff = isStock && stock ? stockPriceChange(data, stock.symbol) : 0;
  const displayPrice = latest?.close || stock?.lastPrice || 0;
  const displayVolume = stock?.dayVolume || stock?.volume || latest?.volume || 0;
  const extQuote = isStock && stock ? getExtendedHoursQuote(stock) : null;

  return (
    <>
      <div className="pw-detail-head">
        <div className="pw-detail-head-left">
          <div className="pw-detail-head-info">
            <h3 className="pw-detail-title">{detailTitle}</h3>
            {isStock ? (
              <div className="pw-detail-stock-meta">
                {companyName && <div className="pw-summary-subtitle">{companyName}</div>}
                {cleanSector && <div className="pw-detail-sector">{cleanSector}</div>}
              </div>
            ) : (
              <div className="pw-summary-subtitle">{detailSubtitle}</div>
            )}
          </div>

          {isStock && stock && displayPrice > 0 && (
            <div className="pw-detail-quote-strip">
              <div className="pw-quote-col-prices">
                <div className="pw-quote-item pw-quote-reg">
                  <span className="pw-quote-price">{fmtMoney(displayPrice)}</span>
                  <span className={`pw-quote-change ${change >= 0 ? "pw-up" : "pw-down"}`}>
                    {fmtTodayChange(priceDiff, change)}
                  </span>
                </div>
                {extQuote && (
                  <div className="pw-quote-item pw-quote-ext">
                    <span className="pw-quote-ext-badge">{extQuote.type === "post" ? "AH" : "Pre"}</span>
                    <span className="pw-quote-ext-price">{fmtMoney(extQuote.price)}</span>
                    <span className={`pw-quote-change ${extQuote.tone === "up" ? "pw-up" : "pw-down"}`}>
                      {fmtTodayChange(extQuote.diff, extQuote.pct)}
                    </span>
                  </div>
                )}
              </div>
              <div className="pw-quote-col-vol">
                <div className="pw-quote-item pw-quote-vol">
                  <span className="pw-quote-vol-label">Vol</span>
                  <span className="pw-quote-vol-val">
                    {displayVolume ? `${((displayVolume / 1_000_000)).toFixed(1)}M` : "-"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {hasSelection && (
          <SegmentedControl
            ariaLabel="Detail tabs"
            options={tabs}
            value={activeTabValue}
            onChange={(tab) => {
              if (tab === "performance") return;
              dispatch({ type: "setRightTab", tab });
            }}
          />
        )}
      </div>
      <div className="pw-detail-body">
        {!hasSelection && <div className="pw-empty-state">No portfolio data yet. Use All to add stocks, or Portfolios to create your first portfolio.</div>}
        {hasSelection && activeTabDef && renderTabContent(activeTabDef)}
      </div>
    </>
  );
}
