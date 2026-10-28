export const INDICATORS_CONFIG = [
  {
    id: "ema20",
    label: "EMA20",
    fullLabel: "EMA-20",
    type: "overlay",
    color: "#0284c7",
    soft: "rgba(2, 132, 199, 0.10)"
  },
  {
    id: "ma50",
    label: "MA50",
    fullLabel: "MA-50",
    type: "overlay",
    color: "#3157ff",
    soft: "rgba(49, 87, 255, 0.10)"
  },
  {
    id: "ma200",
    label: "MA200",
    fullLabel: "MA-200",
    type: "overlay",
    color: "#835cf5",
    soft: "rgba(131, 92, 245, 0.10)"
  },
  {
    id: "bb20",
    label: "BB20",
    fullLabel: "Bollinger Bands (20, 2)",
    type: "overlay_bands",
    color: "#6366f1",
    soft: "rgba(99, 102, 241, 0.12)",
    upper: "rgba(99, 102, 241, 0.75)",
    middle: "rgba(99, 102, 241, 0.45)",
    lower: "rgba(99, 102, 241, 0.75)"
  },
  {
    id: "atr14",
    label: "ATR14",
    fullLabel: "ATR-14 (Average True Range)",
    type: "oscillator",
    color: "#ec4899",
    soft: "rgba(236, 72, 153, 0.12)"
  },
  {
    id: "rsi14",
    label: "RSI14",
    fullLabel: "RSI-14",
    type: "oscillator",
    color: "#c38a1f",
    soft: "rgba(195, 138, 31, 0.12)"
  },
  {
    id: "stoch14",
    label: "STOCH",
    fullLabel: "Stochastic (14, 3, 3)",
    type: "oscillator",
    color: "#0ea5e9",
    kColor: "#0284c7",
    dColor: "#ea580c",
    soft: "rgba(14, 165, 233, 0.12)"
  },
  {
    id: "macd",
    label: "MACD",
    fullLabel: "MACD (12, 26, 9)",
    type: "oscillator",
    color: "#4f46e5",
    soft: "rgba(79, 70, 229, 0.12)",
    macdColor: "#2563eb",
    signalColor: "#ea580c",
    histUpColor: "#16a06b",
    histDownColor: "#e25757"
  },
  {
    id: "obv",
    label: "OBV",
    fullLabel: "On-Balance Volume (OBV)",
    type: "oscillator",
    color: "#8b5cf6",
    obvColor: "#8b5cf6",
    smaColor: "#f59e0b",
    soft: "rgba(139, 92, 246, 0.12)"
  }
];

export const INDICATOR_COLORS = Object.fromEntries(
  INDICATORS_CONFIG.map((ind) => [ind.id, ind])
);

export const STRATEGY_STUDIES_CONFIG = [
  {
    id: "supertrend",
    label: "Supertrend",
    fullLabel: "Supertrend (ATR 10, Multiplier 3)",
    type: "strategy",
    color: "#16a06b",
    soft: "rgba(22, 160, 107, 0.12)",
    description: "Trailing stop ratchet & dynamic flip triggers"
  },
  {
    id: "squeeze_momentum",
    label: "Squeeze",
    fullLabel: "Squeeze Momentum Indicator",
    type: "strategy",
    color: "#8b5cf6",
    soft: "rgba(139, 92, 246, 0.12)",
    description: "Compression dots & breakout fires"
  },
  {
    id: "trend_regime",
    label: "Regime",
    fullLabel: "Dual Moving Average & RSI Regime",
    type: "strategy",
    color: "#2563eb",
    soft: "rgba(37, 99, 235, 0.12)",
    description: "50-MA cross triggers & support/resistance"
  },
  {
    id: "exhaustion_weakness",
    label: "Exhaustion",
    fullLabel: "Daily Exhaustion & Weakness Detector",
    type: "strategy",
    color: "#f43f5e",
    soft: "rgba(244, 63, 94, 0.12)",
    description: "Short-term weakness, overextension & distribution wicks"
  },
  {
    id: "mean_reversion",
    label: "Reversion",
    fullLabel: "Mean Reversion & Overextension",
    type: "strategy",
    color: "#f59e0b",
    soft: "rgba(245, 158, 11, 0.12)",
    description: "Bollinger Band + RSI overextension & trend dip entries"
  },
  {
    id: "volume_breakout",
    label: "Breakout",
    fullLabel: "Volume-Confirmed Breakout (Consolidation Expansion)",
    type: "strategy",
    color: "#06b6d4",
    soft: "rgba(6, 182, 212, 0.12)",
    description: "Multi-week consolidation breakout with institutional volume climax"
  },
  {
    id: "institutional_accumulation",
    label: "Accumulation",
    fullLabel: "Institutional Accumulation (AVWAP & Volume Profile)",
    type: "strategy",
    color: "#3b82f6",
    soft: "rgba(59, 130, 246, 0.12)",
    description: "Anchored VWAP from volume climaxes & Point of Control (POC) shelves"
  },
  {
    id: "smart_money_structure",
    label: "Structure",
    fullLabel: "Smart Money Concepts (BOS, CHoCH & Liquidity Gaps)",
    type: "strategy",
    color: "#10b981",
    soft: "rgba(16, 185, 129, 0.12)",
    description: "Break of Structure (BOS), Change of Character (CHoCH) & Fair Value Gaps (FVG)"
  }
];

export const STRATEGY_STUDIES_COLORS = Object.fromEntries(
  STRATEGY_STUDIES_CONFIG.map((s) => [s.id, s])
);

