export const LEFT_TABS = {
  all: "all",
  accounts: "accounts"
};

export const SELECTED_TYPES = {
  account: "account",
  stock: "stock"
};

export const ACCOUNT_ONLY_TABS = ["overview", "allocation", "performance"];

export function isStockTab(tab) {
  return Boolean(tab && !ACCOUNT_ONLY_TABS.includes(tab));
}

export function createInitialPortfolioState(data, initialStockSymbol = null) {
  const firstAccountId = data.accounts[0]?.id ?? null;
  const targetStock = initialStockSymbol && (data.stocks || []).some((s) => s.symbol === initialStockSymbol)
    ? initialStockSymbol
    : (data.stocks[0]?.symbol ?? null);
  return {
    activeAccountId: firstAccountId,
    selectedType: SELECTED_TYPES.stock,
    selectedAccountId: null,
    selectedStockSymbol: targetStock,
    leftTab: LEFT_TABS.all,
    accountDrilldown: false,
    collapsedCategoryIds: {},
    navigatorMode: "view",
    chartMode: "3y",
    selectedIndicators: {
      ema20: false,
      ma50: true,
      ma200: true,
      bb20: false,
      atr14: false,
      rsi14: true,
      stoch14: false,
      macd: false,
      obv: false
    },
    selectedStrategies: {
      supertrend: true,
      squeeze_momentum: false,
      trend_regime: false,
      exhaustion_weakness: false,
      mean_reversion: false
    },
    overlayMode: "single",
    chartCategory: "indicators",
    rightTab: targetStock ? "chart" : "overview",
    search: "",
    viewMode: "list",
    gridGroupBy: typeof window !== "undefined" && window.localStorage?.getItem("pw_grid_group_by") === "sector" ? "sector" : "none",
    collapsedSectors: {}
  };
}

export function portfolioReducer(state, action) {
  switch (action.type) {
    case "toggleCategoryCollapse": {
      const current = Boolean(state.collapsedCategoryIds?.[action.categoryId]);
      return {
        ...state,
        collapsedCategoryIds: {
          ...state.collapsedCategoryIds,
          [action.categoryId]: !current
        }
      };
    }
    case "selectAllStocks": {
      const targetSymbol = action.symbol || state.selectedStockSymbol || null;
      return {
        ...state,
        leftTab: LEFT_TABS.all,
        accountDrilldown: false,
        selectedType: SELECTED_TYPES.stock,
        selectedStockSymbol: targetSymbol,
        selectedAccountId: null,
        rightTab: targetSymbol
          ? (isStockTab(state.rightTab) ? state.rightTab : "chart")
          : "overview"
      };
    }
    case "selectAccount":
    case "selectPortfolio":
      return {
        ...state,
        activeAccountId: action.accountId,
        selectedAccountId: action.accountId,
        selectedType: SELECTED_TYPES.account,
        selectedStockSymbol: null,
        leftTab: LEFT_TABS.accounts,
        accountDrilldown: true,
        navigatorMode: state.navigatorMode,
        rightTab: "overview"
      };
    case "selectStock":
      return {
        ...state,
        selectedType: SELECTED_TYPES.stock,
        selectedStockSymbol: action.symbol,
        chartMode: state.chartMode || "3y",
        rightTab: action.rightTab || (isStockTab(state.rightTab) ? state.rightTab : "chart")
      };
    case "setLeftTab": {
      const targetSymbol = action.tab === LEFT_TABS.all ? (action.firstStockSymbol || null) : null;
      return {
        ...state,
        leftTab: action.tab,
        accountDrilldown: false,
        navigatorMode: "view",
        selectedType: action.tab === LEFT_TABS.all ? SELECTED_TYPES.stock : SELECTED_TYPES.account,
        selectedStockSymbol: targetSymbol,
        selectedAccountId: action.tab === LEFT_TABS.accounts ? null : state.selectedAccountId,
        rightTab: action.tab === LEFT_TABS.all && action.firstStockSymbol
          ? (isStockTab(state.rightTab) ? state.rightTab : "chart")
          : "overview",
        chartMode: action.tab === LEFT_TABS.all && action.firstStockSymbol ? (state.chartMode || "3y") : state.chartMode,
        search: action.tab === LEFT_TABS.all ? state.search : ""
      };
    }
    case "toggleNavigatorMode": {
      const nextMode = state.navigatorMode === "manage" ? "view" : "manage";
      return {
        ...state,
        navigatorMode: nextMode,
        viewMode: (nextMode === "manage" && state.accountDrilldown) ? "list" : state.viewMode,
        selectedType: (nextMode === "manage" && state.accountDrilldown) ? SELECTED_TYPES.account : state.selectedType,
        selectedStockSymbol: (nextMode === "manage" && state.accountDrilldown) ? null : state.selectedStockSymbol,
        selectedAccountId: (nextMode === "manage" && state.accountDrilldown) ? state.activeAccountId : state.selectedAccountId
      };
    }
    case "toggleViewMode":
      return {
        ...state,
        viewMode: state.viewMode === "grid" ? "list" : "grid"
      };
    case "setViewMode":
      return {
        ...state,
        viewMode: action.mode
      };
    case "toggleGridGroupBy": {
      const nextMode = state.gridGroupBy === "sector" ? "none" : "sector";
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem("pw_grid_group_by", nextMode);
        }
      } catch (_) {}
      return {
        ...state,
        gridGroupBy: nextMode
      };
    }
    case "setGridGroupBy": {
      const nextMode = action.groupBy === "sector" ? "sector" : "none";
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.setItem("pw_grid_group_by", nextMode);
        }
      } catch (_) {}
      return {
        ...state,
        gridGroupBy: nextMode
      };
    }
    case "toggleSectorCollapse": {
      const current = Boolean(state.collapsedSectors?.[action.sector]);
      return {
        ...state,
        collapsedSectors: {
          ...state.collapsedSectors,
          [action.sector]: !current
        }
      };
    }
    case "setAllSectorsCollapse": {
      const nextCollapsed = {};
      if (action.collapsed && Array.isArray(action.sectors)) {
        action.sectors.forEach((sec) => {
          nextCollapsed[sec] = true;
        });
      }
      return {
        ...state,
        collapsedSectors: nextCollapsed
      };
    }
    case "setNavigatorMode":
      return {
        ...state,
        navigatorMode: action.mode
      };
    case "setRightTab":
      return {
        ...state,
        rightTab: action.tab
      };
    case "setChartMode":
      return {
        ...state,
        chartMode: action.mode
      };
    case "setOverlayMode": {
      const nextMode = action.mode === "single" ? "single" : "multi";
      if (nextMode === "single") {
        const activeStratKeys = Object.entries(state.selectedStrategies || {})
          .filter(([_, v]) => Boolean(v))
          .map(([k]) => k);

        const nextStrategies = {};
        Object.keys(state.selectedStrategies || {}).forEach((k) => {
          nextStrategies[k] = false;
        });

        if (activeStratKeys.length > 0) {
          nextStrategies[activeStratKeys[0]] = true;
        }

        return {
          ...state,
          overlayMode: nextMode,
          selectedStrategies: nextStrategies
        };
      }
      return {
        ...state,
        overlayMode: nextMode
      };
    }
    case "toggleIndicator": {
      return {
        ...state,
        selectedIndicators: {
          ...state.selectedIndicators,
          [action.indicator]: !state.selectedIndicators?.[action.indicator]
        }
      };
    }
    case "toggleStrategy": {
      if (state.overlayMode === "single") {
        const isAlreadyOn = Boolean(state.selectedStrategies?.[action.strategy]);
        const nextStrategies = {};
        Object.keys(state.selectedStrategies || {}).forEach((k) => {
          nextStrategies[k] = false;
        });

        if (!isAlreadyOn) {
          nextStrategies[action.strategy] = true;
        }
        return {
          ...state,
          selectedStrategies: nextStrategies
        };
      }
      return {
        ...state,
        selectedStrategies: {
          ...state.selectedStrategies,
          [action.strategy]: !state.selectedStrategies?.[action.strategy]
        }
      };
    }
    case "setChartCategory": {
      return {
        ...state,
        chartCategory: action.category === "strategies" ? "strategies" : "indicators"
      };
    }
    case "setStrategyActive": {
      if (state.overlayMode === "single" && action.active) {
        const nextStrategies = {};
        Object.keys(state.selectedStrategies || {}).forEach((k) => {
          nextStrategies[k] = false;
        });
        nextStrategies[action.strategy] = true;

        return {
          ...state,
          chartCategory: "strategies",
          selectedStrategies: nextStrategies
        };
      }
      return {
        ...state,
        chartCategory: "strategies",
        selectedStrategies: {
          ...state.selectedStrategies,
          [action.strategy]: Boolean(action.active)
        }
      };
    }
    case "setSearch":
      return {
        ...state,
        search: action.search
      };
    case "stockAdded":
      return {
        ...state,
        activeAccountId: state.activeAccountId,
        selectedType: SELECTED_TYPES.stock,
        selectedStockSymbol: action.symbol,
        leftTab: LEFT_TABS.all,
        accountDrilldown: false,
        navigatorMode: action.navigatorMode || "view",
        chartMode: "3y",
        rightTab: "chart",
        search: ""
      };
    case "stockDeleted": {
      const nextSymbol = action.nextSymbol || null;
      return {
        ...state,
        selectedType: SELECTED_TYPES.stock,
        selectedStockSymbol: nextSymbol,
        selectedAccountId: nextSymbol ? state.selectedAccountId : null,
        rightTab: nextSymbol ? (isStockTab(state.rightTab) ? state.rightTab : "chart") : "overview"
      };
    }
    case "accountDeleted": {
      const nextAccountId = action.nextAccountId || null;
      // If user was not in drilldown (was in category tree view), keep them in category tree view
      const keepDrilldown = state.accountDrilldown && Boolean(nextAccountId);
      return {
        ...state,
        activeAccountId: nextAccountId,
        selectedAccountId: keepDrilldown ? nextAccountId : null,
        selectedType: SELECTED_TYPES.account,
        selectedStockSymbol: null,
        leftTab: LEFT_TABS.accounts,
        accountDrilldown: keepDrilldown,
        navigatorMode: state.navigatorMode,
        rightTab: "overview"
      };
    }
    default:
      return state;
  }
}
