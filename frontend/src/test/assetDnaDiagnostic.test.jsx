import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import StrategySandboxDrawer from "../portfolioWatcher/ui/stock/StrategySandboxDrawer";

describe("Asset DNA Diagnostic UI Guardrails", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("is enabled and checked by default for all stocks", () => {
    const html = renderToString(<StrategySandboxDrawer symbol="QCOM" />);

    // Toggle checkbox label should exist and be checked
    expect(html).toContain("Asset DNA Diagnostic");
    expect(html).toContain('data-testid="asset-dna-checkbox" checked=""');

    // Asset DNA diagnostic card is rendered by default in Control Center
    expect(html).toContain('data-testid="asset-dna-card"');
  });

  it("is hidden when localStorage feature flag is explicitly set to false", () => {
    localStorage.setItem("pw_feature_asset_dna", "false");
    const html = renderToString(<StrategySandboxDrawer symbol="QCOM" />);

    // Toggle checkbox should not be checked
    expect(html).not.toContain('data-testid="asset-dna-checkbox" checked=""');

    // Asset DNA diagnostic card should NOT be in the rendered HTML
    expect(html).not.toContain('data-testid="asset-dna-card"');
  });

  it("toggle checkbox markup is correctly structured in drawer options bar", () => {
    const html = renderToString(<StrategySandboxDrawer symbol="QCOM" />);

    expect(html).toContain("Show flags on candles");
    expect(html).toContain("Asset DNA Diagnostic");
    expect(html).toContain("title=\"Enable Asset DNA Diagnostic to view intrinsic movement metrics and best-fit preset\"");
  });

  it("renders classic indicator checkboxes properly alongside options", () => {
    const html = renderToString(<StrategySandboxDrawer symbol="QCOM" />);

    expect(html).toContain("MACD Signal Crossover");
    expect(html).toContain("EMA-20 Momentum Guide");
    expect(html).toContain("RSI-14 Momentum / Rebound");
    expect(html).toContain("Stochastic Swing Rebound");
    expect(html).toContain("On-Balance Volume (OBV) Flow");
    expect(html).toContain("⚡ Run Backtest");
  });

  it("renders diagnostic card embedded inside top-most Control Center directly above indicator groups with dismiss button when enabled", () => {
    localStorage.setItem("pw_feature_asset_dna", "true");
    const html = renderToString(<StrategySandboxDrawer symbol="QCOM" />);

    // Control Center title and Asset DNA card should exist
    expect(html).toContain("Simulation &amp; Execution Control Center");
    expect(html).toContain("data-testid=\"asset-dna-card\"");
    expect(html).toContain("fowa-sandbox-dna-close-btn");
    expect(html).toContain("✕");

    // Unified 2-zone sequence verification:
    // 1. Control Center options bar appears first (at the top)
    // 2. Embedded DNA card appears inside Control Center below options
    // 3. Indicator groups container appears below the Control Center
    const optionsIdx = html.indexOf("fowa-sandbox-options-bar");
    const dnaIdx = html.indexOf("fowa-sandbox-dna-card");
    const groupsIdx = html.indexOf("fowa-sandbox-groups-container");

    expect(optionsIdx).toBeGreaterThan(-1);
    expect(dnaIdx).toBeGreaterThan(optionsIdx);
    expect(groupsIdx).toBeGreaterThan(dnaIdx);
  });

  it("renders model family filter pills when host injects extra strategy groups", () => {
    const mockGroups = [
      {
        id: "quant_alpha",
        title: "⚡ Quant Alpha Models",
        strategies: [{ id: "supertrend", label: "Supertrend" }]
      }
    ];
    const html = renderToString(<StrategySandboxDrawer symbol="QCOM" extraStrategyGroups={mockGroups} />);

    expect(html).toContain("Model Family:");
    expect(html).toContain("All Models (");
    expect(html).toContain("Classic Indicators (");
    expect(html).toContain("Quant Alpha (");
  });

  it("does not render Quant Alpha toggle or pills when running in portfolio-watcher without extra strategy groups", () => {
    const html = renderToString(<StrategySandboxDrawer symbol="QCOM" />);

    expect(html).not.toContain("Include Quant Alpha");
    expect(html).not.toContain("Model Family:");
    expect(html).not.toContain("Quant Alpha (");
  });
});
