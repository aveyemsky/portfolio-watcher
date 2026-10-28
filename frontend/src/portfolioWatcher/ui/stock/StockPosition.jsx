import MetricCard from "../shared/MetricCard";
import { accountValue, fmtMoney, fmtMoney0, getActiveAccount, getHolding, getSelectedStock, latestPrice } from "../viewModel";

export default function StockPosition({ data, state }) {
  const stock = getSelectedStock(data, state);
  const account = getActiveAccount(data, state);
  const holding = getHolding(data, account?.id, stock?.symbol);
  const price = latestPrice(data, stock?.symbol)?.close || 0;
  const value = holding ? holding.shares * price : 0;
  const weight = holding ? (value / accountValue(data, account?.id)) * 100 : null;

  return (
    <>
      <div className="pw-grid-4">
        <MetricCard label="Shares" value={holding ? holding.shares : "-"} />
        <MetricCard label="Avg cost" value={holding ? fmtMoney(holding.avgCost) : "-"} />
        <MetricCard label="Position value" value={holding ? fmtMoney0(value) : "-"} />
        <MetricCard label="Weight" value={holding ? `${weight.toFixed(1)}%` : "-"} />
      </div>
      <div className="pw-spacer" />
      <div className="pw-analysis-note">
        <strong>Position summary</strong>
        <p>
          {holding
            ? `${stock.symbol} is currently held in ${account.name}. This view is ready for position-level information such as unrealized gain/loss, entry date, and trade history.`
            : "Watch mode · not currently held in active portfolio"}
        </p>
      </div>
    </>
  );
}
