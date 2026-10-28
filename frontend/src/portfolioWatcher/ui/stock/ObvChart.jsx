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

export default function ObvChart({
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
    series?.obv?.length
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
        const { LineSeries, createChart } = await import("lightweight-charts");
        if (!active || !containerRef.current) return;

        chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          height: 125,
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
            scaleMargins: { top: 0.12, bottom: 0.12 }
          },
          timeScale: {
            borderColor: "rgba(18, 28, 48, 0.12)"
          }
        });
        chartRef.current = chart;

        const obvConfig = INDICATOR_COLORS.obv || {};

        const obvLine = chart.addSeries(LineSeries, {
          color: obvConfig.obvColor || "#8b5cf6",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "OBV"
        });
        obvLine.setData(toAlignedLineData(prices, series.obv));

        if (series?.sma20?.length) {
          const smaLine = chart.addSeries(LineSeries, {
            color: obvConfig.smaColor || "#f59e0b",
            lineWidth: 1.5,
            priceLineVisible: false,
            lastValueVisible: true,
            title: "20-SMA"
          });
          smaLine.setData(toAlignedLineData(prices, series.sma20));
        }

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
        logger.error("OBV chart failed to render", error);
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
            <strong>On-Balance Volume (OBV)</strong>
          </div>
        </div>
        <div className="pw-chart-empty" style={{ minHeight: 125, border: 0, background: "transparent" }}>
          {isLoading ? "Loading On-Balance Volume (OBV)..." : "Not enough historical data for OBV."}
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
          <strong>On-Balance Volume (OBV)</strong>
          <span style={{ fontSize: "11px", color: "var(--pw-muted)" }}>
            <span style={{ color: INDICATOR_COLORS.obv?.obvColor || "#8b5cf6", fontWeight: 600 }}>● OBV</span>{" "}
            <span style={{ color: INDICATOR_COLORS.obv?.smaColor || "#f59e0b", fontWeight: 600, marginLeft: 6 }}>● 20-SMA</span>
          </span>
        </div>
        {errorMessage && <span>Panel unavailable</span>}
      </div>
      {errorMessage ? (
        <div className="pw-chart-empty">OBV panel could not be rendered.</div>
      ) : (
        <div className="pw-rsi-chart-pane" ref={containerRef} />
      )}
    </div>
  );
}
