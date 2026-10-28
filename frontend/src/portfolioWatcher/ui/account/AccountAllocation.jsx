import { accountValue, fmtMoney0, getSelectedAccount, latestPrice } from "../viewModel";

export default function AccountAllocation({ data, state }) {
  const account = getSelectedAccount(data, state);
  const total = accountValue(data, account?.id);
  const rows = (data.holdingsByAccount[String(account?.id)] || [])
    .map((holding) => {
      const stock = data.stocks?.find((item) => item.symbol === holding.symbol);
      const price = stock?.lastPrice ?? latestPrice(data, holding.symbol)?.close ?? holding.avgCost;
      const value = holding.shares * price;
      return {
        ...holding,
        name: stock?.name,
        value,
        weight: total ? (value / total) * 100 : 0
      };
    })
    .sort((a, b) => b.weight - a.weight);

  return (
    <>
      <div className="pw-allocation-visual">
        {rows.map((row) => (
          <div key={row.symbol} style={{ width: `${Math.max(5, row.weight)}%` }} />
        ))}
      </div>
      <div className="pw-table-like">
        {rows.map((row) => (
          <div className="pw-table-row" key={row.symbol}>
            <div>
              <div className="pw-item-title">{row.symbol}</div>
              <div className="pw-item-sub">{row.name}</div>
            </div>
            <div>{fmtMoney0(row.value)}</div>
            <div>{row.weight.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </>
  );
}

