import { fmtMoney } from "../viewModel";

export default function SimpleCandlestickChart({ prices, caption = "Candle view" }) {
  const shownPrices = getRecentPrices(prices, 6);
  const high = Math.max(...shownPrices.map((price) => price.high), 1);
  const low = Math.min(...shownPrices.map((price) => price.low), high - 1);
  const range = Math.max(high - low, 1);

  return (
    <div className="pw-chart-card">
      <div className="pw-chart-grid" />
      <div className="pw-axis-labels">
        {[high, low + range * 0.66, low + range * 0.33, low].map((value) => (
          <span key={value}>{fmtMoney(value)}</span>
        ))}
      </div>
      <div className="pw-candles">
        {shownPrices.map((price, index) => {
          const wickTop = ((high - price.high) / range) * 100;
          const wickHeight = ((price.high - price.low) / range) * 100;
          const bodyTop = ((high - Math.max(price.open, price.close)) / range) * 100;
          const bodyHeight = Math.max(4, (Math.abs(price.close - price.open) / range) * 100);
          const direction = price.close >= price.open ? "up" : "down";

          return (
            <div className={`pw-candle pw-${direction}`} key={`${price.timestamp || price.date}-${index}`}>
              <div className="pw-wick" style={{ top: `${wickTop}%`, height: `${wickHeight}%` }} />
              <div className="pw-body" style={{ top: `${bodyTop}%`, height: `${bodyHeight}%` }} />
            </div>
          );
        })}
        <div className="pw-candle-spacer" aria-hidden="true" />
      </div>
      <div className="pw-chart-caption">
        <span>{caption}</span>
        <span>{fmtMoney(low)} - {fmtMoney(high)}</span>
      </div>
    </div>
  );
}

function getRecentPrices(prices, months) {
  if (!prices.length) return prices;

  const lastPrice = prices[prices.length - 1];
  const lastDate = new Date(lastPrice.timestamp || `${lastPrice.date}T00:00:00`);
  const startDate = new Date(lastDate);
  startDate.setMonth(startDate.getMonth() - months);

  const recentPrices = prices.filter((price) => new Date(price.timestamp || `${price.date}T00:00:00`) >= startDate);
  return recentPrices.length ? recentPrices : prices;
}
