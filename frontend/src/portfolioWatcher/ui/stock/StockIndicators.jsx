import { useEffect, useState } from "react";

import { fetchStockAnalysis, fetchStockIndicators } from "../../api/portfolioApi";
import { logger } from "../../core/logger";
import MetricCard from "../shared/MetricCard";
import { getSelectedStock } from "../viewModel";

const ORDERED_INDICATOR_KEYS = ["ema20", "ma50", "ma200", "bb20", "atr14", "rsi14", "stoch14", "macd", "obv"];

export default function StockIndicators({ apiBaseUrl, data, state, enableQuantAlpha = false }) {
  const stock = getSelectedStock(data, state);
  const [analysis, setAnalysis] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setAnalysis(null);
    setIsLoading(true);

    async function loadAnalysis() {
      if (!stock?.symbol) {
        if (isMounted) setIsLoading(false);
        return;
      }
      try {
        let payload = null;
        if (enableQuantAlpha) {
          try {
            payload = await fetchStockAnalysis(apiBaseUrl, stock.symbol);
          } catch (analysisErr) {
            payload = await fetchStockIndicators(apiBaseUrl, stock.symbol);
          }
        } else {
          payload = await fetchStockIndicators(apiBaseUrl, stock.symbol);
        }
        if (isMounted) {
          setAnalysis(payload);
          setIsLoading(false);
        }
      } catch (error) {
        logger.error("Failed to load stock indicators", error);
        if (isMounted) {
          setAnalysis({
            summary: "Technical indicators are unavailable right now.",
            indicators: {},
            signals: [],
            notEnoughData: true,
          });
          setIsLoading(false);
        }
      }
    }

    loadAnalysis();
    return () => {
      isMounted = false;
    };
  }, [apiBaseUrl, stock?.symbol, enableQuantAlpha]);

  if (isLoading || !analysis) {
    return (
      <div className="pw-analysis-container">
        <div className="pw-inline-info">Loading technical indicators for {stock?.symbol || "stock"}...</div>
      </div>
    );
  }

  const indicators = analysis?.indicators || {};
  const cards = ORDERED_INDICATOR_KEYS.map((k) => indicators[k]).filter(Boolean);
  Object.keys(indicators).forEach((k) => {
    if (!ORDERED_INDICATOR_KEYS.includes(k) && indicators[k]) {
      cards.push(indicators[k]);
    }
  });

  const hasCards = cards.length > 0;
  const allMissing = hasCards && cards.every((indicator) => indicator.status === "not_enough_data");

  return (
    <div className="pw-analysis-container">
      {/* 1. Classic Indicators Grid */}
      <div className="pw-analysis-section-head">
        <strong>Classic Indicators &amp; Levels</strong>
        {analysis?.asOfDate && <span>Daily close · {analysis.asOfDate}</span>}
      </div>

      {hasCards ? (
        <div className="pw-grid-3">
          {cards.map((indicator) => {
            const info = getIndicatorInfo(indicator);
            return (
              <MetricCard
                key={indicator.label || indicator.id}
                label={indicator.label || indicator.id}
                value={formatIndicatorValue(indicator)}
                subValue={formatIndicatorSubValue(indicator)}
                tone={indicatorTone(indicator)}
                tooltip={info.description}
              />
            );
          })}
        </div>
      ) : (
        <div className="pw-inline-info">
          {analysis?.summary || "Technical indicators are currently unavailable for this stock."}
        </div>
      )}

      {allMissing && (
        <div className="pw-inline-info">Not enough historical price data to calculate indicators.</div>
      )}

      {hasCards && (
        <>
          <div className="pw-spacer" />

          {/* 2. Technical Snapshot & Methodology */}
          <div className="pw-analysis-section-head">
            <strong>Technical Snapshot &amp; Methodology</strong>
          </div>

          <div className="pw-indicators-breakdown">
            {cards.map((indicator) => {
              const info = getIndicatorInfo(indicator);
              const status = statusLabel(indicator);
              const valStr = formatIndicatorValue(indicator);
              const subValStr = formatIndicatorSubValue(indicator);
              const tone = indicatorTone(indicator);
              const readingText = getIndicatorReadingDetails(indicator, stock, valStr, status);

              return (
                <div key={indicator.label || indicator.id} className="pw-indicator-detail-card">
                  <div className="pw-indicator-detail-header">
                    <div className="pw-indicator-detail-title-group">
                      <span className="pw-indicator-detail-title">{indicator.label || indicator.id}</span>
                      <span className="pw-indicator-detail-fullname">· {info.fullName}</span>
                    </div>
                    <div className="pw-indicator-detail-badge-group">
                      <span className="pw-indicator-val-badge">{valStr}</span>
                      {subValStr && <span className="pw-indicator-sub-badge">{subValStr}</span>}
                      <span className={`pw-indicator-status-pill ${tone ? `pw-${tone}` : ""}`}>
                        {status}
                      </span>
                    </div>
                  </div>

                  {/* Blue callout matching Quant Alpha's HOW THIS STRATEGY WORKS */}
                  <div className="pw-indicator-how-it-works">
                    <div className="pw-how-it-works-title">
                      <span aria-hidden="true">ⓘ</span> HOW THIS INDICATOR WORKS
                    </div>
                    <p className="pw-how-it-works-desc">{info.description}</p>
                  </div>

                  <div className="pw-indicator-reading-row">
                    <span className="pw-reading-label">Current Reading:</span>
                    <span className="pw-reading-text">{readingText}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* 3. Key Signals & Observations */}
      {analysis?.signals && analysis.signals.length > 0 && (
        <>
          <div className="pw-spacer" />
          <div className="pw-analysis-note">
            <strong>Key Signals &amp; Observations</strong>
            <ul>
              {analysis.signals.map((sig, idx) => (
                <li key={idx}>
                  <strong>{sig.indicator}:</strong> {sig.message}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}

export const INDICATOR_INFO = {
  ema20: {
    fullName: "20-Day Exponential Moving Average",
    category: "Short-Term Trend Guide",
    description: "EMA-20 tracks short-term momentum by weighting recent trading sessions more heavily than past ones. In a healthy uptrend, price consistently holds above the rising 20-day EMA, which serves as dynamic support for shallow pullbacks.",
  },
  ma50: {
    fullName: "50-Day Simple Moving Average",
    category: "Intermediate Trend Baseline",
    description: "MA-50 is the benchmark intermediate-term trend filter watched by institutional portfolio managers. It smooths out 10 weeks of price action; sustaining above MA-50 validates cyclical uptrend health, whereas a breakdown flags institutional distribution.",
  },
  ma200: {
    fullName: "200-Day Simple Moving Average",
    category: "Secular Bull/Bear Regime Filter",
    description: "MA-200 defines the primary long-term secular trend regime. Stocks trading above their rising 200-day moving average are in structural bull markets, whereas sustained trading below MA-200 warns of prolonged bear market drawdowns.",
  },
  bb20: {
    fullName: "Bollinger Bands (20-Period, 2.0 Std Dev)",
    category: "Volatility & Mean-Reversion Envelope",
    description: "Bollinger Bands construct volatility bands 2 standard deviations above and below a 20-day moving average. Band squeezes anticipate volatility expansions, while price tagging the outer bands highlights statistically stretched, overbought or oversold extremes.",
  },
  atr14: {
    fullName: "14-Day Average True Range",
    category: "Volatility & Risk Range",
    description: "ATR-14 quantifies absolute price volatility by smoothing the greatest of the daily range, high-to-prior-close, and low-to-prior-close. It provides an objective gauge for stop-loss sizing and trailing volatility stops without directional bias.",
  },
  rsi14: {
    fullName: "14-Day Relative Strength Index",
    category: "Momentum & Exhaustion Oscillator",
    description: "RSI-14 evaluates the velocity and magnitude of directional price movements on a 0 to 100 scale. Readings above 70 reflect overbought conditions prone to pullbacks, while readings below 30 indicate oversold washouts offering asymmetric rebound potential.",
  },
  stoch14: {
    fullName: "Stochastic Oscillator (14, 3, 3)",
    category: "Cyclical Turning Points & Mean-Reversion",
    description: "Stochastic measures the location of the close relative to the high-low range over 14 sessions. Readings above 80 signal overbought momentum, while readings below 20 indicate oversold territory prone to rapid mean-reverting swing rallies.",
  },
  macd: {
    fullName: "Moving Average Convergence Divergence (12, 26, 9)",
    category: "Trend Acceleration & Momentum Oscillator",
    description: "MACD tracks trend acceleration by measuring the spread between 12-day and 26-day EMAs against a 9-day signal line. Bullish signal line crossovers and positive histogram expansions confirm directional acceleration and momentum surges.",
  },
  obv: {
    fullName: "On-Balance Volume (OBV)",
    category: "Volume Flow & Institutional Accumulation",
    description: "OBV tracks cumulative buying and selling volume pressure by adding volume on up days and subtracting it on down days. When OBV trends above its 20-day moving average, it confirms institutional accumulation powering the prevailing trend.",
  },
};

export function getIndicatorInfo(indicator) {
  const id = indicator?.id?.toLowerCase() || "";
  const label = indicator?.label?.toLowerCase() || "";
  if (id.includes("ema20") || label.includes("ema-20") || label.includes("ema 20")) return INDICATOR_INFO.ema20;
  if (id.includes("ma50") || label.includes("ma-50") || label.includes("ma 50")) return INDICATOR_INFO.ma50;
  if (id.includes("ma200") || label.includes("ma-200") || label.includes("ma 200")) return INDICATOR_INFO.ma200;
  if (id.includes("bb20") || label.includes("bollinger") || id.includes("bollinger")) return INDICATOR_INFO.bb20;
  if (id.includes("atr") || label.includes("atr")) return INDICATOR_INFO.atr14;
  if (id.includes("rsi") || label.includes("rsi")) return INDICATOR_INFO.rsi14;
  if (id.includes("stoch") || label.includes("stoch")) return INDICATOR_INFO.stoch14;
  if (id.includes("macd") || label.includes("macd")) return INDICATOR_INFO.macd;
  if (id.includes("obv") || label.includes("obv") || label.includes("on-balance")) return INDICATOR_INFO.obv;
  return {
    fullName: indicator?.label || indicator?.id || "Technical Indicator",
    category: "Technical Indicator",
    description: "Statistical technical indicator measuring price action, trend momentum, or market volatility to assist risk management and entry/exit timing.",
  };
}

function formatVolumeNumber(num) {
  if (num == null) return "-";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}k`;
  return `${sign}${abs}`;
}

function getIndicatorReadingDetails(indicator, stock, valStr, status) {
  const currentPrice = stock?.lastPrice || stock?.close;
  const priceStr = currentPrice ? `$${Number(currentPrice).toFixed(2)}` : null;
  const label = indicator?.label || indicator?.id;

  if (indicator.status === "not_enough_data") {
    return "Insufficient historical price bars to generate a reliable signal.";
  }

  if (indicator.id === "ema20" || label?.startsWith("EMA-20")) {
    return priceStr
      ? `Price (${priceStr}) is trading ${indicator.status === "price_above_ema" ? "above" : "below"} the 20-day EMA (${valStr}). ${indicator.status === "price_above_ema" ? "Short-term momentum remains bullish." : "Short-term corrective pressure is active."}`
      : `${status} at ${valStr}.`;
  }

  if (indicator.id === "ma50" || label?.startsWith("MA-50")) {
    return priceStr
      ? `Price (${priceStr}) is trading ${indicator.status === "price_above_ma" ? "above" : "below"} the 50-day moving average (${valStr}). ${indicator.status === "price_above_ma" ? "Intermediate-term trend is supported." : "Trading below intermediate baseline."}`
      : `${status} at ${valStr}.`;
  }

  if (indicator.id === "ma200" || label?.startsWith("MA-200")) {
    return priceStr
      ? `Price (${priceStr}) is trading ${indicator.status === "price_above_ma" ? "above" : "below"} the secular 200-day moving average (${valStr}). ${indicator.status === "price_above_ma" ? "Long-term secular uptrend is intact." : "Warning: secular bear regime active."}`
      : `${status} at ${valStr}.`;
  }

  if (indicator.type === "overlay_bands" || label?.includes("Bollinger")) {
    const sub = formatIndicatorSubValue(indicator);
    return `Middle baseline is ${valStr}. ${sub || ""} — ${status}.`;
  }

  if (indicator.id === "atr14" || label?.startsWith("ATR")) {
    const sub = formatIndicatorSubValue(indicator);
    return `Daily ATR is ${valStr} (${sub || ""}). Represents typical daily trading amplitude; volatility regime is ${status}.`;
  }

  if (indicator.id === "rsi14" || label?.startsWith("RSI")) {
    return `RSI-14 is currently reading ${valStr}. ${indicator.value >= 70 ? "Overbought territory (potential exhaustion pullback risk)." : indicator.value <= 30 ? "Oversold territory (potential mean-reversion rebound candidate)." : "Trading in neutral equilibrium range (30–70)."}`;
  }

  if (indicator.id === "stoch14" || label?.toLowerCase().includes("stoch")) {
    const sub = formatIndicatorSubValue(indicator);
    return `Slow %K is at ${valStr} (${sub || ""}). Posture is currently ${status}.`;
  }

  if (indicator.id === "macd" || label?.startsWith("MACD")) {
    const sub = formatIndicatorSubValue(indicator);
    return `MACD line is at ${valStr} (${sub || ""}). Posture is currently ${status}.`;
  }

  if (indicator.id === "obv" || label?.toLowerCase().includes("obv")) {
    const sub = formatIndicatorSubValue(indicator);
    return `Cumulative OBV is ${valStr} (${sub || ""}). Volume pressure shows ${status}.`;
  }

  return `${status} (Current value: ${valStr}).`;
}

function formatIndicatorValue(indicator) {
  if (!indicator || indicator.status === "not_enough_data" || indicator.value == null) return "-";
  if (indicator.type === "overlay_bands" && typeof indicator.value === "object") {
    return indicator.value.middle != null ? `$${indicator.value.middle.toFixed(2)}` : "-";
  }
  if ((indicator.id === "macd" || indicator.label?.startsWith("MACD")) && typeof indicator.value === "object") {
    return indicator.value.macd != null ? indicator.value.macd.toFixed(2) : "-";
  }
  if ((indicator.id === "atr14" || indicator.label?.startsWith("ATR")) && typeof indicator.value === "object") {
    return indicator.value.atr != null ? `$${indicator.value.atr.toFixed(2)}` : "-";
  }
  if ((indicator.id === "stoch14" || indicator.label?.toLowerCase().includes("stoch")) && typeof indicator.value === "object") {
    return indicator.value.k != null ? `${indicator.value.k.toFixed(1)}` : "-";
  }
  if ((indicator.id === "obv" || indicator.label?.toLowerCase().includes("obv")) && typeof indicator.value === "object") {
    return indicator.value.obv != null ? formatVolumeNumber(indicator.value.obv) : "-";
  }
  if (typeof indicator.value === "number") {
    return indicator.label?.startsWith("RSI") ? indicator.value.toFixed(1) : `$${indicator.value.toFixed(2)}`;
  }
  return String(indicator.value);
}

function formatIndicatorSubValue(indicator) {
  if (!indicator || indicator.status === "not_enough_data" || indicator.value == null) return undefined;
  if (indicator.type === "overlay_bands" && typeof indicator.value === "object") {
    const { upper, lower } = indicator.value;
    if (upper != null && lower != null) {
      return `Bands: $${lower.toFixed(2)} – $${upper.toFixed(2)}`;
    }
  }
  if ((indicator.id === "macd" || indicator.label?.startsWith("MACD")) && typeof indicator.value === "object") {
    const { signal, histogram } = indicator.value;
    if (signal != null && histogram != null) {
      const sign = histogram > 0 ? "+" : "";
      return `Sig: ${signal.toFixed(2)} · Hist: ${sign}${histogram.toFixed(2)}`;
    }
  }
  if ((indicator.id === "atr14" || indicator.label?.startsWith("ATR")) && typeof indicator.value === "object") {
    return indicator.value.atrPct != null ? `±${indicator.value.atrPct.toFixed(1)}% / day` : undefined;
  }
  if ((indicator.id === "stoch14" || indicator.label?.toLowerCase().includes("stoch")) && typeof indicator.value === "object") {
    return indicator.value.d != null ? `%D Signal: ${indicator.value.d.toFixed(1)}` : undefined;
  }
  if ((indicator.id === "obv" || indicator.label?.toLowerCase().includes("obv")) && typeof indicator.value === "object") {
    return indicator.value.sma20 != null ? `20D SMA: ${formatVolumeNumber(indicator.value.sma20)}` : undefined;
  }
  if (indicator.label?.startsWith("RSI") && typeof indicator.value === "number") {
    if (indicator.value >= 70) return "Overbought (≥ 70)";
    if (indicator.value <= 30) return "Oversold (≤ 30)";
    return "Neutral Zone (30 - 70)";
  }
  return undefined;
}

function statusLabel(indicator) {
  if (!indicator) return "Not enough data";
  const label = indicator.label || indicator.id || "Indicator";
  const labels = {
    price_above_ema: `Price above ${label}`,
    price_below_ema: `Price below ${label}`,
    price_above_ma: `Price above ${label}`,
    price_below_ma: `Price below ${label}`,
    price_above_upper: `Above upper band (Breakout / Overbought)`,
    price_below_lower: `Below lower band (Oversold)`,
    inside_bands: `Trading inside bands`,
    bullish_crossover: `Bullish crossover`,
    bearish_crossover: `Bearish crossover`,
    bullish: `Bullish momentum`,
    bearish: `Bearish momentum`,
    overbought: "Overbought",
    oversold: "Oversold",
    neutral: "Neutral",
    high_volatility: "High Volatility (ATR ≥ 4%)",
    low_volatility: "Low Volatility (ATR ≤ 1.5%)",
    normal_volatility: "Normal Volatility",
    accumulation: "Accumulation (Above 20D SMA)",
    distribution: "Distribution (Below 20D SMA)",
    not_enough_data: "Not enough data",
  };
  return labels[indicator.status] || indicator.status || "Normal";
}

function indicatorTone(indicator) {
  if (!indicator || indicator.status === "not_enough_data") return undefined;
  const upStatuses = [
    "price_above_ema",
    "price_above_ma",
    "bullish_crossover",
    "bullish",
    "inside_bands",
    "neutral",
    "normal_volatility",
    "accumulation",
  ];
  const downStatuses = [
    "price_below_ema",
    "price_below_ma",
    "bearish_crossover",
    "bearish",
    "overbought",
    "oversold",
    "high_volatility",
    "distribution",
  ];
  if (upStatuses.includes(indicator.status)) return "up";
  if (downStatuses.includes(indicator.status)) return "down";
  return undefined;
}
