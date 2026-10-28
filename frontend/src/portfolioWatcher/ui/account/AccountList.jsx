import ListItem from "../shared/ListItem";
import { accountValue, fmtMoney0 } from "../viewModel";
import { mockAccountReturn } from "../layout/TopSummary";

export default function AccountList({ data, readOnly = false, state, dispatch, manageMode, onDeleteAccount }) {
  if (!data.accounts.length) {
    return (
      <div className="pw-empty-state">
        {readOnly
          ? "Sign in to view or create personal portfolios."
          : manageMode
            ? "No portfolios yet. Create a portfolio to begin tracking holdings."
            : "No portfolios yet. Click + to create a portfolio."}
      </div>
    );
  }

  const isGridView = state.viewMode === "grid";

  if (isGridView) {
    return (
      <div className="pw-selector-grid pw-stock-grid-view">
        {data.accounts.map((account) => {
          const holdings = data.holdingsByAccount[String(account.id)] || [];
          const ytd = mockAccountReturn(account.id);
          const isUp = ytd >= 0;
          return (
            <div
              key={account.id}
              className={`pw-stock-grid-card ${state.selectedType === "account" && state.selectedAccountId === account.id ? "pw-active" : ""}`}
              onClick={() => dispatch({ type: "selectAccount", accountId: account.id })}
              title={`Click to inspect ${account.name} portfolio`}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  dispatch({ type: "selectAccount", accountId: account.id });
                }
              }}
            >
              <div className="pw-stock-card-main">
                <div className="pw-stock-card-top">
                  <strong className="pw-stock-card-symbol">{account.name}</strong>
                  <span className="pw-stock-card-sector">{account.type}</span>
                </div>
                <div className="pw-stock-card-name">
                  {holdings.length} {holdings.length === 1 ? "holding" : "holdings"}
                  {account.id === state.activeAccountId ? " · active" : ""}
                </div>
              </div>
              <div className="pw-stock-card-metrics">
                <span className="pw-stock-card-price">{fmtMoney0(accountValue(data, account.id))}</span>
                <span className={`pw-stock-card-change ${isUp ? "pw-up" : "pw-down"}`}>
                  {isUp ? "+" : ""}{ytd.toFixed(2)}% YTD
                </span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="pw-list-wrap">
      {data.accounts.map((account) => {
        const holdings = data.holdingsByAccount[String(account.id)] || [];
        const ytd = mockAccountReturn(account.id);
        return (
          <ListItem
            key={account.id}
            title={account.name}
            subtitle={`${account.type} · ${holdings.length} holdings${account.id === state.activeAccountId ? " · active" : ""}`}
            rightTop={fmtMoney0(accountValue(data, account.id))}
            rightBottom={`${ytd >= 0 ? "+" : ""}${ytd.toFixed(2)}%`}
            tone={ytd >= 0 ? "up" : "down"}
            active={state.selectedType === "account" && state.selectedAccountId === account.id}
            onClick={() => dispatch({ type: "selectAccount", accountId: account.id })}
            manageMode={manageMode}
            manageLabel={`Delete ${account.name} portfolio`}
            onManageAction={() => onDeleteAccount?.(account)}
          />
        );
      })}
    </div>
  );
}
