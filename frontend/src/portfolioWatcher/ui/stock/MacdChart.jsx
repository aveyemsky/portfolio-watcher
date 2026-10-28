import { useEffect, useRef, useState } from "react";

import { logger } from "../../core/logger";
import { getDefaultVisibleRange } from "./chartRange";
import { INDICATOR_COLORS } from "./indicatorColors";

function toAlignedLineData(prices, points) {
  const map = new Map((points || []).map((point) => [point.date, Number(point.value)]));
  return (prices || []).map((price) => {
    if (!map.has(price.date)) return { time: price.date };
    return {
      time: price.date,
      value: map.get(price.date)
    };
  });
}

function toAlignedHistData(prices, points) {
  const map = new Map((points || []).map((point) => [point.date, Number(point.value)]));
  return (prices || []).map((price) => {
    if (!map.has(price.date)) return { time: price.date };
    const val = map.get(price.date);
    return {
      time: price.date,
      value: val,
      color: val >= 0 ? "#16a06b" : "#e25757"
    };
  });
}

export default function MacdChart({
  chartMode = "3y",
  prices,
  series,
  visibleLogicalRange,
  onVisibleLogicalRangeChange,
  cardRef,
  isFocused = false,
  onFocus,
  isLoading = false
}) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const isApplyingRangeRef = useRef(false);
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const [errorMessage, setErrorMessage] = useState("");

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
    if (!chartRef.current || !visibleLogicalRange) return;

    isApplyingRangeRef.current = true;
    chartRef.current.timeScale().setVisibleLogicalRange(visibleLogicalRange);
    window.requestAnimationFrame(() => {
      isApplyingRangeRef.current = false;
    });
  }, [visibleLogicalRange]);

  const hasData = Boolean(
    prices?.length &&
    series?.macd?.length &&
    series?.signal?.length &&
    series?.histogram?.length
  );

  useEffect(() => {
    if (!containerRef.current || !hasData) return undefined;

    let chart;
    let handleVisibleRangeChange;
    let resizeObserver;
    let active = true;

    async function mountChart() {
      try {
        setErrorMessage("");
        const { HistogramSeries, LineSeries, createChart } = await import("lightweight-charts");
        if (!active || !containerRef.current) return;

        chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: 135,
          handleScroll: {
            mouseWheel: Boolean(isFocusedRef.current)
          },
          handleScale: {
            mouseWheel: Boolean(isFocusedRef.current)
          },
          layout: {
            background: { color: "#ffffff" },
            textColor: "#162033",
            fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
          },
          grid: {
            vertLines: { color: "rgba(18, 28, 48, 0.05)" },
            horzLines: { color: "rgba(18, 28, 48, 0.06)" }
          },
          rightPriceScale: {
            borderColor: "rgba(18, 28, 48, 0.12)",
            scaleMargins: { top: 0.15, bottom: 0.15 }
          },
          timeScale: {
            borderColor: "rgba(18, 28, 48, 0.12)"
          }
        });
        chartRef.current = chart;

        const histSeries = chart.addSeries(HistogramSeries, {
          priceLineVisible: false,
          lastValueVisible: false,
          title: "Hist"
        });
        histSeries.setData(toAlignedHistData(prices, series.histogram));

        const macdConfig = INDICATOR_COLORS.macd || {};
        const macdLine = chart.addSeries(LineSeries, {
          color: macdConfig.macdColor || "#2563eb",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "MACD"
        });
        macdLine.setData(toAlignedLineData(prices, series.macd));

        const signalLine = chart.addSeries(LineSeries, {
          color: macdConfig.signalColor || "#ea580c",
          lineWidth: 1.5,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "Signal"
        });
        signalLine.setData(toAlignedLineData(prices, series.signal));

        macdLine.createPriceLine({
          price: 0,
          color: "rgba(116, 131, 154, 0.35)",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "0"
        });

        const initialRange = visibleLogicalRange || getDefaultVisibleRange(prices, chartMode);
        chart.timeScale().setVisibleLogicalRange(initialRange);
        onVisibleLogicalRangeChange?.(initialRange);

        handleVisibleRangeChange = (range) => {
          if (!range || isApplyingRangeRef.current) return;
          onVisibleLogicalRangeChange?.(range);
        };
        chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleRangeChange);

        resizeObserver = new ResizeObserver(() => {
          if (containerRef.current && chart) {
            chart.applyOptions({ width: containerRef.current.clientWidth });
          }
        });
        resizeObserver.observe(containerRef.current);
      } catch (error) {
        logger.error("MACD chart failed to render", error);
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
    };
  }, [hasData, onVisibleLogicalRangeChange, prices, series]);

  if (!hasData) {
    return (
      <div
        ref={cardRef}
        className={`pw-rsi-panel pw-oscillator-panel ${isFocused ? "pw-chart-focused" : ""}`}
        onPointerDown={onFocus}
        tabIndex={-1}
      >
        <div className="pw-rsi-head pw-oscillator-head">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <strong>MACD (12, 26, 9)</strong>
          </div>
        </div>
        <div className="pw-chart-empty" style={{ minHeight: 140, border: 0, background: "transparent" }}>
          {isLoading ? "Loading MACD (12, 26, 9)..." : "Not enough historical data for MACD (12, 26, 9)."}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={cardRef}
      className={`pw-rsi-panel pw-oscillator-panel ${isFocused ? "pw-chart-focused" : ""}`}
      onPointerDown={onFocus}
      tabIndex={-1}
    >
      <div className="pw-rsi-head pw-oscillator-head">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <strong>MACD (12, 26, 9)</strong>
          <span style={{ fontSize: "11px", color: "var(--pw-muted)" }}>
            <span style={{ color: INDICATOR_COLORS.macd?.macdColor || "#2563eb", fontWeight: 600 }}>● MACD</span>{" "}
            <span style={{ color: INDICATOR_COLORS.macd?.signalColor || "#ea580c", fontWeight: 600, marginLeft: 6 }}>● Signal</span>{" "}
            <span style={{ color: "#16a06b", fontWeight: 600, marginLeft: 6 }}>■ Hist</span>
          </span>
        </div>
        {errorMessage && <span>Panel unavailable</span>}
      </div>
      {errorMessage ? (
        <div className="pw-chart-empty">MACD panel could not be rendered.</div>
      ) : (
        <div className="pw-rsi-chart-pane" ref={containerRef} />
      )}
    </div>
  );
}
