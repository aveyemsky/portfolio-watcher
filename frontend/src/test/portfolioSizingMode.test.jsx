import React from "react";
import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";
import StockCard from "../portfolioWatcher/ui/stock/StockCard";
import LeftNavigator from "../portfolioWatcher/ui/layout/LeftNavigator";
import { calculatePortfolioSummary } from "../portfolioWatcher/ui/layout/TopSummary";
import { getCategoryKey } from "../portfolioWatcher/ui/viewModel";

describe("2-Mode Portfolio Management Frontend Guardrails", () => {
  const sampleStock = {
    symbol: "NVDA",
    name: "NVIDIA Corporation",
    sector: "Technology",
    lastPrice: 130.0,
  };

  const sampleData = {
    stocks: [sampleStock],
    categories: [
      { id: 1, name: "Brokerage Accounts" },
      { id: 2, name: "Sector Baskets" }
    ],
    accounts: [
      { id: 10, name: "Main Brokerage", categoryId: 1, sizing_mode: "PERCENT", cash: 5000 },
      { id: 20, name: "Tech Basket", categoryId: 2, sizing_mode: "PERCENT", cash: 0 },
      { id: 30, name: "Exact Shares Acc", categoryId: 1, sizing_mode: "SHARES", cash: 1000 }
    ],
    holdingsByAccount: {
      "10": [{ id: 1, symbol: "NVDA", weight_pct: null, effective_weight_pct: 100.0 }],
      "30": [{ id: 2, symbol: "NVDA", shares: 10, avgCost: 100.0, weight_pct: null, effective_weight_pct: 100.0 }]
    },
    pricesBySymbol: {
      NVDA: [
        { date: "2026-10-01", close: 120.0 },
        { date: "2026-10-02", close: 130.0 }
      ]
    }
  };

  it("getCategoryKey identifies brokerage accounts vs sectors/watchlists", () => {
    expect(getCategoryKey({ name: "Brokerage Accounts" }, { type: "Taxable" })).toBe("accounts");
    expect(getCategoryKey({ name: "Sector Baskets" }, { type: "Basket" })).toBe("sectors");
    expect(getCategoryKey({ name: "Action Watchlists" }, { type: "Watchlist" })).toBe("watchlists");
  });

  it("calculatePortfolioSummary in PERCENT mode hides dollar total and computes weighted % return", () => {
    const account = sampleData.accounts[0]; // Main Brokerage in PERCENT mode
    const holdings = sampleData.holdingsByAccount["10"];
    const summary = calculatePortfolioSummary(account, holdings, sampleData);

    expect(summary.isPercentMode).toBe(true);
    expect(summary.hideDollarTotal).toBe(true);
    // NVDA went from 120 to 130 (+8.33%)
    expect(summary.dailyPctChange).toBeCloseTo(8.33, 1);
  });

  it("calculatePortfolioSummary in SHARES mode computes real dollar total and return", () => {
    const account = sampleData.accounts[2]; // Exact Shares Acc
    const holdings = sampleData.holdingsByAccount["30"];
    const summary = calculatePortfolioSummary(account, holdings, sampleData);

    expect(summary.isPercentMode).toBe(false);
    expect(summary.hideDollarTotal).toBe(false);
    // cash 1000 + 10 shares * 130 = 2300
    expect(summary.totalValue).toBe(2300);
    // prev: cash 1000 + 10 * 120 = 2200; diff = 100/2200 = +4.55%
    expect(summary.dailyPctChange).toBeCloseTo(4.55, 1);
  });

  it("StockCard renders Weight: X% (Auto) badge in PERCENT mode without explicit weight", () => {
    const html = renderToString(
      <StockCard
        stock={sampleStock}
        holding={{ id: 1, symbol: "NVDA", weight_pct: null, effective_weight_pct: 50.0 }}
        account={sampleData.accounts[0]}
        category={sampleData.categories[0]}
        data={sampleData}
        mode="holdings"
      />
    );

    expect(html).toContain("Weight: 50.0% (Auto)");
  });

  it("StockCard renders explicit Weight: X% badge in PERCENT mode when set", () => {
    const html = renderToString(
      <StockCard
        stock={sampleStock}
        holding={{ id: 1, symbol: "NVDA", weight_pct: 35.0, effective_weight_pct: 35.0 }}
        account={sampleData.accounts[0]}
        category={sampleData.categories[0]}
        data={sampleData}
        mode="holdings"
      />
    );

    expect(html).toContain("Weight: 35.0%");
    expect(html).not.toContain("(Auto)");
  });

  it("StockCard renders shares, % of acc, and unrealized P&L in SHARES mode", () => {
    const html = renderToString(
      <StockCard
        stock={sampleStock}
        holding={{ id: 2, symbol: "NVDA", shares: 10, avgCost: 100.0, effective_weight_pct: 56.5 }}
        account={sampleData.accounts[2]}
        category={sampleData.categories[0]}
        data={sampleData}
        mode="holdings"
      />
    );

    expect(html).toContain("10 sh");
    expect(html).toContain("56.5% of acc");
    // Unrealized P&L: (130 - 100) * 10 = $300.00 (+30.00%)
    expect(html).toContain("+$300.00");
    expect(html).toContain("+30.00%");
  });

  it("StockCard renders inline card editor when isEditing is true on a Brokerage account", () => {
    const html = renderToString(
      <StockCard
        stock={sampleStock}
        holding={{ id: 1, symbol: "NVDA", weight_pct: null, effective_weight_pct: 50.0 }}
        account={sampleData.accounts[0]}
        category={sampleData.categories[0]}
        data={sampleData}
        mode="holdings"
        isEditing={true}
      />
    );

    expect(html).toContain("pw-card-inline-editor");
    expect(html).toContain('placeholder="Weight %"');
    expect(html).toContain('placeholder="Avg Cost"');
    expect(html).toContain("Save");
  });

  it("LeftNavigator reflects selected holding in edit mode and switches to Save", () => {
    const html = renderToString(
      <LeftNavigator
        data={sampleData}
        state={{
          leftTab: "accounts",
          accountDrilldown: true,
          activeAccountId: 10,
          selectedAccountId: 10,
          selectedType: "stock",
          selectedStockSymbol: "NVDA",
          navigatorMode: "manage",
          viewMode: "list"
        }}
        dispatch={() => {}}
      />
    );

    expect(html).toContain("Edit holding: NVDA");
    expect(html).toContain("+ Add new");
    expect(html).toContain("Save");
  });
});


