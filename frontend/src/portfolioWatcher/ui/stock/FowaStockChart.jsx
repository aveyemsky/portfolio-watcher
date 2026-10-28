import { useEffect, useRef, useState } from "react";

import { logger } from "../../core/logger";
import { getDefaultVisibleRange } from "./chartRange";
import { INDICATOR_COLORS, INDICATORS_CONFIG, STRATEGY_STUDIES_CONFIG } from "./indicatorColors";

function toTimeValue(price) {
  return price.timestamp ? Math.floor(new Date(price.timestamp).getTime() / 1000) : price.date;
}

export function isLineOnlySymbol(symbol) {
  if (!symbol) return false;
  const s = String(symbol).trim().toUpperCase();
  return s === "^SKEW" || s === "SKEW";
}

export function toAreaSeriesData(prices) {
  const map = new Map();
  for (const price of prices || []) {
    const time = toTimeValue(price);
    if (!time) continue;
    const val = Number(price.close ?? price.open ?? 0);
    if (!Number.isFinite(val)) continue;
    map.set(time, {
      time,
      value: val
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (typeof a.time === "number" && typeof b.time === "number") {
      return a.time - b.time;
    }
    return String(a.time).localeCompare(String(b.time));
  });
}

export function toCandlestickData(prices) {
  const map = new Map();
  for (const price of prices || []) {
    const time = toTimeValue(price);
    if (!time) continue;
    map.set(time, {
      time,
      open: Number(price.open),
      high: Number(price.high),
      low: Number(price.low),
      close: Number(price.close)
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (typeof a.time === "number" && typeof b.time === "number") {
      return a.time - b.time;
    }
    return String(a.time).localeCompare(String(b.time));
  });
}

export function toVolumeData(prices) {
  const map = new Map();
  for (const price of prices || []) {
    const time = toTimeValue(price);
    if (!time) continue;
    const vol = Number(price.volume ?? 0);
    const open = Number(price.open ?? 0);
    const close = Number(price.close ?? 0);
    const isUp = close >= open;
    map.set(time, {
      time,
      value: vol,
      color: isUp ? "rgba(22, 160, 107, 0.45)" : "rgba(226, 87, 87, 0.45)"
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (typeof a.time === "number" && typeof b.time === "number") {
      return a.time - b.time;
    }
    return String(a.time).localeCompare(String(b.time));
  });
}

function toLineData(points) {
  const map = new Map();
  for (const point of points || []) {
    const time = point?.time || point?.date;
    const val = Number(point?.value ?? point?.price);
    if (!time || !Number.isFinite(val)) continue;
    map.set(time, { time, value: val });
  }
  return Array.from(map.values()).sort((a, b) => {
    if (typeof a.time === "number" && typeof b.time === "number") {
      return a.time - b.time;
    }
    return String(a.time).localeCompare(String(b.time));
  });
}

function resolveBarDate(rawDate, candleDates, candleDatesSet) {
  if (!rawDate) return null;
  const dateStr = String(rawDate).slice(0, 10);
  if (!candleDates || candleDates.length === 0) {
    return dateStr;
  }
  if (candleDatesSet.has(dateStr)) {
    return dateStr;
  }
  const minDate = candleDates[0];
  const maxDate = candleDates[candleDates.length - 1];
  if (dateStr < minDate || dateStr > maxDate) {
    return null;
  }
  // Snap weekend/holiday event date to the nearest trading candle bar so price candle alignments never shift
  for (let i = 0; i < candleDates.length; i += 1) {
    if (candleDates[i] >= dateStr) {
      return candleDates[i];
    }
  }
  return null;
}

export function buildFundamentalMarkers(
  earningsHistory = [],
  dividendHistory = [],
  prices = [],
  fundamentals = null
) {
  const candleDates = (prices || [])
    .map((p) => (p?.date ? String(p.date).slice(0, 10) : null))
    .filter(Boolean)
    .sort();
  const candleDatesSet = new Set(candleDates);
  const maxCandleDate = candleDates.length > 0 ? candleDates[candleDates.length - 1] : null;

  const markers = [];

  for (const item of earningsHistory || []) {
    if (!item) continue;
    const rawDate = item.date || item.earnings_date;
    const barDate = resolveBarDate(rawDate, candleDates, candleDatesSet);
    if (!barDate) continue;

    const epsReported = item.eps_reported ?? item.epsReported;
    const epsEstimate = item.eps_estimate ?? item.epsEstimate;
    const surprisePct = item.surprise_pct ?? item.surprisePct;

    let color = "#64748B";
    if (surprisePct !== null && surprisePct !== undefined && epsReported !== null && epsReported !== undefined) {
      color = Number(surprisePct) >= 0 ? "#10B981" : "#EF4444";
    }

    let tooltip;
    if (epsReported !== null && epsReported !== undefined) {
      const repStr = `$${Number(epsReported).toFixed(2)}`;
      const estStr = epsEstimate !== null && epsEstimate !== undefined ? `$${Number(epsEstimate).toFixed(2)}` : "N/A";
      if (surprisePct !== null && surprisePct !== undefined) {
        const sVal = Number(surprisePct);
        const sign = sVal >= 0 ? "+" : "";
        const verdict = sVal >= 0 ? "Beat" : "Miss";
        tooltip = `EPS: ${repStr} (Est: ${estStr}, ${sign}${sVal.toFixed(1)}% ${verdict})`;
      } else {
        tooltip = `EPS: ${repStr} (Est: ${estStr})`;
      }
    } else {
      const estStr = epsEstimate !== null && epsEstimate !== undefined ? `$${Number(epsEstimate).toFixed(2)}` : "N/A";
      tooltip = `EPS: Pending (Est: ${estStr})`;
    }

    markers.push({
      time: barDate,
      position: "belowBar",
      shape: "circle",
      color,
      text: "E",
      tooltip,
      title: tooltip,
      eventType: "earnings",
      rawDate: String(rawDate).slice(0, 10),
      size: 1
    });
  }

  // If next_earnings_date falls on or before the latest candle bar (e.g. reporting today)
  // and isn't already represented in earningsHistory, render a pending [E] marker on that bar.
  const calNextEarnings =
    fundamentals?.calendar?.next_earnings_date ??
    fundamentals?.calendar?.nextEarningsDate ??
    fundamentals?.next_earnings_date ??
    fundamentals?.nextEarningsDate ??
    null;
  if (calNextEarnings && maxCandleDate) {
    const nextDateStr = String(calNextEarnings).slice(0, 10);
    if (nextDateStr <= maxCandleDate) {
      const nextUtc = parseIsoUtcMs(nextDateStr);
      const alreadyHasMarker =
        nextUtc != null &&
        markers.some((m) => {
          if (m.eventType !== "earnings") return false;
          const mUtc = parseIsoUtcMs(m.rawDate || m.time);
          return mUtc != null && Math.abs(mUtc - nextUtc) <= 2 * 86400000;
        });
      if (!alreadyHasMarker) {
        const barDate = resolveBarDate(nextDateStr, candleDates, candleDatesSet);
        if (barDate) {
          const calEpsEst =
            fundamentals?.calendar?.earnings_avg_est ??
            fundamentals?.calendar?.earningsAvgEst ??
            fundamentals?.earnings_avg_est ??
            null;
          const estStr =
            calEpsEst !== null && calEpsEst !== undefined && Number.isFinite(Number(calEpsEst))
              ? `$${Number(calEpsEst).toFixed(2)}`
              : "N/A";
          const tooltip = `EPS: Pending (Est: ${estStr})`;
          markers.push({
            time: barDate,
            position: "belowBar",
            shape: "circle",
            color: "#64748B",
            text: "E",
            tooltip,
            title: tooltip,
            eventType: "earnings",
            rawDate: nextDateStr,
            size: 1
          });
        }
      }
    }
  }

  for (const item of dividendHistory || []) {
    if (!item) continue;
    const rawDate = item.date || item.ex_date;
    const amount = item.amount ?? item.cash_amount ?? item.cashAmount;
    if (amount === null || amount === undefined || Number(amount) <= 0) continue;

    const barDate = resolveBarDate(rawDate, candleDates, candleDatesSet);
    if (!barDate) continue;

    const amtStr = `$${Number(amount).toFixed(2)}`;
    const tooltip = `Dividend Ex-Date: ${amtStr} / sh`;

    markers.push({
      time: barDate,
      position: "aboveBar",
      shape: "square",
      color: "#0EA5E9",
      text: "D",
      tooltip,
      title: tooltip,
      eventType: "dividend",
      rawDate: String(rawDate).slice(0, 10),
      size: 1
    });
  }

  return markers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
}

function parseIsoUtcMs(dateStr) {
  if (!dateStr) return null;
  const match = String(dateStr).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, yr, mo, dy] = match;
  return Date.UTC(Number(yr), Number(mo) - 1, Number(dy));
}

export function buildUpcomingChartCatalysts(
  fundamentals = null,
  earningsHistory = [],
  dividendHistory = [],
  prices = [],
  refDate = null,
  maxDaysAhead = 14
) {
  const candleDates = (prices || [])
    .map((p) => (p?.date ? String(p.date).slice(0, 10) : null))
    .filter(Boolean)
    .sort();
  const maxCandleDate = candleDates.length > 0 ? candleDates[candleDates.length - 1] : null;
  const maxCandleUtc = parseIsoUtcMs(maxCandleDate);

  const now = refDate ? new Date(refDate) : new Date();
  const todayUtc = refDate
    ? Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());

  const baseUtc = maxCandleUtc != null ? Math.max(maxCandleUtc, todayUtc) : todayUtc;
  const lastBarUtc = maxCandleUtc != null ? maxCandleUtc : todayUtc;

  let rawNextEarnings =
    fundamentals?.calendar?.next_earnings_date ??
    fundamentals?.calendar?.nextEarningsDate ??
    fundamentals?.next_earnings_date ??
    fundamentals?.nextEarningsDate ??
    null;

  let rawEpsEst =
    fundamentals?.calendar?.earnings_avg_est ??
    fundamentals?.calendar?.earningsAvgEst ??
    fundamentals?.earnings_avg_est ??
    null;

  if (!rawNextEarnings && Array.isArray(earningsHistory)) {
    for (const item of earningsHistory) {
      const d = item?.date || item?.earnings_date;
      const dUtc = parseIsoUtcMs(d);
      if (dUtc != null && dUtc > lastBarUtc) {
        rawNextEarnings = String(d).slice(0, 10);
        if (rawEpsEst == null) {
          rawEpsEst = item?.eps_estimate ?? item?.epsEstimate ?? null;
        }
        break;
      }
    }
  }

  let rawNextExDiv =
    fundamentals?.calendar?.ex_dividend_date ??
    fundamentals?.calendar?.exDividendDate ??
    fundamentals?.ex_dividend_date ??
    fundamentals?.exDividendDate ??
    null;

  let rawDivRate =
    fundamentals?.dividend_snapshot?.annual_rate ??
    fundamentals?.dividend_snapshot?.annualRate ??
    fundamentals?.dividend_rate ??
    null;

  if (!rawNextExDiv && Array.isArray(dividendHistory)) {
    for (const item of dividendHistory) {
      const d = item?.date || item?.ex_date;
      const dUtc = parseIsoUtcMs(d);
      if (dUtc != null && dUtc > lastBarUtc) {
        rawNextExDiv = String(d).slice(0, 10);
        break;
      }
    }
  }

  const upcoming = [];

  if (rawNextEarnings) {
    const dateStr = String(rawNextEarnings).slice(0, 10);
    const targetUtc = parseIsoUtcMs(dateStr);
    if (targetUtc != null) {
      const daysUntil = Math.round((targetUtc - baseUtc) / 86400000);
      const daysFromLastBar = Math.round((targetUtc - lastBarUtc) / 86400000);
      const hasReportedOnDate =
        Array.isArray(earningsHistory) &&
        earningsHistory.some((item) => {
          const dUtc = parseIsoUtcMs(item?.date || item?.earnings_date);
          const rep = item?.eps_reported ?? item?.epsReported;
          return dUtc != null && Math.abs(dUtc - targetUtc) <= 2 * 86400000 && rep !== null && rep !== undefined;
        });
      if (
        daysUntil >= 0 &&
        daysUntil <= maxDaysAhead &&
        (maxCandleDate == null || dateStr > maxCandleDate || (dateStr === maxCandleDate && !hasReportedOnDate))
      ) {
        const [, mo, dy] = dateStr.split("-");
        const mmdd = `${mo}/${dy}`;
        const tradingBarsAhead =
          daysFromLastBar <= 0
            ? 0
            : Math.max(1, Math.min(8, Math.round(daysFromLastBar * (5 / 7))));
        const estStr =
          rawEpsEst != null && Number.isFinite(Number(rawEpsEst))
            ? ` · Est EPS: $${Number(rawEpsEst).toFixed(2)}`
            : "";
        const whenLabel = daysUntil === 0 ? "Today" : `in ${daysUntil}d`;
        upcoming.push({
          eventType: "earnings",
          text: "E",
          date: dateStr,
          mmdd,
          daysUntil,
          daysFromLastBar,
          tradingBarsAhead,
          color: "#D946EF",
          tooltip: `Upcoming Earnings: ${mmdd} (${whenLabel})${estStr}`
        });
      }
    }
  }

  if (rawNextExDiv) {
    const dateStr = String(rawNextExDiv).slice(0, 10);
    const targetUtc = parseIsoUtcMs(dateStr);
    if (targetUtc != null) {
      const daysUntil = Math.round((targetUtc - baseUtc) / 86400000);
      const daysFromLastBar = Math.round((targetUtc - lastBarUtc) / 86400000);
      const hasDivOnDate =
        Array.isArray(dividendHistory) &&
        dividendHistory.some((item) => {
          const dUtc = parseIsoUtcMs(item?.date || item?.ex_date);
          return dUtc != null && Math.abs(dUtc - targetUtc) <= 2 * 86400000;
        });
      if (
        daysUntil >= 0 &&
        daysUntil <= maxDaysAhead &&
        (maxCandleDate == null || dateStr > maxCandleDate || (dateStr === maxCandleDate && !hasDivOnDate))
      ) {
        const [, mo, dy] = dateStr.split("-");
        const mmdd = `${mo}/${dy}`;
        const tradingBarsAhead =
          daysFromLastBar <= 0
            ? 0
            : Math.max(1, Math.min(8, Math.round(daysFromLastBar * (5 / 7))));
        const rateStr =
          rawDivRate != null && Number(rawDivRate) > 0
            ? ` · $${Number(rawDivRate).toFixed(2)} / yr`
            : "";
        const whenLabel = daysUntil === 0 ? "Today" : `in ${daysUntil}d`;
        upcoming.push({
          eventType: "dividend",
          text: "D",
          date: dateStr,
          mmdd,
          daysUntil,
          daysFromLastBar,
          tradingBarsAhead,
          color: "#0EA5E9",
          tooltip: `Upcoming Ex-Dividend: ${mmdd} (${whenLabel})${rateStr}`
        });
      }
    }
  }

  return upcoming;
}

function getUpcomingCatalystPositionStyle(item, idx, chart, prices, overlayVersion) {
  void overlayVersion;
  if (!chart || !prices || prices.length === 0) {
    return {
      right: `${72 - idx * 32}px`,
      bottom: "21%"
    };
  }

  const lastIdx = prices.length - 1;
  const timeScale = chart.timeScale();
  const plotWidth = typeof timeScale.width === "function" ? timeScale.width() : 0;
  const xLast = timeScale.logicalToCoordinate(lastIdx);
  if (xLast === null || xLast === undefined) {
    return {
      right: `${72 - idx * 32}px`,
      bottom: "21%"
    };
  }

  if (plotWidth > 0 && (xLast < 0 || xLast > plotWidth + 40)) {
    return null;
  }

  const xPrev = lastIdx > 0 ? timeScale.logicalToCoordinate(lastIdx - 1) : null;
  const barStep =
    xPrev !== null && xPrev !== undefined && xLast > xPrev
      ? clamp(xLast - xPrev, 5, 24)
      : 10;

  const barsAhead = item.tradingBarsAhead ?? 1;
  const rawX = xLast + barStep * barsAhead + idx * 24;
  const minX = barsAhead <= 0 ? xLast : xLast + 12;
  const clampedX = plotWidth > 40 ? clamp(rawX, minX, plotWidth - 22) : rawX;

  return {
    left: `${Math.round(clampedX)}px`,
    bottom: "21%",
    transform: "translateX(-50%)"
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function priceTimeToDate(price) {
  if (price?.timestamp) return new Date(price.timestamp);
  if (price?.date) return new Date(`${price.date}T00:00:00`);
  return null;
}

function formatDuration(startDate, endDate, isIntraday) {
  if (!startDate || !endDate) return "";

  const elapsedMs = Math.abs(endDate.getTime() - startDate.getTime());
  if (!Number.isFinite(elapsedMs)) return "";

  if (isIntraday) {
    const minutes = Math.round(elapsedMs / 60000);
    if (minutes < 60) return `${minutes}m`;

    const hours = minutes / 60;
    return `${hours.toFixed(hours >= 10 ? 0 : 1)}h`;
  }

  const days = Math.round(elapsedMs / 86400000);
  return `${days}d`;
}

function buildMeasureLabel(measure, prices) {
  const delta = measure.end.price - measure.start.price;
  const pct = measure.start.price ? (delta / measure.start.price) * 100 : 0;
  const sign = delta >= 0 ? "+" : "";
  const startIndex = Math.round(measure.start.logical);
  const endIndex = Math.round(measure.end.logical);
  const barCount = Math.abs(endIndex - startIndex);
  const startPrice = prices[clamp(startIndex, 0, prices.length - 1)];
  const endPrice = prices[clamp(endIndex, 0, prices.length - 1)];
  const isIntraday = Boolean(startPrice?.timestamp || endPrice?.timestamp);
  const duration = formatDuration(priceTimeToDate(startPrice), priceTimeToDate(endPrice), isIntraday);

  return {
    primary: `${sign}${delta.toFixed(2)} (${sign}${pct.toFixed(2)}%)`,
    secondary: duration ? `${barCount} bars, ${duration}` : `${barCount} bars`
  };
}

function getMeasureOverlay(measure, chart, candleSeries, prices, paneHeight, overlayVersion) {
  void overlayVersion;
  if (!measure?.start || !measure?.end || !chart || !candleSeries) return null;

  const x1 = chart.timeScale().logicalToCoordinate(measure.start.logical);
  const x2 = chart.timeScale().logicalToCoordinate(measure.end.logical);
  const y1 = candleSeries.priceToCoordinate(measure.start.price);
  const y2 = candleSeries.priceToCoordinate(measure.end.price);
  if (x1 === null || x2 === null || y1 === null || y2 === null) return null;

  const label = buildMeasureLabel(measure, prices);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  const isUp = measure.end.price >= measure.start.price;
  const labelLeft = clamp(Math.max(left, x2) - 172, 8, Math.max(8, chart.timeScale().width() - 188));
  const labelTop = clamp(Math.max(y1, y2) + 10, 8, Math.max(8, paneHeight - 70));

  return {
    direction: isUp ? "up" : "down",
    label,
    boxStyle: {
      left,
      top,
      width: Math.max(width, 1),
      height: Math.max(height, 1)
    },
    startXStyle: { left: x1 },
    endXStyle: { left: x2 },
    startYStyle: { top: y1 },
    endYStyle: { top: y2 },
    labelStyle: {
      left: labelLeft,
      top: labelTop
    }
  };
}

export default function FowaStockChart({
  symbol,
  chartMode = "7y",
  prices = [],
  fallback,
  indicatorSeries,
  selectedIndicators,
  strategyOverlays,
  selectedStrategies,
  tradeMarkers,
  fundamentals = null,
  earningsHistory = null,
  dividendHistory = null,
  measureEnabled,
  visibleLogicalRange,
  onVisibleLogicalRangeChange,
  isLoading = false,
  cardRef,
  isFocused = false,
  onFocus,
  height = 320,
  refDate = null
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const candleSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const isApplyingRangeRef = useRef(false);
  const isMeasuringRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const [errorMessage, setErrorMessage] = useState("");
  const [measure, setMeasure] = useState(null);
  const [overlayVersion, setOverlayVersion] = useState(0);
  const [hoveredMarkers, setHoveredMarkers] = useState([]);

  const resolvedEarnings = earningsHistory || fundamentals?.earnings_history || fundamentals?.earningsHistory || [];
  const resolvedDividends = dividendHistory || fundamentals?.dividend_history || fundamentals?.dividendHistory || [];
  const fundamentalMarkers = chartMode === "1d"
    ? []
    : buildFundamentalMarkers(resolvedEarnings, resolvedDividends, prices, fundamentals);
  const upcomingCatalysts = chartMode === "1d" || isLineOnlySymbol(symbol)
    ? []
    : buildUpcomingChartCatalysts(fundamentals, resolvedEarnings, resolvedDividends, prices, refDate);


  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.applyOptions({
        handleScroll: {
          mouseWheel: Boolean(isFocused)
        },
        handleScale: {
          mouseWheel: Boolean(isFocused)
        }
      });
    }
  }, [isFocused]);

  useEffect(() => {
    if (chartRef.current && containerRef.current) {
      chartRef.current.applyOptions({ height });
      bumpOverlay();
    }
  }, [height]);

  function bumpOverlay() {
    setOverlayVersion((current) => current + 1);
  }

  function measurePointFromEvent(event) {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const container = containerRef.current;
    if (!chart || !candleSeries || !container) return null;

    const bounds = container.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const logical = chart.timeScale().coordinateToLogical(x);
    const price = candleSeries.coordinateToPrice(y);
    if (logical === null || price === null) return null;

    return {
      logical: Number(logical),
      price: Number(price)
    };
  }

  function handleMeasurePointerDown(event) {
    if (!measureEnabled) return;
    const point = measurePointFromEvent(event);
    if (!point) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    isMeasuringRef.current = true;
    setMeasure({ start: point, end: point });
  }

  function handleMeasurePointerMove(event) {
    if (!measureEnabled || !isMeasuringRef.current) return;
    const point = measurePointFromEvent(event);
    if (!point) return;

    event.preventDefault();
    setMeasure((current) => (current ? { ...current, end: point } : current));
  }

  function finishMeasure(event) {
    if (!isMeasuringRef.current) return;

    event.preventDefault();
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    isMeasuringRef.current = false;
  }

  useEffect(() => {
    if (!chartRef.current || !visibleLogicalRange) return;

    isApplyingRangeRef.current = true;
    chartRef.current.timeScale().setVisibleLogicalRange(visibleLogicalRange);
    window.requestAnimationFrame(() => {
      isApplyingRangeRef.current = false;
      bumpOverlay();
    });
  }, [visibleLogicalRange]);

  useEffect(() => {
    isMeasuringRef.current = false;
    setMeasure(null);
  }, [measureEnabled, prices, symbol]);

  const pricesRef = useRef(prices);
  pricesRef.current = prices;

  const hasPrices = Boolean(prices && prices.length > 0);

  useEffect(() => {
    const isLineOnly = isLineOnlySymbol(symbol);
    if (candleSeriesRef.current && hasPrices) {
      if (isLineOnly) {
        candleSeriesRef.current.setData(toAreaSeriesData(prices));
      } else {
        candleSeriesRef.current.setData(toCandlestickData(prices));
      }
    }
    if (volumeSeriesRef.current && hasPrices) {
      if (isLineOnly) {
        volumeSeriesRef.current.setData([]);
      } else {
        volumeSeriesRef.current.setData(toVolumeData(prices));
      }
    }
  }, [hasPrices, prices, symbol]);

  useEffect(() => {
    if (!containerRef.current || !hasPrices) return undefined;

    let chart;
    let handleVisibleRangeChange;
    let resizeObserver;
    let active = true;

    async function mountChart() {
      try {
        setErrorMessage("");
        const { AreaSeries, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, createChart, createSeriesMarkers } = await import("lightweight-charts");
        if (!active || !containerRef.current) return;

        const isLineOnly = isLineOnlySymbol(symbol);

        chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: height,
          handleScroll: {
            mouseWheel: Boolean(isFocusedRef.current),
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: true
          },
          handleScale: {
            mouseWheel: Boolean(isFocusedRef.current),
            pinch: true,
            axisPressedMouseMove: {
              time: true,
              price: true
            },
            axisDoubleClickReset: {
              time: true,
              price: true
            }
          },
          layout: {
            background: { color: "#ffffff" },
            textColor: "#162033",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
          },
          grid: {
            vertLines: { color: "rgba(18, 28, 48, 0.06)" },
            horzLines: { color: "rgba(18, 28, 48, 0.06)" }
          },
          rightPriceScale: {
            borderColor: "rgba(18, 28, 48, 0.12)",
            scaleMargins: {
              top: isLineOnly ? 0.08 : 0.05,
              bottom: isLineOnly ? 0.08 : 0.2
            }
          },
          timeScale: {
            borderColor: "rgba(18, 28, 48, 0.12)",
            timeVisible: chartMode === "1d",
            secondsVisible: false
          }
        });
        chartRef.current = chart;

        const candleSeries = isLineOnly
          ? chart.addSeries(AreaSeries, {
              topColor: "rgba(37, 99, 235, 0.28)",
              bottomColor: "rgba(37, 99, 235, 0.02)",
              lineColor: "#2563eb",
              lineWidth: 2,
              priceLineVisible: false
            })
          : chart.addSeries(CandlestickSeries, {
              upColor: "#16a06b",
              downColor: "#e25757",
              borderVisible: false,
              wickUpColor: "#16a06b",
              wickDownColor: "#e25757",
              priceLineVisible: false
            });
        candleSeriesRef.current = candleSeries;
        if (isLineOnly) {
          candleSeries.setData(toAreaSeriesData(pricesRef.current));
        } else {
          candleSeries.setData(toCandlestickData(pricesRef.current));
        }

        const volumeSeries = chart.addSeries(HistogramSeries, {
          priceFormat: {
            type: "volume"
          },
          priceScaleId: "",
          priceLineVisible: false,
          lastValueVisible: false,
          title: "Vol"
        });
        volumeSeriesRef.current = volumeSeries;
        volumeSeries.priceScale().applyOptions({
          scaleMargins: {
            top: 0.8,
            bottom: 0
          }
        });
        if (!isLineOnly) {
          volumeSeries.setData(toVolumeData(pricesRef.current));
        } else {
          volumeSeries.setData([]);
        }

        INDICATORS_CONFIG.forEach((ind) => {
          if (!selectedIndicators?.[ind.id]) return;

          if (ind.type === "overlay" && indicatorSeries?.[ind.id]?.length) {
            const lineSeries = chart.addSeries(LineSeries, {
              color: ind.color,
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: true,
              title: ind.label
            });
            lineSeries.setData(toLineData(indicatorSeries[ind.id]));
          } else if (ind.type === "overlay_bands" && indicatorSeries?.[ind.id]) {
            const bands = indicatorSeries[ind.id];
            if (bands.upper?.length && bands.middle?.length && bands.lower?.length) {
              const upperSeries = chart.addSeries(LineSeries, {
                color: ind.upper || ind.color,
                lineWidth: 1,
                priceLineVisible: false,
                lastValueVisible: false,
                title: `${ind.label} Upper`
              });
              upperSeries.setData(toLineData(bands.upper));

              const middleSeries = chart.addSeries(LineSeries, {
                color: ind.middle || ind.color,
                lineWidth: 1,
                lineStyle: 2,
                priceLineVisible: false,
                lastValueVisible: false,
                title: `${ind.label} Mid`
              });
              middleSeries.setData(toLineData(bands.middle));

              const lowerSeries = chart.addSeries(LineSeries, {
                color: ind.lower || ind.color,
                lineWidth: 1,
                priceLineVisible: false,
                lastValueVisible: false,
                title: `${ind.label} Lower`
              });
              lowerSeries.setData(toLineData(bands.lower));
            }
          }
        });

        // Render selected Strategy Studies (Bands, Next Flip Line, Flip Markers)
        const allStrategyMarkers = [];

        STRATEGY_STUDIES_CONFIG.forEach((strat) => {
          if (!selectedStrategies?.[strat.id]) return;

          const overlay = strategyOverlays?.[strat.id];
          if (!overlay) return;

          // 1. Trailing Stop Band Line Series (e.g. Supertrend band)
          if (overlay.series?.length) {
            const lineSeries = chart.addSeries(LineSeries, {
              color: strat.color,
              lineWidth: 2,
              priceLineVisible: false,
              lastValueVisible: true,
              title: `${strat.label} Band`
            });
            lineSeries.setData(toLineData(overlay.series));
          }

          // 2. Next Flip Horizontal Price Line (dashed threshold with price badge)
          if (overlay.next_flip_line?.price) {
            const flipPrice = Number(overlay.next_flip_line.price);
            if (Number.isFinite(flipPrice)) {
              candleSeries.createPriceLine({
                price: flipPrice,
                color: overlay.next_flip_line.color || "#e25757",
                lineWidth: overlay.next_flip_line.lineWidth || 2,
                lineStyle: LineStyle.Dashed,
                axisLabelVisible: true,
                title: overlay.next_flip_line.title || `Next Flip ($${flipPrice.toFixed(2)})`
              });
            }
          }

          // 3. Historical Previous Flip / Trigger Markers
          if (overlay.markers?.length) {
            overlay.markers.forEach((m) => {
              allStrategyMarkers.push({
                time: m.time,
                position: m.position || "belowBar",
                color: m.color || strat.color,
                shape: m.shape || "arrowUp",
                text: m.text || "",
                size: 1
              });
            });
          }
        });

        if (tradeMarkers?.length) {
          tradeMarkers.forEach((tm) => {
            const isBuy = tm.action === "BUY" || tm.shape === "arrowUp" || String(tm.text || "").toUpperCase().startsWith("BUY");
            allStrategyMarkers.push({
              time: tm.time,
              position: tm.position || (isBuy ? "belowBar" : "aboveBar"),
              color: tm.color || (isBuy ? "#10b981" : "#ef4444"),
              shape: tm.shape || (isBuy ? "arrowUp" : "arrowDown"),
              text: tm.text || (isBuy ? "▲ BUY" : "▼ EXIT"),
              size: tm.size || 2
            });
          });
        }

        if (fundamentalMarkers?.length && !isLineOnly) {
          fundamentalMarkers.forEach((fm) => {
            allStrategyMarkers.push({
              time: fm.time,
              position: fm.position,
              color: fm.color,
              shape: fm.shape,
              text: fm.text,
              size: fm.size || 1
            });
          });
        }

        if (allStrategyMarkers.length > 0) {
          allStrategyMarkers.sort((a, b) => String(a.time).localeCompare(String(b.time)));
          createSeriesMarkers(candleSeries, allStrategyMarkers, { autoScale: false });
        }

        if (fundamentalMarkers?.length && typeof chart.subscribeCrosshairMove === "function") {
          chart.subscribeCrosshairMove((param) => {
            if (!param || !param.time) {
              setHoveredMarkers([]);
              return;
            }
            const tStr = String(param.time);
            const matched = fundamentalMarkers.filter((m) => String(m.time) === tStr);
            setHoveredMarkers(matched);
          });
        }

        const initialRange = visibleLogicalRange || getDefaultVisibleRange(pricesRef.current, chartMode);
        chart.timeScale().setVisibleLogicalRange(initialRange);
        onVisibleLogicalRangeChange?.(initialRange);

        handleVisibleRangeChange = (range) => {
          bumpOverlay();
          if (!range || isApplyingRangeRef.current) return;
          onVisibleLogicalRangeChange?.(range);
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

        resizeObserver = new ResizeObserver(() => {
          if (containerRef.current && chart) {
            chart.applyOptions({
              width: containerRef.current.clientWidth,
              height: containerRef.current.clientHeight || height
            });
            bumpOverlay();
          }
        });
        resizeObserver.observe(containerRef.current);
      } catch (error) {
        logger.error("Fowa chart failed to render", error);
        if (active) setErrorMessage(error instanceof Error ? error.message : String(error));
      }
    }

    mountChart();

    return () => {
      active = false;
      if (resizeObserver) resizeObserver.disconnect();
      if (chart) {
        if (handleVisibleRangeChange) {
          chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleRangeChange);
        }
        chart.remove();
      }
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, [chartMode, hasPrices, indicatorSeries, onVisibleLogicalRangeChange, selectedIndicators, selectedStrategies, strategyOverlays, tradeMarkers, fundamentalMarkers.length, symbol]);

  const overlay = getMeasureOverlay(
    measure,
    chartRef.current,
    candleSeriesRef.current,
    prices,
    containerRef.current?.clientHeight || height,
    overlayVersion
  );

  return (
    <div
      ref={cardRef}
      className={`pw-tv-chart-card ${isFocused ? "pw-chart-focused" : ""}`}
      onPointerDown={onFocus}
      tabIndex={-1}
    >
      {errorMessage && <div className="pw-tv-chart-meta">Fallback active</div>}
      {errorMessage ? (
        fallback
      ) : (
        <div
          className={`pw-tv-chart-pane${measureEnabled ? " pw-measure-active" : ""}`}
          ref={containerRef}
          style={{ minHeight: height }}
        >
          {!hasPrices && (
            <div className="pw-chart-empty" style={{ border: 0, minHeight: height }}>
              {isLoading ? "Loading price history..." : `No stored price history for ${symbol} yet.`}
            </div>
          )}
          {hoveredMarkers.length > 0 && (
            <div className="pw-chart-fundamental-tooltip" data-testid="chart-fundamental-tooltip">
              {hoveredMarkers.map((hm, idx) => (
                <div key={`${hm.eventType}-${hm.time}-${idx}`} className="pw-chart-fundamental-tooltip-item">
                  <span className="pw-chart-marker-pill" style={{ backgroundColor: hm.color }}>
                    {hm.text}
                  </span>
                  <span>{hm.tooltip}</span>
                </div>
              ))}
            </div>
          )}
          {fundamentalMarkers.length > 0 && (
            <div
              className="pw-chart-event-markers-meta"
              data-testid="chart-event-markers"
              style={{ display: "none" }}
              aria-hidden="true"
            >
              {fundamentalMarkers.map((m, idx) => (
                <span
                  key={`${m.eventType}-${m.time}-${idx}`}
                  data-testid="chart-event-marker"
                  data-event-type={m.eventType}
                  data-time={m.time}
                  data-position={m.position}
                  data-shape={m.shape}
                  data-color={m.color}
                  title={m.tooltip}
                >
                  [{m.text}] {m.tooltip}
                </span>
              ))}
            </div>
          )}
          {upcomingCatalysts.length > 0 && (
            <div
              className="pw-chart-upcoming-catalysts-layer"
              data-testid="chart-upcoming-catalysts"
            >
              {upcomingCatalysts.map((item, idx) => {
                const posStyle = getUpcomingCatalystPositionStyle(
                  item,
                  idx,
                  chartRef.current,
                  prices,
                  overlayVersion
                );
                if (!posStyle) return null;
                return (
                  <div
                    key={`upcoming-${item.eventType}-${item.date}`}
                    className={`pw-chart-upcoming-catalyst pw-upcoming-${item.eventType}`}
                    data-testid={`chart-upcoming-${item.eventType}`}
                    data-date={item.date}
                    style={posStyle}
                    title={item.tooltip}
                    onMouseEnter={() => setHoveredMarkers([item])}
                    onMouseLeave={() => setHoveredMarkers([])}
                  >
                    <span className="pw-chart-upcoming-icon">{item.text}</span>
                    <span className="pw-chart-upcoming-date">{item.mmdd}</span>
                  </div>
                );
              })}
            </div>
          )}
          {hasPrices && (
            <div
              className="pw-chart-measure-layer"
              onPointerDown={handleMeasurePointerDown}
              onPointerMove={handleMeasurePointerMove}
              onPointerUp={finishMeasure}
              onPointerCancel={finishMeasure}
            >
              {overlay && (
                <div className={`pw-chart-measure pw-${overlay.direction}`}>
                  <div className="pw-chart-measure-box" style={overlay.boxStyle} />
                  <div className="pw-chart-measure-guide pw-vertical pw-start" style={overlay.startXStyle} />
                  <div className="pw-chart-measure-guide pw-vertical pw-end" style={overlay.endXStyle} />
                  <div className="pw-chart-measure-guide pw-horizontal pw-start" style={overlay.startYStyle} />
                  <div className="pw-chart-measure-guide pw-horizontal pw-end" style={overlay.endYStyle} />
                  <div className="pw-chart-measure-label" style={overlay.labelStyle}>
                    <strong>{overlay.label.primary}</strong>
                    <span>{overlay.label.secondary}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
