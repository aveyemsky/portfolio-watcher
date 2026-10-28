import React, { useState } from "react";
import StrategySandboxDrawer from "./StrategySandboxDrawer";
import StockChart from "./StockChart";
import { getSelectedStock } from "../viewModel";

export default function PerformanceLabTab(props) {
  const { data, state, apiBaseUrl, stock: propStock, extraStrategyGroups, initialSelectedStrategies } = props;
  const stock = propStock || (data && state ? getSelectedStock(data, state) : null);
  const symbol = stock?.symbol;
  const [tradeMarkers, setTradeMarkers] = useState([]);
  const [labSelectedStrategies, setLabSelectedStrategies] = useState(() => initialSelectedStrategies || { ma50: true });
  const [visibleLogicalRange, setVisibleLogicalRange] = useState(null);
  const [loadedPrices, setLoadedPrices] = useState(null);

  React.useEffect(() => {
    setVisibleLogicalRange(null);
    setLoadedPrices(null);
  }, [symbol]);

  const handlePricesLoaded = (sym, payload) => {
    if (sym === symbol) {
      setLoadedPrices(payload);
    }
    props.onPricesLoaded?.(sym, payload);
  };

  const mainPrices = loadedPrices || data?.pricesBySymbol?.[symbol] || stock?.prices || [];

  const derivedIndicators = React.useMemo(() => ({
    ema20: Boolean(labSelectedStrategies.ema20),
    ma50: Boolean(labSelectedStrategies.ma50),
    ma200: Boolean(labSelectedStrategies.ma200),
    bb20: Boolean(labSelectedStrategies.bb20),
    atr14: Boolean(labSelectedStrategies.atr14),
    rsi14: Boolean(labSelectedStrategies.rsi14),
    stoch14: Boolean(labSelectedStrategies.stoch14),
    macd: Boolean(labSelectedStrategies.macd),
    obv: Boolean(labSelectedStrategies.obv)
  }), [labSelectedStrategies]);

  return (
    <div className="pw-performance-lab-tab" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      {/* 1. TOP: Performance Lab Workstation */}
      <div className="pw-performance-lab-top-panel">
        <StrategySandboxDrawer
          symbol={symbol}
          apiBaseUrl={apiBaseUrl}
          extraStrategyGroups={extraStrategyGroups}
          initialSelectedStrategies={initialSelectedStrategies}
          onTradeMarkersChange={setTradeMarkers}
          onSelectedStrategiesChange={setLabSelectedStrategies}
          visibleLogicalRange={visibleLogicalRange}
          onVisibleLogicalRangeChange={setVisibleLogicalRange}
          mainPrices={mainPrices}
          title="Performance Lab"
          subtitle="Portfolio Performance & Strategy Simulator"
        />
      </div>

      {/* 2. BOTTOM: Interactive Candlestick Chart with Synced Strategy Flags & Indicators */}
      <div className="pw-performance-lab-bottom-panel">
        <StockChart
          {...props}
          tradeMarkers={tradeMarkers}
          showSandboxDrawer={false}
          selectedIndicators={derivedIndicators}
          indicatorsSelectable={false}
          visibleLogicalRange={visibleLogicalRange}
          onVisibleLogicalRangeChange={setVisibleLogicalRange}
          onPricesLoaded={handlePricesLoaded}
        />
      </div>
    </div>
  );
}
