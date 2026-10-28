import React, { useEffect, useRef, useState, useCallback } from "react";
import "./StrategySandboxDrawer.css";

export const CLASSIC_INDICATORS = [
  { id: "ma50", label: "SMA-50 Trend Filter", desc: "Bullish when price holds above 50-day moving average" },
  { id: "ma200", label: "SMA-200 Macro Baseline", desc: "Bullish when price holds above 200-day moving average" },
  { id: "ema20", label: "EMA-20 Momentum Guide", desc: "Short-term exponential moving average trend alignment" },
  { id: "rsi14", label: "RSI-14 Momentum / Rebound", desc: "Bullish when RSI > 50 or rebounding from oversold (<30)" },
  { id: "stoch14", label: "Stochastic Swing Rebound (14, 3, 3)", desc: "Buy when %K <= 20 or crossing %D; exit at overbought (>= 80)" },
  { id: "macd", label: "MACD Signal Crossover", desc: "Bullish when MACD histogram is positive" },
  { id: "bb20", label: "Bollinger Bands Mean Reversion", desc: "Buy at lower band, take profit at upper band" },
  { id: "obv", label: "On-Balance Volume (OBV) Flow", desc: "Bullish when cumulative volume trends above 20-day OBV moving average" },
];

const COMBINER_MODES = [
  { id: "CONSENSUS", label: "All Must Agree (Consensus)" },
  { id: "ANY_TRIGGER", label: "Any Trigger (Aggressive)" },
  { id: "WEIGHTED_VOTE", label: "Weighted Voting" },
  { id: "PRIORITY_LADDER", label: "Priority Ladder (Hierarchical Rule Order)" },
  { id: "CASCADE", label: "Cascading Regime (Gate + Timing)" }
];

export const LOOKBACK_OPTIONS = [
  { value: "0", label: "All (since 2017)" },
  { value: "2555", label: "7 Years" },
  { value: "1825", label: "5 Years" },
  { value: "1095", label: "3 Years" },
  { value: "730", label: "2 Years" },
  { value: "365", label: "1 Year" },
  { value: "180", label: "6 Months" },
  { value: "custom", label: "Custom Date Range..." }
];

export const FIXED_HISTORY_START_DATE = "2017-01-01";

export function getFixedHistoryStartDate() {
  return FIXED_HISTORY_START_DATE;
}

// Backward-compatible helper/alias
export function getFixed7YearStartDate(refDate = new Date()) {
  return FIXED_HISTORY_START_DATE;
}

function rangesMatch(left, right) {
  if (!left || !right) return left === right;
  return Math.abs(left.from - right.from) < 0.001 && Math.abs(left.to - right.to) < 0.001;
}

export default function StrategySandboxDrawer({
  symbol,
  apiBaseUrl = "/api/portfolio",
  extraStrategyGroups = [],
  initialSelectedStrategies = null,
  initialTimeSpanMode = "730",
  initialCustomStartDate = null,
  initialCustomEndDate = null,
  initialShowAssetDna = true,
  onTradeMarkersChange,
  onSelectedStrategiesChange,
  visibleLogicalRange = null,
  onVisibleLogicalRangeChange = null,
  mainPrices = [],
  title = "Performance Lab",
  subtitle = "Portfolio Performance & Strategy Simulator"
}) {
  const [isOpen, setIsOpen] = useState(true);
  const [isTradesExpanded, setIsTradesExpanded] = useState(false);
  const [selectedStrategies, setSelectedStrategies] = useState(() => (
    initialSelectedStrategies || {
      ma50: true
    }
  ));

  useEffect(() => {
    onSelectedStrategiesChange?.(selectedStrategies);
  }, [selectedStrategies, onSelectedStrategiesChange]);
  const [combineMode, setCombineMode] = useState("CONSENSUS");
  const [timeSpanMode, setTimeSpanMode] = useState(initialTimeSpanMode);
  const [customStartDate, setCustomStartDate] = useState(() => {
    if (initialCustomStartDate) return initialCustomStartDate;
    const d = new Date();
    d.setFullYear(d.getFullYear() - 2);
    return d.toISOString().slice(0, 10);
  });
  const [customEndDate, setCustomEndDate] = useState(() => {
    if (initialCustomEndDate) return initialCustomEndDate;
    return new Date().toISOString().slice(0, 10);
  });

  const dateBoundaries = React.useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const fixedHistoryStart = getFixedHistoryStartDate();

    let earliestDate = fixedHistoryStart;
    let latestDate = todayIso;

    if (mainPrices && mainPrices.length > 0) {
      const getIso = (p) => {
        if (!p) return null;
        const raw = p.date || p.time;
        if (!raw) return null;
        return typeof raw === "string" ? raw.slice(0, 10) : raw.toISOString?.().slice(0, 10);
      };

      const firstBarDate = getIso(mainPrices[0]);
      const lastBarDate = getIso(mainPrices[mainPrices.length - 1]);

      if (firstBarDate) {
        earliestDate = firstBarDate;
      }
      if (lastBarDate && lastBarDate <= todayIso) {
        latestDate = lastBarDate;
      }
    }

    return { earliestDate, latestDate };
  }, [mainPrices]);

  // Keep custom dates clamped within allowable boundary range
  useEffect(() => {
    if (customStartDate && dateBoundaries.earliestDate && customStartDate < dateBoundaries.earliestDate) {
      setCustomStartDate(dateBoundaries.earliestDate);
    }
    if (customEndDate && dateBoundaries.latestDate && customEndDate > dateBoundaries.latestDate) {
      setCustomEndDate(dateBoundaries.latestDate);
    }
  }, [dateBoundaries.earliestDate, dateBoundaries.latestDate]);

  const handleTimeSpanChange = useCallback((newMode) => {
    if (newMode === "custom" && timeSpanMode !== "custom") {
      const { earliestDate, latestDate } = dateBoundaries;
      const today = new Date();
      let calculatedStart = earliestDate;
      const lookbackDays = Number(timeSpanMode || 0);
      if (lookbackDays > 0) {
        const d = new Date(today);
        d.setDate(d.getDate() - lookbackDays);
        const iso = d.toISOString().slice(0, 10);
        calculatedStart = iso < earliestDate ? earliestDate : (iso > latestDate ? latestDate : iso);
      } else {
        calculatedStart = earliestDate;
      }
      setCustomStartDate(calculatedStart);
      setCustomEndDate(latestDate);
    }
    setTimeSpanMode(newMode);
  }, [timeSpanMode, dateBoundaries]);

  const handleStartDateChange = useCallback((e) => {
    let val = e.target.value;
    const { earliestDate, latestDate } = dateBoundaries;
    const maxAllowed = customEndDate || latestDate;
    if (val && val < earliestDate) {
      val = earliestDate;
    }
    if (val && val > maxAllowed) {
      val = maxAllowed;
    }
    setCustomStartDate(val);
  }, [dateBoundaries, customEndDate]);

  const handleEndDateChange = useCallback((e) => {
    let val = e.target.value;
    const { earliestDate, latestDate } = dateBoundaries;
    const minAllowed = customStartDate || earliestDate;
    if (val && val > latestDate) {
      val = latestDate;
    }
    if (val && val < minAllowed) {
      val = minAllowed;
    }
    setCustomEndDate(val);
  }, [dateBoundaries, customStartDate]);
  const [plotMarkersOnChart, setPlotMarkersOnChart] = useState(true);
  const [macroGateMode, setMacroGateMode] = useState("off"); // "off" | "defensive" | "conservative"
  const [simulationData, setSimulationData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isChartFocused, setIsChartFocused] = useState(false);

  // Asset DNA Diagnostic state (default enabled for all stocks)
  const [showAssetDna, setShowAssetDna] = useState(() => {
    try {
      const stored = localStorage.getItem("pw_feature_asset_dna");
      if (stored !== null) {
        return stored === "true";
      }
    } catch {}
    return initialShowAssetDna !== undefined ? Boolean(initialShowAssetDna) : true;
  });
  const [assetDnaProfile, setAssetDnaProfile] = useState(null);
  const [isDnaLoading, setIsDnaLoading] = useState(false);
  const [includeQuantAlphaInDna, setIncludeQuantAlphaInDna] = useState(() => {
    try {
      return localStorage.getItem("pw_feature_asset_dna_quant_alpha") === "true";
    } catch {
      return false;
    }
  });
  const [strategyFamilyFilter, setStrategyFamilyFilter] = useState("all"); // "all" | "classic" | "quant"
  const hasQuantAlpha = Boolean(extraStrategyGroups && extraStrategyGroups.length > 0);
  const effectiveIncludeQuant = Boolean(hasQuantAlpha && includeQuantAlphaInDna);

  useEffect(() => {
    if (!showAssetDna || !symbol) {
      setAssetDnaProfile(null);
      return;
    }
    let isCancelled = false;
    setIsDnaLoading(true);

    const lookbackDaysParam = timeSpanMode === "custom" ? 0 : (timeSpanMode || 730);
    fetch(
      `${apiBaseUrl}/stocks/${encodeURIComponent(symbol)}/dna-profile?include_quant_alpha=${effectiveIncludeQuant}&lookback_days=${lookbackDaysParam}`,
      {
        credentials: "include"
      }
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isCancelled && data && data.status === "ok") {
          setAssetDnaProfile(data);
          // Automatically apply the stock's recommended preset when switching stocks with Asset DNA enabled
          if (data.recommended_preset?.strategies?.length) {
            const newSelected = {};
            data.recommended_preset.strategies.forEach((stratId) => {
              newSelected[stratId] = true;
            });
            setSelectedStrategies(newSelected);
            if (data.recommended_preset.combine_mode) {
              setCombineMode(data.recommended_preset.combine_mode);
            }
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!isCancelled) setIsDnaLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [showAssetDna, symbol, apiBaseUrl, effectiveIncludeQuant, timeSpanMode]);


  const handleApplyRecommendedPreset = () => {
    if (!assetDnaProfile?.recommended_preset) return;
    const preset = assetDnaProfile.recommended_preset;
    const newSelected = {};
    (preset.strategies || []).forEach((stratId) => {
      newSelected[stratId] = true;
    });
    setSelectedStrategies(newSelected);
    if (preset.combine_mode) {
      setCombineMode(preset.combine_mode);
    }
  };

  const isPresetActive = React.useMemo(() => {
    if (!assetDnaProfile?.recommended_preset?.strategies?.length) return false;
    const recStrats = assetDnaProfile.recommended_preset.strategies;
    const activeKeys = Object.keys(selectedStrategies).filter((k) => selectedStrategies[k]);
    if (activeKeys.length !== recStrats.length) return false;
    return recStrats.every((s) => selectedStrategies[s]);
  }, [assetDnaProfile, selectedStrategies]);



  const chartCardRef = useRef(null);
  const chartContainerRef = useRef(null);
  const chartInstanceRef = useRef(null);
  const isChartFocusedRef = useRef(false);
  isChartFocusedRef.current = isChartFocused;
  const isApplyingRangeRef = useRef(false);

  const dateOffset = React.useMemo(() => {
    if (!mainPrices?.length || !simulationData?.dates?.length) return 0;
    const firstSimDate = simulationData.dates[0];
    const idx = mainPrices.findIndex((p) => {
      const d = p.date ? (typeof p.date === "string" ? p.date : p.date.toISOString?.().slice(0, 10)) : p.time;
      return d === firstSimDate;
    });
    return idx >= 0 ? idx : 0;
  }, [mainPrices, simulationData?.dates]);

  useEffect(() => {
    if (!chartInstanceRef.current || !visibleLogicalRange) return;

    const targetRange = {
      from: visibleLogicalRange.from - dateOffset,
      to: visibleLogicalRange.to - dateOffset
    };

    const currentRange = chartInstanceRef.current.timeScale().getVisibleLogicalRange();
    if (currentRange && rangesMatch(currentRange, targetRange)) {
      return;
    }

    isApplyingRangeRef.current = true;
    chartInstanceRef.current.timeScale().setVisibleLogicalRange(targetRange);
    window.requestAnimationFrame(() => {
      isApplyingRangeRef.current = false;
    });
  }, [visibleLogicalRange, dateOffset]);

  useEffect(() => {
    if (!chartInstanceRef.current || !simulationData?.dates?.length || !onVisibleLogicalRangeChange) return;
    const currentRange = chartInstanceRef.current.timeScale().getVisibleLogicalRange();
    if (currentRange && !isChartFocusedRef.current) {
      isApplyingRangeRef.current = true;
      onVisibleLogicalRangeChange({
        from: currentRange.from + dateOffset,
        to: currentRange.to + dateOffset
      });
      window.requestAnimationFrame(() => {
        isApplyingRangeRef.current = false;
      });
    }
  }, [dateOffset]);

  useEffect(() => {
    function handleGlobalPointerDown(event) {
      if (chartCardRef.current && !chartCardRef.current.contains(event.target)) {
        setIsChartFocused(false);
      }
    }

    window.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => window.removeEventListener("pointerdown", handleGlobalPointerDown);
  }, []);

  useEffect(() => {
    setIsChartFocused(false);
  }, [symbol, isOpen]);

  useEffect(() => {
    if (chartInstanceRef.current) {
      chartInstanceRef.current.applyOptions({
        handleScroll: {
          mouseWheel: Boolean(isChartFocused),
          pressedMouseMove: Boolean(isChartFocused),
          horzTouchDrag: Boolean(isChartFocused),
          vertTouchDrag: false
        },
        handleScale: {
          axisPressedMouseMove: Boolean(isChartFocused),
          mouseWheel: Boolean(isChartFocused),
          pinch: Boolean(isChartFocused)
        }
      });
    }
  }, [isChartFocused]);

  const handleChartFocus = () => {
    if (!isChartFocused) {
      setIsChartFocused(true);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.applyOptions({
          handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: false
          },
          handleScale: {
            axisPressedMouseMove: true,
            mouseWheel: true,
            pinch: true
          }
        });
      }
    }
  };

  const activeStrategyIds = Object.keys(selectedStrategies).filter((k) => selectedStrategies[k]);

  const toggleStrategy = (id) => {
    setSelectedStrategies((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      const checkedCount = Object.values(next).filter(Boolean).length;
      if (checkedCount === 0) return prev;
      return next;
    });
  };

  const runSimulation = useCallback(async () => {
    if (!symbol || activeStrategyIds.length === 0) return;

    setIsLoading(true);
    setErrorMsg("");

    try {
      const isCustom = timeSpanMode === "custom";
      const payload = {
        ticker: symbol,
        symbol: symbol,
        lookback_days: isCustom ? 0 : Number(timeSpanMode || 0),
        start_date: isCustom && customStartDate ? customStartDate : null,
        end_date: isCustom && customEndDate ? customEndDate : null,
        combine_mode: combineMode,
        strategies: activeStrategyIds.map((id) => ({ id, params: {} })),
        macro_sentiment_gate:
          macroGateMode === "off"
            ? { enabled: false }
            : {
                enabled: true,
                vix_max: macroGateMode === "conservative" ? 24.0 : 28.0,
                skew_max: macroGateMode === "conservative" ? 135.0 : 145.0
              }
      };

      // 1. Try stock simulation route
      let res = await fetch(`${apiBaseUrl}/stocks/${encodeURIComponent(symbol)}/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload)
      });

      // 2. Fallback to analysis ensemble route
      if (!res.ok) {
        res = await fetch(`${apiBaseUrl}/analysis/simulate-ensemble`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload)
        });
      }

      // 3. Fallback to top-level /api/analysis/simulate-ensemble
      if (!res.ok) {
        res = await fetch(`/api/analysis/simulate-ensemble`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payload)
        });
      }

      if (!res.ok) {
        throw new Error(`Simulation failed: ${res.status}`);
      }

      const data = await res.json();
      setSimulationData(data);
      if (plotMarkersOnChart) {
        onTradeMarkersChange?.(data.trade_markers || []);
      }
    } catch (err) {
      setErrorMsg(err.message || "Failed to execute backtest simulation.");
    } finally {
      setIsLoading(false);
    }
  }, [symbol, activeStrategyIds, timeSpanMode, customStartDate, customEndDate, combineMode, macroGateMode, apiBaseUrl, plotMarkersOnChart, onTradeMarkersChange]);

  useEffect(() => {
    if (!plotMarkersOnChart) {
      onTradeMarkersChange?.([]);
    } else if (simulationData?.trade_markers) {
      onTradeMarkersChange?.(simulationData.trade_markers);
    }
  }, [plotMarkersOnChart, simulationData, onTradeMarkersChange]);

  useEffect(() => {
    runSimulation();
  }, [symbol, combineMode, timeSpanMode, customStartDate, customEndDate, macroGateMode, JSON.stringify(activeStrategyIds)]);

  useEffect(() => {
    if (!simulationData?.dates?.length || !chartContainerRef.current) return;

    let chart;
    let resizeObserver;

    async function mountEquityChart() {
      try {
        const { createChart, LineSeries } = await import("lightweight-charts");
        if (!chartContainerRef.current) return;

        if (chartInstanceRef.current) {
          chartInstanceRef.current.remove();
          chartInstanceRef.current = null;
        }

        chart = createChart(chartContainerRef.current, {
          width: chartContainerRef.current.clientWidth,
          height: 200,
          handleScroll: {
            mouseWheel: Boolean(isChartFocusedRef.current),
            pressedMouseMove: Boolean(isChartFocusedRef.current),
            horzTouchDrag: Boolean(isChartFocusedRef.current),
            vertTouchDrag: false
          },
          handleScale: {
            axisPressedMouseMove: Boolean(isChartFocusedRef.current),
            mouseWheel: Boolean(isChartFocusedRef.current),
            pinch: Boolean(isChartFocusedRef.current)
          },
          layout: {
            background: { color: "#ffffff" },
            textColor: "#475569",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
          },
          grid: {
            vertLines: { color: "rgba(18, 28, 48, 0.05)" },
            horzLines: { color: "rgba(18, 28, 48, 0.05)" }
          },
          rightPriceScale: {
            borderColor: "rgba(18, 28, 48, 0.12)"
          },
          timeScale: {
            borderColor: "rgba(18, 28, 48, 0.12)"
          }
        });
        chartInstanceRef.current = chart;

        // Buy & Hold line (Gray)
        const benchSeries = chart.addSeries(LineSeries, {
          color: "#94a3b8",
          lineWidth: 2,
          lineStyle: 1,
          priceLineVisible: false,
          title: "Buy & Hold"
        });
        const benchPoints = simulationData.dates.map((date, idx) => ({
          time: date,
          value: simulationData.benchmark_equity[idx]
        }));
        benchSeries.setData(benchPoints);

        // Ensemble Strategy line (Cyan)
        const stratSeries = chart.addSeries(LineSeries, {
          color: "#00d4ff",
          lineWidth: 2,
          priceLineVisible: false,
          title: "Ensemble Strategy"
        });
        const stratPoints = simulationData.dates.map((date, idx) => ({
          time: date,
          value: simulationData.strategy_equity[idx]
        }));
        stratSeries.setData(stratPoints);

        chart.timeScale().fitContent();

        const fittedRange = chart.timeScale().getVisibleLogicalRange();
        if (fittedRange && onVisibleLogicalRangeChange) {
          isApplyingRangeRef.current = true;
          onVisibleLogicalRangeChange({
            from: fittedRange.from + dateOffset,
            to: fittedRange.to + dateOffset
          });
          window.requestAnimationFrame(() => {
            isApplyingRangeRef.current = false;
          });
        }

        let handleVisibleRangeChange = (range) => {
          if (!range || isApplyingRangeRef.current) return;
          if (isChartFocusedRef.current) {
            onVisibleLogicalRangeChange?.({
              from: range.from + dateOffset,
              to: range.to + dateOffset
            });
          }
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

        resizeObserver = new ResizeObserver(() => {
          if (chartContainerRef.current && chart) {
            chart.applyOptions({
              width: chartContainerRef.current.clientWidth
            });
          }
        });
        resizeObserver.observe(chartContainerRef.current);
      } catch (e) {
        console.error("Failed to render sandbox equity chart", e);
      }
    }

    mountEquityChart();

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      if (chart) {
        chart.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [simulationData, dateOffset]);

  const metrics = simulationData?.metrics;
  const posture = simulationData?.current_posture;
  const trades = simulationData?.trades || [];

  const classicActiveCount = CLASSIC_INDICATORS.filter((s) => selectedStrategies[s.id]).length;
  const quantActiveCount = (extraStrategyGroups || []).reduce((acc, g) => {
    return acc + (g.strategies || []).filter((s) => selectedStrategies[s.id]).length;
  }, 0);
  const totalActiveCount = classicActiveCount + quantActiveCount;

  return (
    <div className="fowa-sandbox-drawer">
      <div className="fowa-sandbox-header" onClick={() => setIsOpen(!isOpen)}>
        <div className="fowa-sandbox-title-wrap">
          <div className="fowa-sandbox-title">
            <span>🧪</span> {title}
          </div>
          <span className="fowa-sandbox-pill">{subtitle}</span>
        </div>

        <div className="fowa-sandbox-controls-summary">
          {simulationData?.macro_gate && (
            <span
              className={`fowa-sandbox-posture-badge ${simulationData.macro_gate.gate_active_today ? "exit" : "cash"}`}
              style={{ fontSize: "11px", display: "inline-flex", alignItems: "center", gap: "4px" }}
              title={`VIX: ${simulationData.macro_gate.latest_vix ?? "N/A"}, SKEW: ${simulationData.macro_gate.latest_skew ?? "N/A"}. Gated Bars: ${simulationData.macro_gate.gated_bars}`}
            >
              🛡️ Macro: {simulationData.macro_gate.latest_vix ? `VIX ${simulationData.macro_gate.latest_vix}` : "VIX"}
              {simulationData.macro_gate.latest_skew ? ` | SKEW ${simulationData.macro_gate.latest_skew}` : ""}
              {simulationData.macro_gate.gate_active_today ? " [RISK-OFF]" : ""}
            </span>
          )}
          {posture && (
            <span
              className={`fowa-sandbox-posture-badge ${
                posture.signal === 1 ? "long" : posture.signal === -1 ? "exit" : "cash"
              }`}
            >
              Current: {posture.posture}
            </span>
          )}
          <button
            type="button"
            className="fowa-sandbox-toggle-btn"
            aria-label={isOpen ? `Collapse ${title}` : `Expand ${title}`}
          >
            {isOpen ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {isOpen && (
        <div className="fowa-sandbox-body">
          <div className="fowa-sandbox-config-row">


            {/* 1. Simulation & Execution Control Center (Top-Most) */}
            <div className="fowa-sandbox-group-section fowa-sandbox-controls-section">
              <div className="fowa-sandbox-group-title">
                <span>⚙️ Simulation &amp; Execution Control Center</span>
              </div>
              <div className="fowa-sandbox-options-bar">
                <div className="fowa-sandbox-options-group">
                  <div className="fowa-sandbox-select-field">
                    <label>Logic Mode</label>
                    <select
                      value={combineMode}
                      onChange={(e) => setCombineMode(e.target.value)}
                    >
                      {COMBINER_MODES.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="fowa-sandbox-select-field">
                    <label>Time Span</label>
                    <select
                      value={timeSpanMode}
                      onChange={(e) => handleTimeSpanChange(e.target.value)}
                    >
                      {LOOKBACK_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="fowa-sandbox-select-field">
                    <label title="Macro Risk Regime Gate using VIX and SKEW to protect capital during systemic crashes">
                      Macro Gate
                    </label>
                    <select
                      value={macroGateMode}
                      onChange={(e) => setMacroGateMode(e.target.value)}
                      data-testid="macro-gate-select"
                    >
                      <option value="off">Off (Pure Strategy)</option>
                      <option value="defensive">Defensive (VIX &gt; 28 / SKEW &gt; 145)</option>
                      <option value="conservative">Strict Guard (VIX &gt; 24 / SKEW &gt; 135)</option>
                    </select>
                  </div>

                  {timeSpanMode === "custom" && (
                    <>
                      <div className="fowa-sandbox-select-field">
                        <label>Start Date</label>
                        <input
                          type="date"
                          className="fowa-sandbox-date-input"
                          value={customStartDate}
                          min={dateBoundaries.earliestDate}
                          max={customEndDate || dateBoundaries.latestDate}
                          onChange={handleStartDateChange}
                          data-testid="custom-start-date"
                        />
                      </div>
                      <div className="fowa-sandbox-select-field">
                        <label>End Date</label>
                        <input
                          type="date"
                          className="fowa-sandbox-date-input"
                          value={customEndDate}
                          min={customStartDate || dateBoundaries.earliestDate}
                          max={dateBoundaries.latestDate}
                          onChange={handleEndDateChange}
                          data-testid="custom-end-date"
                        />
                      </div>
                    </>
                  )}

                  <label
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontSize: "12px",
                      color: "var(--pw-text-secondary, #64748b)",
                      cursor: "pointer",
                      userSelect: "none",
                      alignSelf: "flex-end",
                      paddingBottom: "8px"
                    }}
                    title="Plot execution flags (▲ BUY / ▼ EXIT) from this sandbox strategy on the candlestick chart above"
                  >
                    <input
                      type="checkbox"
                      checked={plotMarkersOnChart}
                      onChange={(e) => setPlotMarkersOnChart(e.target.checked)}
                    />
                    <span>Show flags on candles</span>
                  </label>

                  <button
                    type="button"
                    className="fowa-sandbox-run-btn"
                    onClick={runSimulation}
                    disabled={isLoading}
                  >
                    {isLoading ? "Running..." : "⚡ Run Backtest"}
                  </button>
                </div>

                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    color: "var(--pw-text-secondary, #64748b)",
                    cursor: "pointer",
                    userSelect: "none",
                    alignSelf: "flex-end",
                    paddingBottom: "8px"
                  }}
                  title="Enable Asset DNA Diagnostic to view intrinsic movement metrics and best-fit preset"
                >
                  <input
                    type="checkbox"
                    data-testid="asset-dna-checkbox"
                    checked={showAssetDna}
                    onChange={(e) => {
                      const next = e.target.checked;
                      setShowAssetDna(next);
                      try {
                        localStorage.setItem("pw_feature_asset_dna", String(next));
                      } catch {}
                    }}
                  />
                  <span>Asset DNA Diagnostic</span>
                </label>
              </div>

              {/* Embedded Asset DNA Strategy Advisor (Part of Control Center) */}
              {showAssetDna && (
                <div className="fowa-sandbox-dna-card" data-testid="asset-dna-card">
                  {isDnaLoading ? (
                    <div className="fowa-sandbox-dna-loading">
                      <span>🧬 Calculating Asset DNA Diagnostic for {symbol}...</span>
                    </div>
                  ) : assetDnaProfile && assetDnaProfile.status === "ok" ? (
                    <>
                      <div className="fowa-sandbox-dna-header">
                        <div className="fowa-sandbox-dna-title">
                          <span>🧬 Asset DNA Strategy Advisor:</span>
                          <span className={`fowa-sandbox-dna-badge ${assetDnaProfile.badge_color || "purple"}`}>
                            {assetDnaProfile.profile_label}
                          </span>
                          <span style={{ fontSize: "11px", color: "var(--pw-text-secondary, #64748b)" }}>
                            ({assetDnaProfile.total_bars} bars analyzed)
                          </span>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                          <div className="fowa-sandbox-dna-metrics">
                            <div className="fowa-sandbox-dna-metric-item">
                              <span>Trend Efficiency:</span>
                              <strong>{assetDnaProfile.trend_efficiency}</strong>
                              <span style={{ color: "#64748b" }}>({assetDnaProfile.efficiency_label})</span>
                            </div>
                            <div className="fowa-sandbox-dna-metric-item">
                              <span>Cycle Drawdown:</span>
                              <strong style={{ color: assetDnaProfile.max_cycle_drawdown_pct <= -35 ? "#dc2626" : "#0f172a" }}>
                                {assetDnaProfile.max_cycle_drawdown_pct}%
                              </strong>
                              <span style={{ color: "#64748b" }}>({assetDnaProfile.drawdown_label})</span>
                            </div>
                            {assetDnaProfile.daily_volatility_pct != null && (
                              <div className="fowa-sandbox-dna-metric-item">
                                <span>Daily Volatility (ATR):</span>
                                <strong style={{ color: assetDnaProfile.daily_volatility_pct >= 4.0 ? "#b45309" : "#0f172a" }}>
                                  ±{assetDnaProfile.daily_volatility_pct}%
                                </strong>
                                <span style={{ color: "#64748b" }}>({assetDnaProfile.volatility_label})</span>
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            className="fowa-sandbox-dna-close-btn"
                            onClick={() => {
                              setShowAssetDna(false);
                              try {
                                localStorage.setItem("pw_feature_asset_dna", "false");
                              } catch {}
                            }}
                            title="Hide Asset DNA Diagnostic"
                            aria-label="Hide Asset DNA Diagnostic"
                          >
                            ✕
                          </button>
                        </div>
                      </div>

                      {assetDnaProfile.recommended_preset && (
                        <div className="fowa-sandbox-dna-preset-row">
                          <div className="fowa-sandbox-dna-reason">
                            <strong>Recommended Preset:</strong> {assetDnaProfile.recommended_preset.label} —{" "}
                            <span>{assetDnaProfile.recommended_preset.reason}</span>
                          </div>
                          <div className="fowa-sandbox-dna-actions">
                            {hasQuantAlpha && (
                              <label
                                className="fowa-sandbox-dna-quant-toggle"
                                title="Include Quant Alpha models in candidate backtests alongside classic indicators"
                              >
                                <input
                                  type="checkbox"
                                  checked={includeQuantAlphaInDna}
                                  onChange={(e) => {
                                    const next = e.target.checked;
                                    setIncludeQuantAlphaInDna(next);
                                    try {
                                      localStorage.setItem("pw_feature_asset_dna_quant_alpha", String(next));
                                    } catch {}
                                  }}
                                />
                                <span>Include Quant Alpha</span>
                              </label>
                            )}
                            <button
                              type="button"
                              className={`fowa-sandbox-dna-apply-btn ${isPresetActive ? "active" : ""}`}
                              onClick={handleApplyRecommendedPreset}
                              title={isPresetActive ? "Preset is currently applied" : `Auto-select ${assetDnaProfile.recommended_preset.label}`}
                            >
                              {isPresetActive ? "✓ Preset Active" : "✨ Apply Preset"}
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="fowa-sandbox-dna-loading">
                      <span>🧬 Asset DNA: {assetDnaProfile?.message || "Insufficient historical data"}</span>
                      <button
                        type="button"
                        className="fowa-sandbox-dna-close-btn"
                        onClick={() => {
                          setShowAssetDna(false);
                          try {
                            localStorage.setItem("pw_feature_asset_dna", "false");
                          } catch {}
                        }}
                        title="Hide Asset DNA Diagnostic"
                        aria-label="Hide Asset DNA Diagnostic"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 2. Strategy Groups Container (Indicators) */}
            <div className="fowa-sandbox-groups-container">
              {/* Strategy Model Family Filter Pills (Only shown when host injects external Quant Alpha models) */}
              {hasQuantAlpha && (
                <div className="fowa-sandbox-family-filter-bar">
                  <span className="fowa-sandbox-family-filter-label">Model Family:</span>
                  <div className="fowa-sandbox-family-pills" role="tablist" aria-label="Strategy model family">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={strategyFamilyFilter === "all"}
                      className={`fowa-sandbox-family-pill ${strategyFamilyFilter === "all" ? "active" : ""}`}
                      onClick={() => setStrategyFamilyFilter("all")}
                    >
                      All Models ({totalActiveCount})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={strategyFamilyFilter === "classic"}
                      className={`fowa-sandbox-family-pill ${strategyFamilyFilter === "classic" ? "active" : ""}`}
                      onClick={() => setStrategyFamilyFilter("classic")}
                    >
                      Classic Indicators ({classicActiveCount})
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={strategyFamilyFilter === "quant"}
                      className={`fowa-sandbox-family-pill ${strategyFamilyFilter === "quant" ? "active" : ""}`}
                      onClick={() => setStrategyFamilyFilter("quant")}
                    >
                      Quant Alpha ({quantActiveCount})
                    </button>
                  </div>
                </div>
              )}

              {/* Group 1: Classic Technical Indicators */}
              {(!hasQuantAlpha || strategyFamilyFilter === "all" || strategyFamilyFilter === "classic") && (
                <div className="fowa-sandbox-group-section">
                  <div className="fowa-sandbox-group-title">
                    <span>📊 Classic Technical Indicators</span>
                    <span className="fowa-sandbox-group-count">{classicActiveCount} active</span>
                  </div>
                  <div className="fowa-sandbox-strategy-checkboxes">
                    {CLASSIC_INDICATORS.map((s) => {
                      const checked = Boolean(selectedStrategies[s.id]);
                      return (
                        <label
                          key={s.id}
                          className={`fowa-sandbox-checkbox-item ${checked ? "checked classic" : ""}`}
                          title={s.desc}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleStrategy(s.id)}
                          />
                          <span>{s.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Host-Injected Extra Strategy Groups (e.g. Quant Alpha Models in Host Applications) */}
              {hasQuantAlpha && (strategyFamilyFilter === "all" || strategyFamilyFilter === "quant") && (
                extraStrategyGroups.map((group) => {
                  const groupActiveCount = (group.strategies || []).filter((s) => selectedStrategies[s.id]).length;
                  return (
                    <div key={group.id} className="fowa-sandbox-group-section">
                      <div className="fowa-sandbox-group-title">
                        <span>{group.title}</span>
                        <span className="fowa-sandbox-group-count">{groupActiveCount} active</span>
                      </div>
                      <div className="fowa-sandbox-strategy-checkboxes">
                        {(group.strategies || []).map((s) => {
                          const checked = Boolean(selectedStrategies[s.id]);
                          return (
                            <label
                              key={s.id}
                              className={`fowa-sandbox-checkbox-item ${checked ? "checked" : ""}`}
                              title={s.desc}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleStrategy(s.id)}
                              />
                              <span>{s.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {errorMsg && <div className="pw-inline-error">{errorMsg}</div>}

          {/* Metric Badges */}
          {metrics && (
            <div className="fowa-sandbox-metrics-strip">
              <div className="fowa-sandbox-metric-card">
                <span className="fowa-sandbox-metric-title">Net Return vs Hold</span>
                <div className="fowa-sandbox-metric-value-row">
                  <span
                    className={`fowa-sandbox-metric-val ${
                      metrics.strategy_return_pct >= 0 ? "positive" : "negative"
                    }`}
                  >
                    {metrics.strategy_return_pct >= 0 ? "+" : ""}
                    {metrics.strategy_return_pct.toFixed(1)}%
                  </span>
                  <span className="fowa-sandbox-metric-sub">
                    Hold: {metrics.benchmark_return_pct >= 0 ? "+" : ""}
                    {metrics.benchmark_return_pct.toFixed(1)}%
                  </span>
                </div>
                <div className="fowa-sandbox-metric-value-row">
                  <span
                    className={`fowa-sandbox-alpha-pill ${
                      metrics.alpha_pct >= 0 ? "" : "negative"
                    }`}
                  >
                    {metrics.alpha_pct >= 0 ? "+" : ""}
                    {metrics.alpha_pct.toFixed(1)}% Alpha
                  </span>
                </div>
              </div>

              <div className="fowa-sandbox-metric-card">
                <span className="fowa-sandbox-metric-title">Drawdown Shield</span>
                <div className="fowa-sandbox-metric-value-row">
                  <span className="fowa-sandbox-metric-val">
                    {metrics.strategy_max_drawdown_pct.toFixed(1)}%
                  </span>
                  <span className="fowa-sandbox-metric-sub">
                    vs {metrics.benchmark_max_drawdown_pct.toFixed(1)}% Hold Dip
                  </span>
                </div>
                <span className="fowa-sandbox-metric-sub">
                  Shield: {(metrics.strategy_max_drawdown_pct - metrics.benchmark_max_drawdown_pct).toFixed(1)}% preserved
                </span>
              </div>

              <div className="fowa-sandbox-metric-card">
                <span className="fowa-sandbox-metric-title">Trade Frequency & Win Rate</span>
                <div className="fowa-sandbox-metric-value-row">
                  <span className="fowa-sandbox-metric-val">{metrics.total_trades} trades</span>
                  <span className="fowa-sandbox-metric-sub">({metrics.win_rate_pct.toFixed(0)}% Win Rate)</span>
                </div>
                <span className="fowa-sandbox-metric-sub">
                  Execution markers plotted on candles above
                </span>
              </div>
            </div>
          )}

          {/* Interactive Benchmark Chart */}
          <div
            ref={chartCardRef}
            className={`fowa-sandbox-chart-container ${isChartFocused ? "pw-chart-focused" : ""}`}
            onPointerDown={handleChartFocus}
            tabIndex={-1}
          >
            <div className="fowa-sandbox-chart-legend">
              <div className="fowa-sandbox-legend-items">
                <div className="fowa-sandbox-legend-item">
                  <span className="fowa-legend-color-dot ensemble" />
                  <span>Ensemble Strategy ({combineMode})</span>
                </div>
                <div className="fowa-sandbox-legend-item">
                  <span className="fowa-legend-color-dot benchmark" />
                  <span>Buy & Hold Benchmark</span>
                </div>
              </div>
              <div className="fowa-sandbox-chart-legend-meta">
                {!isChartFocused && (
                  <span className="fowa-sandbox-chart-hint">Click chart to zoom / drag</span>
                )}
                <span>$10,000 Starting Capital</span>
              </div>
            </div>

            <div
              className="fowa-sandbox-chart-canvas-wrapper"
              ref={chartContainerRef}
            />
          </div>

          {/* Trade Execution Logs */}
          {trades.length > 0 && (
            <div className={`fowa-sandbox-trades-section ${!isTradesExpanded ? "collapsed" : ""}`}>
              <div
                className="fowa-sandbox-trades-header"
                onClick={() => setIsTradesExpanded((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setIsTradesExpanded((prev) => !prev);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={isTradesExpanded}
                title={isTradesExpanded ? "Click to collapse trigger logs" : "Click to expand trigger logs"}
              >
                <div className="fowa-sandbox-trades-header-left">
                  <span className="fowa-collapse-chevron">{isTradesExpanded ? "▼" : "▶"}</span>
                  <span className="fowa-trades-title">Recent Ensemble Trigger Logs ({trades.length} actions)</span>
                </div>
                <div className="fowa-sandbox-trades-header-right">
                  <span className="fowa-trades-subtitle">▲ Buy / ▼ Exit flags plotted directly on price candles</span>
                  <span className="fowa-toggle-action-pill">{isTradesExpanded ? "Hide Logs" : "Show Logs"}</span>
                </div>
              </div>
              {isTradesExpanded && (
                <div style={{ maxHeight: "140px", overflowY: "auto" }}>
                <table className="fowa-sandbox-trades-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Action</th>
                      <th>Price</th>
                      <th>PnL / Return</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map((t, idx) => (
                      <tr key={idx}>
                        <td>{t.date}</td>
                        <td>
                          <span
                            className={`fowa-trade-action-pill ${
                              t.action === "BUY" || t.action === "SCALE_IN"
                                ? "buy"
                                : t.action === "TRIM_HARVEST"
                                ? "trim"
                                : "exit"
                            }`}
                          >
                            {t.action === "BUY"
                              ? "▲ BUY"
                              : t.action === "SCALE_IN"
                              ? "▲ SCALE"
                              : t.action === "TRIM_HARVEST"
                              ? "▼ TRIM"
                              : "▼ EXIT"}
                          </span>
                        </td>
                        <td>${t.price.toFixed(2)}</td>
                        <td>
                          {t.action === "EXIT" || t.action === "TRIM_HARVEST" ? (
                            <span
                              style={{
                                color: (t.pnl || 0) >= 0 ? "#16a34a" : "#dc2626",
                                fontWeight: 600
                              }}
                            >
                              ${(t.pnl || 0) >= 0 ? "+" : ""}
                              {Number(t.pnl || 0).toFixed(2)} ({t.return_pct >= 0 ? "+" : ""}
                              {t.return_pct}%)
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
