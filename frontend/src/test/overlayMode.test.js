import { describe, it, expect } from "vitest";
import { portfolioReducer, createInitialPortfolioState } from "../portfolioWatcher/state/portfolioStore.js";

const getInitState = () => createInitialPortfolioState({ accounts: [], stocks: [] });

describe("Overlay Mode: Indicators Multi by Default & Analysis Single/Multi Mode", () => {
  it("allows multiple indicators by default without mutual exclusivity", () => {
    let state = getInitState();
    expect(state.selectedIndicators.ma50).toBe(true);
    expect(state.selectedIndicators.ma200).toBe(true);

    // Toggle bb20 on -> ma50 and ma200 must remain true!
    state = portfolioReducer(state, { type: "toggleIndicator", indicator: "bb20" });
    expect(state.selectedIndicators.bb20).toBe(true);
    expect(state.selectedIndicators.ma50).toBe(true);
    expect(state.selectedIndicators.ma200).toBe(true);

    // Toggle ma50 off -> others remain
    state = portfolioReducer(state, { type: "toggleIndicator", indicator: "ma50" });
    expect(state.selectedIndicators.ma50).toBe(false);
    expect(state.selectedIndicators.ma200).toBe(true);
    expect(state.selectedIndicators.bb20).toBe(true);
  });

  it("defaults analysis to single mode with supertrend active", () => {
    const state = getInitState();
    expect(state.overlayMode).toBe("single");
    expect(state.selectedStrategies.supertrend).toBe(true);
    expect(state.selectedStrategies.squeeze_momentum).toBe(false);
  });

  it("in single mode, selecting another strategy switches to it while preserving indicators", () => {
    let state = getInitState();
    expect(state.selectedIndicators.ma50).toBe(true);
    expect(state.selectedStrategies.supertrend).toBe(true);

    // Activate Squeeze Momentum
    state = portfolioReducer(state, { type: "toggleStrategy", strategy: "squeeze_momentum" });
    expect(state.selectedStrategies.squeeze_momentum).toBe(true);
    expect(state.selectedStrategies.supertrend).toBe(false);
    // Indicators remain active and untouched!
    expect(state.selectedIndicators.ma50).toBe(true);
    expect(state.selectedIndicators.ma200).toBe(true);
  });

  it("in single mode, toggling the active strategy turns it off", () => {
    let state = getInitState();
    expect(state.selectedStrategies.supertrend).toBe(true);

    // Toggle off
    state = portfolioReducer(state, { type: "toggleStrategy", strategy: "supertrend" });
    expect(state.selectedStrategies.supertrend).toBe(false);
    const activeStrats = Object.values(state.selectedStrategies).filter(Boolean);
    expect(activeStrats.length).toBe(0);
  });

  it("in multi mode, multiple strategies can be active simultaneously", () => {
    let state = getInitState();
    state = portfolioReducer(state, { type: "setOverlayMode", mode: "multi" });
    expect(state.overlayMode).toBe("multi");

    state = portfolioReducer(state, { type: "toggleStrategy", strategy: "squeeze_momentum" });
    expect(state.selectedStrategies.supertrend).toBe(true);
    expect(state.selectedStrategies.squeeze_momentum).toBe(true);
  });

  it("switching from multi mode to single mode prunes strategies to at most 1 active", () => {
    let state = getInitState();
    state = portfolioReducer(state, { type: "setOverlayMode", mode: "multi" });
    state = portfolioReducer(state, { type: "toggleStrategy", strategy: "squeeze_momentum" });
    expect(state.selectedStrategies.supertrend).toBe(true);
    expect(state.selectedStrategies.squeeze_momentum).toBe(true);

    // Switch back to single mode
    state = portfolioReducer(state, { type: "setOverlayMode", mode: "single" });
    expect(state.overlayMode).toBe("single");
    const activeStrats = Object.values(state.selectedStrategies).filter(Boolean);
    expect(activeStrats.length).toBe(1);
  });

  it("setStrategyActive in single mode switches strategy, preserves indicators, and focuses chartCategory to strategies", () => {
    let state = getInitState();
    expect(state.chartCategory).toBe("indicators");

    state = portfolioReducer(state, {
      type: "setStrategyActive",
      strategy: "trend_regime",
      active: true
    });

    expect(state.selectedStrategies.trend_regime).toBe(true);
    expect(state.selectedStrategies.supertrend).toBe(false);
    expect(state.selectedIndicators.ma50).toBe(true);
    // Analysis tab is immediately in focus!
    expect(state.chartCategory).toBe("strategies");
  });

  it("setChartCategory updates active tab between indicators and strategies", () => {
    let state = getInitState();
    expect(state.chartCategory).toBe("indicators");

    state = portfolioReducer(state, { type: "setChartCategory", category: "strategies" });
    expect(state.chartCategory).toBe("strategies");

    state = portfolioReducer(state, { type: "setChartCategory", category: "indicators" });
    expect(state.chartCategory).toBe("indicators");
  });

  it("supports exhaustion_weakness strategy selection", () => {
    let state = getInitState();
    expect(state.selectedStrategies.exhaustion_weakness).toBe(false);

    state = portfolioReducer(state, { type: "toggleStrategy", strategy: "exhaustion_weakness" });
    expect(state.selectedStrategies.exhaustion_weakness).toBe(true);
    expect(state.selectedStrategies.supertrend).toBe(false);
  });

  it("supports mean_reversion strategy selection", () => {
    let state = getInitState();
    expect(state.selectedStrategies.mean_reversion).toBe(false);

    state = portfolioReducer(state, { type: "toggleStrategy", strategy: "mean_reversion" });
    expect(state.selectedStrategies.mean_reversion).toBe(true);
    expect(state.selectedStrategies.supertrend).toBe(false);
  });
});
