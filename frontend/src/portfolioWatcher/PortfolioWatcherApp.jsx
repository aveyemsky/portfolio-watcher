import { useCallback, useEffect, useReducer, useState } from "react";

import { fetchBootstrap, refreshStockQuotes, refreshIndexQuotes } from "./api/portfolioApi";
import { normalizeError } from "./core/errors";
import { logger } from "./core/logger";
import { createInitialPortfolioState, portfolioReducer } from "./state/portfolioStore";
import PortfolioShell from "./ui/layout/PortfolioShell";
import ErrorPanel from "./ui/shared/ErrorPanel";
import appLogo from "../assets/icon.svg";

export function isUsMarketOpen() {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

  if (["Sat", "Sun"].includes(weekday)) return false;
  const currentMinutes = hour * 60 + minute;
  const marketOpenMinutes = 9 * 60 + 30; // 9:30 AM ET
  const marketCloseMinutes = 16 * 60;    // 4:00 PM ET

  return currentMinutes >= marketOpenMinutes && currentMinutes <= marketCloseMinutes;
}

export { DEFAULT_STOCK_TABS, DEFAULT_ACCOUNT_TABS, resolveTabs } from "./ui/layout/DetailPanel";
export { isUsTradingSessionActive } from "./ui/viewModel";
export { registerWebMcpTools, getCoreWebMcpTools } from "./core/webMcp";
import { isUsTradingSessionActive } from "./ui/viewModel";
import { registerWebMcpTools } from "./core/webMcp";

export default function PortfolioWatcherApp({
  apiBaseUrl,
  readOnly = false,
  allowManualSync = true,
  banner = null,
  hideHeader = false,
  stockTabs = null,
  accountTabs = null,
  extraStockTabs = [],
  extraAccountTabs = [],
  initialStockSymbol = null,
  appIcon = null,
  appName = "PortfolioWatcher",
  loadingText = null,
  extraWebMcpTools = [],
  enableWebMcp = true,
  enableQuantAlpha = false,
  customRightPanel = null
}) {
  const [bootstrap, setBootstrap] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const resolvedLogo = appIcon || appLogo;
  const resolvedName = appName || "PortfolioWatcher";
  const resolvedLoadingText = loadingText || `Loading ${resolvedName}...`;

  function reducerWithInit(currentState, action) {
    if (action.type === "__initialize") return action.payload;
    return portfolioReducer(currentState, action);
  }

  const [viewState, viewDispatch] = useReducer(reducerWithInit, null);

  const handleQuotesRefreshed = useCallback((updatedStocks) => {
    if (!updatedStocks || !updatedStocks.length) return;
    setBootstrap((current) => {
      if (!current) return current;
      const updatedMap = new Map(updatedStocks.map((s) => [s.symbol, s]));
      const nextStocks = current.stocks.map((stock) => {
        const updated = updatedMap.get(stock.symbol);
        if (!updated) return stock;
        return { ...stock, ...updated };
      });
      return {
        ...current,
        stocks: nextStocks
      };
    });
  }, []);

  const handleIndicesRefreshed = useCallback((updatedIndices) => {
    if (!updatedIndices || !updatedIndices.length) return;
    setBootstrap((current) => {
      if (!current || !current.indices) return current;
      const updatedMap = new Map(updatedIndices.map((idx) => [idx.symbol, idx]));
      const nextIndices = current.indices.map((idx) => {
        const updated = updatedMap.get(idx.symbol);
        return updated ? { ...idx, ...updated } : idx;
      });
      return {
        ...current,
        indices: nextIndices
      };
    });
  }, []);

  const handlePricesLoaded = useCallback((symbol, prices) => {
    if (!symbol || !prices) return;
    setBootstrap((current) => {
      if (!current) return current;
      return {
        ...current,
        pricesBySymbol: {
          ...current.pricesBySymbol,
          [symbol]: prices
        }
      };
    });
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadPortfolio() {
      try {
        logger.info("Loading PortfolioWatcher bootstrap data");
        const payload = await fetchBootstrap(apiBaseUrl);
        if (!isMounted) return;
        const sortedStocks = (payload?.stocks || []).slice().sort((a, b) => a.symbol.localeCompare(b.symbol));
        const normalizedPayload = {
          ...payload,
          stocks: sortedStocks
        };
        setBootstrap(normalizedPayload);
        viewDispatch({ type: "__initialize", payload: createInitialPortfolioState(normalizedPayload, initialStockSymbol) });
      } catch (error) {
        const normalized = normalizeError(error);
        logger.error("Bootstrap load failed", normalized);
        if (isMounted) setLoadError(normalized);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadPortfolio();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, initialStockSymbol]);

  useEffect(() => {
    if (initialStockSymbol && viewDispatch && bootstrap?.stocks?.some((s) => s.symbol === initialStockSymbol)) {
      viewDispatch({ type: "selectStock", symbol: initialStockSymbol });
    }
  }, [initialStockSymbol, bootstrap?.stocks]);

  useEffect(() => {
    if (enableWebMcp) {
      registerWebMcpTools({ extraTools: extraWebMcpTools, apiBaseUrl });
    }
  }, [enableWebMcp, extraWebMcpTools, apiBaseUrl]);

  useEffect(() => {
    let isMounted = true;
    const hasStocks = Boolean(bootstrap?.stocks?.length);
    const hasIndices = Boolean(bootstrap?.indices?.length);
    if (!hasStocks && !hasIndices) return undefined;

    async function updateQuotes() {
      try {
        const [stocksResult, indicesResult] = await Promise.allSettled([
          hasStocks ? refreshStockQuotes(apiBaseUrl) : Promise.resolve([]),
          hasIndices ? refreshIndexQuotes(apiBaseUrl) : Promise.resolve([])
        ]);
        if (!isMounted) return;

        if (stocksResult.status === "fulfilled" && stocksResult.value?.length) {
          handleQuotesRefreshed(stocksResult.value);
        } else if (stocksResult.status === "rejected") {
          logger.warn("Automatic stock quote refresh failed", stocksResult.reason);
        }

        if (indicesResult.status === "fulfilled" && indicesResult.value?.length) {
          handleIndicesRefreshed(indicesResult.value);
        } else if (indicesResult.status === "rejected") {
          logger.warn("Automatic index quote refresh failed", indicesResult.reason);
        }
      } catch (error) {
        logger.warn("Automatic quote refresh failed", error);
      }
    }

    // Refresh quotes once on mount / browser refresh to obtain latest snapshot (including after-hours)
    updateQuotes();

    const intervalId = setInterval(() => {
      if (isUsTradingSessionActive()) {
        updateQuotes();
      }
    }, 60000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [
    apiBaseUrl,
    Boolean(bootstrap?.stocks?.length),
    Boolean(bootstrap?.indices?.length),
    handleQuotesRefreshed,
    handleIndicesRefreshed
  ]);


  if (isLoading) {
    return (
      <main className="pw-app">
        <div className="pw-loading">
          <img src={resolvedLogo} alt={resolvedName} className="pw-loading-logo" />
          <span>{resolvedLoadingText}</span>
        </div>
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="pw-app">
        <ErrorPanel
          title="Portfolio data could not be loaded."
          message="Please check that the backend is running and try again."
        />
      </main>
    );
  }

  if (!bootstrap || !viewState) return null;

  function handleStockAdded(payload) {
    setBootstrap((current) => {
      const stocks = current.stocks.filter((stock) => stock.symbol !== payload.stock.symbol);
      return {
        ...current,
        stocks: [...stocks, payload.stock].sort((a, b) => a.symbol.localeCompare(b.symbol)),
        pricesBySymbol: {
          ...current.pricesBySymbol,
          [payload.stock.symbol]: payload.prices
        }
      };
    });
    viewDispatch({ type: "stockAdded", symbol: payload.stock.symbol, navigatorMode: viewState.navigatorMode });
  }

  function handleStockDeleted(symbol) {
    const stocks = bootstrap.stocks.filter((stock) => stock.symbol !== symbol);
    const nextSymbol = stocks[0]?.symbol || null;
    setBootstrap((current) => {
      const { [symbol]: _deleted, ...pricesBySymbol } = current.pricesBySymbol;
      return {
        ...current,
        stocks,
        pricesBySymbol
      };
    });
    viewDispatch({ type: "stockDeleted", symbol, nextSymbol });
  }

  function handleBootstrapRefreshed(payload) {
    const sortedStocks = (payload?.stocks || []).slice().sort((a, b) => a.symbol.localeCompare(b.symbol));
    setBootstrap({
      ...payload,
      stocks: sortedStocks,
      pricesBySymbol: {},
      lastRefreshedAt: Date.now()
    });
  }

  function handleAccountCreated(account) {
    setBootstrap((current) => {
      const nextAccounts = [...current.accounts, account];
      const nextCategories = (current.categories || []).map((cat) => {
        if (cat.id === account.categoryId) {
          return {
            ...cat,
            portfolios: [...(cat.portfolios || []), account]
          };
        }
        return cat;
      });
      return {
        ...current,
        accounts: nextAccounts,
        categories: nextCategories,
        holdingsByAccount: {
          ...current.holdingsByAccount,
          [account.id]: []
        }
      };
    });
    viewDispatch({ type: "selectAccount", accountId: account.id });
  }

  function handleAccountUpdated(account) {
    setBootstrap((current) => {
      const nextAccounts = current.accounts.map((item) => (item.id === account.id ? account : item));
      const nextCategories = (current.categories || []).map((cat) => ({
        ...cat,
        portfolios: (cat.portfolios || []).map((p) => (p.id === account.id ? account : p))
      }));
      return {
        ...current,
        accounts: nextAccounts,
        categories: nextCategories
      };
    });
    viewDispatch({ type: "selectAccount", accountId: account.id });
  }

  function handleAccountDeleted(accountId) {
    const accounts = bootstrap.accounts.filter((account) => account.id !== accountId);
    const nextAccountId = accounts[0]?.id || null;
    setBootstrap((current) => {
      const { [accountId]: _deleted, ...holdingsByAccount } = current.holdingsByAccount;
      const nextCategories = (current.categories || []).map((cat) => ({
        ...cat,
        portfolios: (cat.portfolios || []).filter((p) => p.id !== accountId)
      }));
      return {
        ...current,
        accounts,
        categories: nextCategories,
        holdingsByAccount
      };
    });
    viewDispatch({ type: "accountDeleted", accountId, nextAccountId });
  }

  function handleCategoryCreated(category) {
    setBootstrap((current) => ({
      ...current,
      categories: [...(current.categories || []), { ...category, portfolios: category.portfolios || [] }]
    }));
  }

  function handleCategoryUpdated(category) {
    setBootstrap((current) => ({
      ...current,
      categories: (current.categories || []).map((c) => (c.id === category.id ? { ...c, ...category } : c))
    }));
  }

  function handleCategoryDeleted(categoryId, deletePortfolios) {
    setBootstrap((current) => {
      const nextCategories = (current.categories || []).filter((c) => c.id !== categoryId);
      if (deletePortfolios) {
        const deletedAccountIds = new Set(
          current.accounts.filter((a) => a.categoryId === categoryId).map((a) => a.id)
        );
        const nextAccounts = current.accounts.filter((a) => !deletedAccountIds.has(a.id));
        const nextHoldings = { ...current.holdingsByAccount };
        deletedAccountIds.forEach((id) => delete nextHoldings[id]);
        return {
          ...current,
          categories: nextCategories,
          accounts: nextAccounts,
          holdingsByAccount: nextHoldings
        };
      } else {
        const nextAccounts = current.accounts.map((a) => (a.categoryId === categoryId ? { ...a, categoryId: null } : a));
        return {
          ...current,
          categories: nextCategories,
          accounts: nextAccounts
        };
      }
    });
  }

  function handleSectionAdded(portfolioId, sectionItem) {
    setBootstrap((current) => {
      const key = String(portfolioId);
      const holdings = current.holdingsByAccount[key] || [];
      return {
        ...current,
        holdingsByAccount: {
          ...current.holdingsByAccount,
          [key]: [...holdings, sectionItem].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        }
      };
    });
  }

  function handleSectionDeleted(portfolioId, sectionId) {
    setBootstrap((current) => {
      const key = String(portfolioId);
      const holdings = current.holdingsByAccount[key] || [];
      return {
        ...current,
        holdingsByAccount: {
          ...current.holdingsByAccount,
          [key]: holdings.filter((item) => item.id !== sectionId)
        }
      };
    });
  }

  function handleItemsReordered(portfolioId, reorderedItems) {
    setBootstrap((current) => {
      const key = String(portfolioId);
      return {
        ...current,
        holdingsByAccount: {
          ...current.holdingsByAccount,
          [key]: reorderedItems
        }
      };
    });
  }

  function handleHoldingAdded(payload) {
    const holding = payload.holding || payload;
    setBootstrap((current) => {
      const key = String(holding.accountId);
      const holdings = current.holdingsByAccount[key] || [];
      const nextStocks = payload.stock
        ? [
            ...current.stocks.filter((stock) => stock.symbol !== payload.stock.symbol),
            payload.stock
          ].sort((a, b) => a.symbol.localeCompare(b.symbol))
        : current.stocks;
      const nextPrices = payload.stock
        ? {
            ...current.pricesBySymbol,
            [payload.stock.symbol]: payload.prices || []
          }
        : current.pricesBySymbol;

      return {
        ...current,
        stocks: nextStocks,
        pricesBySymbol: nextPrices,
        holdingsByAccount: {
          ...current.holdingsByAccount,
          [key]: [...holdings, holding].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        }
      };
    });
    if (viewState.navigatorMode !== "manage") {
      viewDispatch({ type: "selectStock", symbol: holding.symbol });
    }
  }

  function handleHoldingDeleted(accountId, symbol) {
    setBootstrap((current) => {
      const key = String(accountId);
      return {
        ...current,
        holdingsByAccount: {
          ...current.holdingsByAccount,
          [key]: (current.holdingsByAccount[key] || []).filter((holding) => holding.symbol !== symbol)
        }
      };
    });
  }

  return (
    <main className="pw-app">
      <PortfolioShell
        apiBaseUrl={apiBaseUrl}
        readOnly={readOnly}
        allowManualSync={allowManualSync}
        banner={banner}
        hideHeader={hideHeader}
        appIcon={resolvedLogo}
        appName={resolvedName}
        stockTabs={stockTabs}
        accountTabs={accountTabs}
        extraStockTabs={extraStockTabs}
        extraAccountTabs={extraAccountTabs}
        enableQuantAlpha={enableQuantAlpha}
        customRightPanel={customRightPanel}
        data={bootstrap}
        state={viewState}
        dispatch={viewDispatch}
        onStockAdded={handleStockAdded}
        onStockDeleted={handleStockDeleted}
        onBootstrapRefreshed={handleBootstrapRefreshed}
        onAccountCreated={handleAccountCreated}
        onAccountUpdated={handleAccountUpdated}
        onAccountDeleted={handleAccountDeleted}
        onCategoryCreated={handleCategoryCreated}
        onCategoryUpdated={handleCategoryUpdated}
        onCategoryDeleted={handleCategoryDeleted}
        onSectionAdded={handleSectionAdded}
        onSectionDeleted={handleSectionDeleted}
        onItemsReordered={handleItemsReordered}
        onHoldingAdded={handleHoldingAdded}
        onHoldingDeleted={handleHoldingDeleted}
        onPricesLoaded={handlePricesLoaded}
      />
    </main>
  );
}
