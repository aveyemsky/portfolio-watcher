import MetricCard from "../shared/MetricCard";
import StockChart from "../stock/StockChart";
import { accountValue, getSelectedAccount } from "../viewModel";
import { mockAccountReturn } from "../layout/TopSummary";

export default function AccountPerformance({ data, state }) {
  const account = getSelectedAccount(data, state);
  const total = accountValue(data, account?.id);
  const ytd = mockAccountReturn(account?.id);
  const mockPrices = Array.from({ length: 30 }, (_, index) => {
    const wave = Math.sin(index / 3) * total * 0.006;
    const close = total * (0.94 + index * 0.002) + wave;
    const open = close - total * 0.002 * Math.sin(index);
    return {
      date: `Day ${index + 1}`,
      open,
      close,
      high: Math.max(open, close) + total * 0.003,
      low: Math.min(open, close) - total * 0.003,
      volume: 0
    };
  });

  return (
    <>
      <div className="pw-grid-3">
        <MetricCard label="1M" value="+2.80%" tone="up" />
        <MetricCard label="3M" value="+6.40%" tone="up" />
        <MetricCard label="YTD" value={`${ytd >= 0 ? "+" : ""}${ytd.toFixed(2)}%`} tone={ytd >= 0 ? "up" : "down"} />
      </div>
      <div className="pw-spacer" />
      <StockChart prices={mockPrices} caption="Mock portfolio performance" />
    </>
  );
}
