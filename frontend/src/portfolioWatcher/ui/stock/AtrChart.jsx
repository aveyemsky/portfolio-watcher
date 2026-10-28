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

export default function AtrChart({
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
    series?.length
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

        const atrConfig = INDICATOR_COLORS.atr14 || {};

        const atrLine = chart.addSeries(LineSeries, {
          color: atrConfig.color || "#ec4899",
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: true,
          title: "ATR"
        });
        atrLine.setData(toAlignedLineData(prices, series));

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
        logger.error("ATR chart failed to render", error);
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
            <strong>ATR-14</strong>
          </div>
        </div>
        <div className="pw-chart-empty" style={{ minHeight: 125, border: 0, background: "transparent" }}>
          {isLoading ? "Loading ATR-14..." : "Not enough historical data for ATR-14."}
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
          <strong>ATR-14 (Average True Range)</strong>
          <span style={{ fontSize: "11px", color: "var(--pw-muted)" }}>
            <span style={{ color: INDICATOR_COLORS.atr14?.color || "#ec4899", fontWeight: 600 }}>● Volatility</span>
          </span>
        </div>
        {errorMessage && <span>Panel unavailable</span>}
      </div>
      {errorMessage ? (
        <div className="pw-chart-empty">ATR-14 panel could not be rendered.</div>
      ) : (
        <div className="pw-rsi-chart-pane" ref={containerRef} />
      )}
    </div>
  );
}
