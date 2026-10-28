import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchStockAnalysis, fetchStockFundamentals, fetchStockIndicatorSeries, fetchStockIntraday, fetchStockPrices } from "../../api/portfolioApi";
import { normalizeError } from "../../core/errors";
import { logger } from "../../core/logger";
import { getDailyPricesWithLiveCandle, getSelectedStock } from "../viewModel";
import SimpleCandlestickChart from "./SimpleCandlestickChart";
import FowaStockChart from "./FowaStockChart";
import RsiChart from "./RsiChart";
import StochChart from "./StochChart";
import MacdChart from "./MacdChart";
import ObvChart from "./ObvChart";
import AtrChart from "./AtrChart";
import StrategySandboxDrawer from "./StrategySandboxDrawer";
import FundamentalsCatalystDrawer from "./FundamentalsCatalystDrawer";
import { INDICATOR_COLORS, INDICATORS_CONFIG, STRATEGY_STUDIES_CONFIG } from "./indicatorColors";

const DEFAULT_INTRADAY_INTERVAL = "5m";

function rangesMatch(left, right) {
  if (!left || !right) return left === right;
  return Math.abs(left.from - right.from) < 0.001 && Math.abs(left.to - right.to) < 0.001;
}

export default function StockChart({
  apiBaseUrl,
  data,
  state,
  dispatch,
  prices: providedPrices,
  caption,
  onPricesLoaded,
  extraStrategyGroups = [],
  initialSelectedStrategies = null,
  tradeMarkers: externalTradeMarkers = null,
  showSandboxDrawer = false,
  selectedIndicators: overrideSelectedIndicators = null,
  selectedStrategies: overrideSelectedStrategies = null,
  indicatorsSelectable = true,
  visibleLogicalRange: propVisibleLogicalRange,
  onVisibleLogicalRangeChange: propOnVisibleLogicalRangeChange,
  enableQuantAlpha = false
}) {
  const stock = data ? getSelectedStock(data, state) : null;
  const [dailyPricesBySymbol, setDailyPricesBySymbol] = useState({});
  const [isLoadingDailyPrices, setIsLoadingDailyPrices] = useState(false);
  const [dailyPricesError, setDailyPricesError] = useState("");

  const cachedDailyPrices = data?.pricesBySymbol?.[stock?.symbol] || dailyPricesBySymbol[stock?.symbol];
  const rawPrices = providedPrices || cachedDailyPrices || [];
  const prices = useMemo(() => {
    if (providedPrices) return providedPrices;
    return getDailyPricesWithLiveCandle(rawPrices, stock);
  }, [providedPrices, rawPrices, stock]);
  const [intradayBySymbol, setIntradayBySymbol] = useState({});
  const [intradayError, setIntradayError] = useState("");
  const [indicatorSeriesBySymbol, setIndicatorSeriesBySymbol] = useState({});
  const [indicatorError, setIndicatorError] = useState("");
  const [analysisBySymbol, setAnalysisBySymbol] = useState({});
  const [fundamentalsBySymbol, setFundamentalsBySymbol] = useState({});
  const [isFundamentalsOpen, setIsFundamentalsOpen] = useState(false);
  const [isLoadingIntraday, setIsLoadingIntraday] = useState(false);
  const [isLoadingIndicators, setIsLoadingIndicators] = useState(false);
  const [isLoadingAnalysis, setIsLoadingAnalysis] = useState(false);
  const [measureEnabled, setMeasureEnabled] = useState(false);
  const [isChartFocused, setIsChartFocused] = useState(false);
  const isChartFocusedRef = useRef(false);
  isChartFocusedRef.current = isChartFocused;
  const [ensembleTradeMarkers, setEnsembleTradeMarkers] = useState([]);
  const mainChartCardRef = useRef(null);
  const rsiChartCardRef = useRef(null);
  const stochChartCardRef = useRef(null);
  const macdChartCardRef = useRef(null);
  const obvChartCardRef = useRef(null);
  const atrChartCardRef = useRef(null);
  const [visibleLogicalRangeState, setVisibleLogicalRangeState] = useState({ scope: "", range: null });
  const chartMode = state?.chartMode || "3y";
  const chartCategory = state?.chartCategory || "indicators";
  const selectedIndicators = overrideSelectedIndicators || state?.selectedIndicators || { ma50: true, ma200: true, rsi14: true };
  const selectedStrategies = overrideSelectedStrategies || state?.selectedStrategies || { supertrend: true };
  const overlayMode = state?.overlayMode || "single";
  const rangeScope = `${chartMode}:${stock?.symbol || ""}`;
  const visibleLogicalRange = propVisibleLogicalRange !== undefined
    ? propVisibleLogicalRange
    : (visibleLogicalRangeState.scope === rangeScope ? visibleLogicalRangeState.range : null);

  useEffect(() => {
    function handleGlobalPointerDown(event) {
      const isInsideMain = mainChartCardRef.current && mainChartCardRef.current.contains(event.target);
      const isInsideRsi = rsiChartCardRef.current && rsiChartCardRef.current.contains(event.target);
      const isInsideStoch = stochChartCardRef.current && stochChartCardRef.current.contains(event.target);
      const isInsideMacd = macdChartCardRef.current && macdChartCardRef.current.contains(event.target);
      const isInsideObv = obvChartCardRef.current && obvChartCardRef.current.contains(event.target);
      const isInsideAtr = atrChartCardRef.current && atrChartCardRef.current.contains(event.target);

      if (!isInsideMain && !isInsideRsi && !isInsideStoch && !isInsideMacd && !isInsideObv && !isInsideAtr) {
        setIsChartFocused(false);
      }
    }

    window.addEventListener("pointerdown", handleGlobalPointerDown);
    return () => window.removeEventListener("pointerdown", handleGlobalPointerDown);
  }, []);

  useEffect(() => {
    setIsChartFocused(false);
  }, [stock?.symbol]);

  const intradayBySymbolRef = useRef(intradayBySymbol);
  intradayBySymbolRef.current = intradayBySymbol;

  const indicatorSeriesBySymbolRef = useRef(indicatorSeriesBySymbol);
  indicatorSeriesBySymbolRef.current = indicatorSeriesBySymbol;

  const analysisBySymbolRef = useRef(analysisBySymbol);
  analysisBySymbolRef.current = analysisBySymbol;

  const fundamentalsBySymbolRef = useRef(fundamentalsBySymbol);
  fundamentalsBySymbolRef.current = fundamentalsBySymbol;


  const syncVisibleLogicalRange = useCallback((range) => {
    if (!range) return;
    if (isChartFocusedRef.current) {
      propOnVisibleLogicalRangeChange?.(range);
    }
    setVisibleLogicalRangeState((current) => {
      if (current.scope === rangeScope && rangesMatch(current.range, range)) return current;
      return { scope: rangeScope, range };
    });
  }, [rangeScope, propOnVisibleLogicalRangeChange]);

  const lastRefreshedAtRef = useRef(data?.lastRefreshedAt);
  const lastUpdatedAtRef = useRef({});

  useEffect(() => {
    if (data?.lastRefreshedAt && data.lastRefreshedAt !== lastRefreshedAtRef.current) {
      lastRefreshedAtRef.current = data.lastRefreshedAt;
      setDailyPricesBySymbol({});
      setIndicatorSeriesBySymbol({});
      setAnalysisBySymbol({});
    }
  }, [data?.lastRefreshedAt]);

  useEffect(() => {
    if (!stock?.symbol) return;
    const prevUpdatedAt = lastUpdatedAtRef.current[stock.symbol];
    if (prevUpdatedAt && stock.updatedAt && prevUpdatedAt !== stock.updatedAt) {
      setDailyPricesBySymbol((current) => {
        const next = { ...current };
        delete next[stock.symbol];
        return next;
      });
      setIndicatorSeriesBySymbol((current) => {
        const next = { ...current };
        delete next[stock.symbol];
        return next;
      });
      setAnalysisBySymbol((current) => {
        const next = { ...current };
        delete next[stock.symbol];
        return next;
      });
    }
    if (stock.updatedAt) {
      lastUpdatedAtRef.current[stock.symbol] = stock.updatedAt;
    }
  }, [stock?.symbol, stock?.updatedAt]);

  const hasDailyPrices = Boolean(
    data?.pricesBySymbol?.[stock?.symbol]?.length || dailyPricesBySymbol[stock?.symbol]?.length
  );

  useEffect(() => {
    let isMounted = true;
    if (!stock?.symbol || providedPrices || hasDailyPrices) return undefined;

    async function loadDailyPrices() {
      setIsLoadingDailyPrices(true);
      setDailyPricesError("");
      try {
        const payload = await fetchStockPrices(apiBaseUrl, stock.symbol);
        if (!isMounted) return;
        setDailyPricesBySymbol((current) => ({
          ...current,
          [stock.symbol]: payload
        }));
        onPricesLoaded?.(stock.symbol, payload);
      } catch (error) {
        const normalized = normalizeError(error);
        logger.error("Failed to load daily stock prices", normalized);
        if (isMounted) setDailyPricesError(normalized.message || "Failed to load prices.");
      } finally {
        if (isMounted) setIsLoadingDailyPrices(false);
      }
    }

    loadDailyPrices();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, stock?.symbol, providedPrices, hasDailyPrices, onPricesLoaded]);

  useEffect(() => {
    let isMounted = true;

    async function loadIntraday() {
      if (chartMode !== "1d" || !stock?.symbol) return;

      if (!intradayBySymbolRef.current[stock.symbol]?.prices?.length) {
        setIsLoadingIntraday(true);
      }
      setIntradayError("");
      try {
        const payload = await fetchStockIntraday(apiBaseUrl, stock.symbol, DEFAULT_INTRADAY_INTERVAL);
        if (!isMounted) return;
        setIntradayBySymbol((current) => ({
          ...current,
          [stock.symbol]: payload
        }));
      } catch (error) {
        const normalized = normalizeError(error);
        logger.error("Failed to load intraday prices", normalized);
        if (isMounted) setIntradayError(normalized.message || "Intraday prices could not be loaded.");
      } finally {
        if (isMounted) setIsLoadingIntraday(false);
      }
    }

    loadIntraday();

    if (chartMode !== "1d" || !stock?.symbol) {
      return () => {
        isMounted = false;
      };
    }

    const intervalId = setInterval(async () => {
      try {
        const payload = await fetchStockIntraday(apiBaseUrl, stock.symbol, DEFAULT_INTRADAY_INTERVAL);
        if (!isMounted) return;
        setIntradayBySymbol((current) => ({
          ...current,
          [stock.symbol]: payload
        }));
      } catch (error) {
        logger.warn("Periodic intraday refresh failed", error);
      }
    }, 60000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [apiBaseUrl, chartMode, stock?.symbol]);

  const hasIndicatorSeries = Boolean(indicatorSeriesBySymbol[stock?.symbol]?.series);

  useEffect(() => {
    let isMounted = true;

    async function loadIndicatorSeries() {
      if (chartMode === "1d" || !stock?.symbol || hasIndicatorSeries) return;

      if (!indicatorSeriesBySymbolRef.current[stock.symbol]?.series) {
        setIsLoadingIndicators(true);
      }
      setIndicatorError("");
      try {
        const payload = await fetchStockIndicatorSeries(apiBaseUrl, stock.symbol);
        if (!isMounted) return;
        setIndicatorSeriesBySymbol((current) => ({
          ...current,
          [stock.symbol]: payload
        }));
      } catch (error) {
        const normalized = normalizeError(error);
        logger.error("Failed to load indicator series", normalized);
        if (isMounted) setIndicatorError(normalized.message || "Indicator series could not be loaded.");
      } finally {
        if (isMounted) setIsLoadingIndicators(false);
      }
    }

    loadIndicatorSeries();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, chartMode, stock?.symbol, hasIndicatorSeries]);

  const hasAnalysis = Boolean(analysisBySymbol[stock?.symbol]);

  useEffect(() => {
    let isMounted = true;

    async function loadAnalysis() {
      if (!enableQuantAlpha || chartMode === "1d" || !stock?.symbol || hasAnalysis) return;

      setIsLoadingAnalysis(true);
      try {
        const payload = await fetchStockAnalysis(apiBaseUrl, stock.symbol);
        if (!isMounted) return;
        setAnalysisBySymbol((current) => ({
          ...current,
          [stock.symbol]: payload
        }));
      } catch (error) {
        logger.warn("Failed to load stock analysis for chart overlay", error);
      } finally {
        if (isMounted) setIsLoadingAnalysis(false);
      }
    }

    loadAnalysis();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, chartMode, stock?.symbol, enableQuantAlpha, hasAnalysis]);

  useEffect(() => {
    let isMounted = true;
    let retryTimer = null;

    async function loadFundamentals(retryCount = 0) {
      if (chartMode === "1d" || !stock?.symbol) return;
      if (stock.symbol.startsWith("^") || stock.assetType === "index") return;
      const existing = fundamentalsBySymbolRef.current[stock.symbol];
      if (existing && existing.status !== "pending_sync") return;

      try {
        const payload = await fetchStockFundamentals(apiBaseUrl, stock.symbol);
        if (!isMounted || !payload) return;
        setFundamentalsBySymbol((current) => ({
          ...current,
          [stock.symbol]: payload
        }));
        if (payload.status === "pending_sync" && retryCount < 6) {
          retryTimer = setTimeout(() => {
            if (isMounted) loadFundamentals(retryCount + 1);
          }, 2000);
        }
      } catch (error) {
        logger.debug("Fundamentals fetch skipped or unavailable", error);
      }
    }

    loadFundamentals(0);
    return () => {
      isMounted = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [apiBaseUrl, chartMode, stock?.symbol, stock?.assetType]);

  if (providedPrices) {
    return <SimpleCandlestickChart prices={prices} caption={caption} />;
  }

  const intradayPayload = intradayBySymbol[stock?.symbol];
  const indicatorPayload = indicatorSeriesBySymbol[stock?.symbol];
  const activeFundamentals = fundamentalsBySymbol[stock?.symbol] || stock?.fundamentals || (
    (stock?.calendar || stock?.next_earnings_date || stock?.nextEarningsDate || stock?.earnings_history || stock?.dividend_history || stock?.dividend_snapshot)
      ? {
          symbol: stock.symbol,
          calendar: stock.calendar || {
            next_earnings_date: stock.next_earnings_date || stock.nextEarningsDate || null,
            earnings_avg_est: stock.earnings_avg_est ?? null,
            ex_dividend_date: stock.ex_dividend_date ?? null
          },
          dividend_snapshot: stock.dividend_snapshot || stock.dividendSnapshot || null,
          earnings_history: stock.earnings_history || stock.earningsHistory || [],
          dividend_history: stock.dividend_history || stock.dividendHistory || []
        }
      : null
  );
  const activePrices = chartMode === "1d" ? intradayPayload?.prices || [] : prices;
  const showIndicators = chartMode !== "1d";
  const strategyOverlays = enableQuantAlpha ? (analysisBySymbol[stock?.symbol]?.chartOverlays || null) : null;
  const activeIndCount = INDICATORS_CONFIG.filter((ind) => selectedIndicators[ind.id]).length;
  const activeStratCount = STRATEGY_STUDIES_CONFIG.filter((strat) => selectedStrategies[strat.id]).length;
  const isIndicatorsLoading = showIndicators && !indicatorError && (isLoadingIndicators || isLoadingDailyPrices || !indicatorPayload?.series);

  return (
    <>
      <div className={`pw-chart-mode-header${showIndicators ? " pw-has-overlays" : ""}`}>
        <div className="pw-chart-title-tabs-group">
          {stock?.priceDirty && <span className="pw-data-anomaly-badge">⚠️ Incomplete Data</span>}
          {showIndicators && (
            <div className="pw-chart-category-tabs" role="tablist" aria-label="Overlay categories">
              <button
                type="button"
                role="tab"
                aria-selected={chartCategory === "indicators"}
                className={`pw-chart-category-btn ${chartCategory === "indicators" ? "pw-active" : ""}`}
                onClick={() => dispatch?.({ type: "setChartCategory", category: "indicators" })}
              >
                <span>📊 Indicators</span>
                {activeIndCount > 0 && <span className="pw-category-count-badge">{activeIndCount}</span>}
              </button>
              {enableQuantAlpha && (
                <>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={chartCategory === "strategies"}
                    className={`pw-chart-category-btn ${chartCategory === "strategies" ? "pw-active" : ""}`}
                    onClick={() => dispatch?.({ type: "setChartCategory", category: "strategies" })}
                  >
                    <span>⚡ Quant Alpha</span>
                    {activeStratCount > 0 && (
                      <span className="pw-category-count-badge pw-strategy-badge">{activeStratCount}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isFundamentalsOpen}
                    className={`pw-chart-category-btn ${isFundamentalsOpen ? "pw-active" : ""}`}
                    onClick={() => setIsFundamentalsOpen((prev) => !prev)}
                  >
                    <span>📅 Fundamentals &amp; Catalysts</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div className="pw-chart-header-actions">
          <div className="pw-chart-mode-controls" role="tablist" aria-label="Chart range">
            <button
              className={chartMode === "1d" ? "pw-active" : ""}
              type="button"
              onClick={() => dispatch({ type: "setChartMode", mode: "1d" })}
            >
              1d
            </button>
            <button
              className={chartMode === "3y" ? "pw-active" : ""}
              type="button"
              onClick={() => dispatch({ type: "setChartMode", mode: "3y" })}
            >
              3y
            </button>
            <button
              className={chartMode === "all" || chartMode === "7y" ? "pw-active" : ""}
              type="button"
              title="Since 2017"
              onClick={() => dispatch({ type: "setChartMode", mode: "all" })}
            >
              All
            </button>
          </div>
          <button
            className={`pw-chart-measure-toggle${measureEnabled ? " pw-active" : ""}`}
            type="button"
            aria-pressed={measureEnabled}
            onClick={() => setMeasureEnabled((current) => !current)}
          >
            Measure
          </button>
        </div>
      </div>
      {showIndicators && (
        <div className="pw-chart-overlays-toolbar" aria-label="Chart overlays and studies">
          {(!enableQuantAlpha || chartCategory === "indicators") && (
            <div className="pw-indicator-toggle-row" aria-label="Technical indicators">
              {INDICATORS_CONFIG.map((ind) => (
                <button
                  key={ind.id}
                  className={selectedIndicators[ind.id] ? "pw-active" : ""}
                  style={{
                    "--pw-indicator-color": ind.color,
                    "--pw-indicator-soft": ind.soft,
                    cursor: indicatorsSelectable ? "pointer" : "default"
                  }}
                  type="button"
                  aria-pressed={Boolean(selectedIndicators[ind.id])}
                  onClick={indicatorsSelectable ? () => dispatch({ type: "toggleIndicator", indicator: ind.id }) : undefined}
                  title={indicatorsSelectable ? undefined : "Controlled by Performance Lab selection above"}
                >
                  {ind.label}
                </button>
              ))}
              {!indicatorsSelectable && (
                <span className="pw-indicators-synced-hint">Synced with Performance Lab</span>
              )}
            </div>
          )}

          {enableQuantAlpha && chartCategory === "strategies" && (
            <div className="pw-indicator-toggle-row pw-strategy-toggle-row" aria-label="Quant Alpha models">
              {STRATEGY_STUDIES_CONFIG.map((strat) => (
                <button
                  key={strat.id}
                  className={selectedStrategies[strat.id] ? "pw-active" : ""}
                  style={{
                    "--pw-indicator-color": strat.color,
                    "--pw-indicator-soft": strat.soft,
                    cursor: indicatorsSelectable ? "pointer" : "default"
                  }}
                  type="button"
                  aria-pressed={Boolean(selectedStrategies[strat.id])}
                  onClick={indicatorsSelectable ? () => dispatch?.({ type: "toggleStrategy", strategy: strat.id }) : undefined}
                  title={indicatorsSelectable ? strat.description : "Controlled by Performance Lab selection above"}
                >
                  {strat.label}
                </button>
              ))}
              {!indicatorsSelectable && (
                <span className="pw-indicators-synced-hint">Synced with Performance Lab</span>
              )}
              {indicatorsSelectable && (
                <>
                  <span className="pw-category-tab-divider" aria-hidden="true" />
                  <label
                    className="pw-overlay-mode-checkbox"
                    title="Allow multiple Quant Alpha models to be plotted simultaneously"
                  >
                    <input
                      type="checkbox"
                      checked={overlayMode === "multi"}
                      onChange={(e) =>
                        dispatch?.({
                          type: "setOverlayMode",
                          mode: e.target.checked ? "multi" : "single"
                        })
                      }
                    />
                    <span>Multi</span>
                  </label>
                </>
              )}
            </div>
          )}
        </div>
      )}
      {stock?.priceDirty && (
        <div className="pw-data-anomaly-banner" role="alert">
          <span>⚠️</span>
          <span>
            <strong>Abnormal / Incomplete Data:</strong> Provider returned missing price candle(s) for this stock. The app will automatically reload when the provider fixes it.
          </span>
        </div>
      )}
      {chartMode === "1d" && isLoadingIntraday && !activePrices.length && (
        <div className="pw-inline-info">Loading intraday prices...</div>
      )}
      {chartMode === "1d" && intradayError && <div className="pw-inline-error">{intradayError}</div>}
      {chartMode !== "1d" && isLoadingDailyPrices && !activePrices.length && (
        <div className="pw-inline-info">Loading chart prices...</div>
      )}
      {chartMode !== "1d" && dailyPricesError && <div className="pw-inline-error">{dailyPricesError}</div>}
      {showIndicators && isLoadingIndicators && !indicatorPayload?.series && (
        <div className="pw-inline-info">Loading indicator series...</div>
      )}
      {showIndicators && indicatorError && <div className="pw-inline-error">{indicatorError}</div>}
      {showIndicators && enableQuantAlpha && chartCategory === "strategies" && isLoadingAnalysis && !strategyOverlays && (
        <div className="pw-inline-info">Loading Quant Alpha models...</div>
      )}
      <FowaStockChart
        cardRef={mainChartCardRef}
        isFocused={isChartFocused}
        onFocus={() => setIsChartFocused(true)}
        symbol={stock?.symbol}
        chartMode={chartMode}
        prices={activePrices}
        indicatorSeries={showIndicators ? indicatorPayload?.series : null}
        selectedIndicators={showIndicators ? selectedIndicators : null}
        strategyOverlays={showIndicators && enableQuantAlpha ? strategyOverlays : null}
        selectedStrategies={showIndicators && enableQuantAlpha ? selectedStrategies : null}
        tradeMarkers={showIndicators ? (externalTradeMarkers !== null ? externalTradeMarkers : ensembleTradeMarkers) : null}
        fundamentals={showIndicators ? activeFundamentals : null}
        earningsHistory={showIndicators ? activeFundamentals?.earnings_history : null}
        dividendHistory={showIndicators ? activeFundamentals?.dividend_history : null}
        measureEnabled={measureEnabled}
        visibleLogicalRange={showIndicators ? visibleLogicalRange : null}
        onVisibleLogicalRangeChange={showIndicators ? syncVisibleLogicalRange : null}
        isLoading={chartMode === "1d" ? isLoadingIntraday : (isLoadingDailyPrices || (showIndicators && (isLoadingIndicators || (enableQuantAlpha && isLoadingAnalysis))))}
        fallback={<SimpleCandlestickChart prices={activePrices} caption="Fallback candle view" />}
      />
      {showIndicators && selectedIndicators.atr14 && (
        <>
          <div className="pw-spacer" />
          <AtrChart
            cardRef={atrChartCardRef}
            isFocused={isChartFocused}
            onFocus={() => setIsChartFocused(true)}
            chartMode={chartMode}
            prices={prices}
            series={indicatorPayload?.series?.atr14 || []}
            visibleLogicalRange={visibleLogicalRange}
            onVisibleLogicalRangeChange={syncVisibleLogicalRange}
            isLoading={isIndicatorsLoading}
          />
        </>
      )}
      {showIndicators && selectedIndicators.rsi14 && (
        <>
          <div className="pw-spacer" />
          <RsiChart
            cardRef={rsiChartCardRef}
            isFocused={isChartFocused}
            onFocus={() => setIsChartFocused(true)}
            chartMode={chartMode}
            prices={prices}
            series={indicatorPayload?.series?.rsi14 || []}
            visibleLogicalRange={visibleLogicalRange}
            onVisibleLogicalRangeChange={syncVisibleLogicalRange}
            isLoading={isIndicatorsLoading}
          />
        </>
      )}
      {showIndicators && selectedIndicators.stoch14 && (
        <>
          <div className="pw-spacer" />
          <StochChart
            cardRef={stochChartCardRef}
            isFocused={isChartFocused}
            onFocus={() => setIsChartFocused(true)}
            chartMode={chartMode}
            prices={prices}
            series={indicatorPayload?.series?.stoch14 || {}}
            visibleLogicalRange={visibleLogicalRange}
            onVisibleLogicalRangeChange={syncVisibleLogicalRange}
            isLoading={isIndicatorsLoading}
          />
        </>
      )}
      {showIndicators && selectedIndicators.macd && (
        <>
          <div className="pw-spacer" />
          <MacdChart
            cardRef={macdChartCardRef}
            isFocused={isChartFocused}
            onFocus={() => setIsChartFocused(true)}
            chartMode={chartMode}
            prices={prices}
            series={indicatorPayload?.series?.macd || {}}
            visibleLogicalRange={visibleLogicalRange}
            onVisibleLogicalRangeChange={syncVisibleLogicalRange}
            isLoading={isIndicatorsLoading}
          />
        </>
      )}
      {showIndicators && selectedIndicators.obv && (
        <>
          <div className="pw-spacer" />
          <ObvChart
            cardRef={obvChartCardRef}
            isFocused={isChartFocused}
            onFocus={() => setIsChartFocused(true)}
            chartMode={chartMode}
            prices={prices}
            series={indicatorPayload?.series?.obv || {}}
            visibleLogicalRange={visibleLogicalRange}
            onVisibleLogicalRangeChange={syncVisibleLogicalRange}
            isLoading={isIndicatorsLoading}
          />
        </>
      )}
      {showIndicators && showSandboxDrawer && (
        <StrategySandboxDrawer
          symbol={stock?.symbol}
          apiBaseUrl={apiBaseUrl}
          extraStrategyGroups={extraStrategyGroups}
          initialSelectedStrategies={initialSelectedStrategies}
          onTradeMarkersChange={setEnsembleTradeMarkers}
          visibleLogicalRange={visibleLogicalRange}
          onVisibleLogicalRangeChange={syncVisibleLogicalRange}
          mainPrices={activePrices}
        />
      )}
      {showIndicators && isFundamentalsOpen && (
        <>
          <div className="pw-spacer" />
          <FundamentalsCatalystDrawer
            apiBaseUrl={apiBaseUrl}
            stock={stock}
            data={data}
            state={state}
            fundamentals={activeFundamentals}
            onClose={() => setIsFundamentalsOpen(false)}
          />
        </>
      )}
    </>
  );
}
