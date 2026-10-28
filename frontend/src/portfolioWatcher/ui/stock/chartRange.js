const DEFAULT_DISPLAY_MONTHS = 6;
const RIGHT_GAP_RATIO = 0.2;

function parseBarDate(price) {
  if (price?.timestamp) return new Date(price.timestamp);
  if (price?.date) return new Date(`${price.date}T00:00:00`);
  return new Date();
}

export function getDefaultVisibleRange(prices, chartMode = "3y") {
  if (!prices || !prices.length) {
    return { from: 0, to: 0 };
  }

  const lastBarIndex = prices.length - 1;
  const isIntraday = Boolean(prices[0]?.timestamp || prices[lastBarIndex]?.timestamp);

  if (isIntraday || chartMode === "1d") {
    const rightGapBars = Math.max(3, Math.ceil(prices.length * 0.05));
    return {
      from: 0,
      to: lastBarIndex + rightGapBars
    };
  }

  // Regardless of whether 3 years or all historical data is loaded,
  // always display the last 6 months by default so candlesticks are clearly visible
  // and proportionate, while retaining full historical data for panning.
  const lastDate = parseBarDate(prices[lastBarIndex]);
  const startDate = new Date(lastDate);
  startDate.setMonth(startDate.getMonth() - DEFAULT_DISPLAY_MONTHS);

  const firstVisibleIndex = prices.findIndex((price) => parseBarDate(price) >= startDate);
  const from = firstVisibleIndex >= 0 ? firstVisibleIndex : 0;
  const visibleBars = Math.max(lastBarIndex - from + 1, 1);
  const rightGapBars = Math.max(5, Math.ceil(visibleBars * RIGHT_GAP_RATIO));

  return {
    from,
    to: lastBarIndex + rightGapBars
  };
}
