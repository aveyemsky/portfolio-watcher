import MetricCard from "../shared/MetricCard";
import { accountValue, fmtMoney0, getSelectedAccount, latestPrice } from "../viewModel";
import { mockAccountReturn } from "../layout/TopSummary";

export default function AccountOverview({ data, state }) {
  const account = getSelectedAccount(data, state);
  const total = accountValue(data, account?.id);
  const holdings = data.holdingsByAccount[String(account?.id)] || [];
  const ytd = mockAccountReturn(account?.id);
  const largest = holdings.length && total > 0
    ? Math.max(...holdings.map((holding) => {
      const stock = data.stocks?.find((s) => s.symbol === holding.symbol);
      const currentPrice = stock?.lastPrice ?? latestPrice(data, holding.symbol)?.close ?? holding.avgCost;
      const value = holding.shares * currentPrice;
      return (value / total) * 100;
    }))
    : 0;

  return (
    <>
      <div className="pw-grid-4">
        <MetricCard label="Total value" value={fmtMoney0(total)} />
        <MetricCard label="YTD return" value={`${ytd >= 0 ? "+" : ""}${ytd.toFixed(2)}%`} tone={ytd >= 0 ? "up" : "down"} />
        <MetricCard label="Day P/L" value={fmtMoney0(total * 0.006)} tone="up" />
        <MetricCard label="Largest weight" value={`${largest.toFixed(1)}%`} />
      </div>
      <div className="pw-spacer" />
      <div className="pw-analysis-note">
        <strong>Portfolio overview</strong>
        <p>
          {account?.name} contains <strong>{holdings.length} holdings</strong>. The selected portfolio is
          also the active portfolio for the holdings navigator, keeping portfolio and position inspection in
          the same compact workspace.
        </p>
      </div>
    </>
  );
}
