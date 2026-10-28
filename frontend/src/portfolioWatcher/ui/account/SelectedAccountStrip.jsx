import { accountDailyPercentChange, accountValue, fmtMoney0, getCategoryKey } from "../viewModel";
import { mockAccountReturn } from "../layout/TopSummary";

export default function SelectedAccountStrip({ account, data, state, dispatch, manageMode, onDeleteAccount }) {
  if (!account) return null;

  const category = (data?.categories || []).find((c) => c.id === (account?.categoryId || account?.category_id));
  const isPercentMode = getCategoryKey(category, account) !== "accounts" || (account.sizing_mode || account.sizingMode || "PERCENT") === "PERCENT";
  const dailyPct = accountDailyPercentChange(data, account.id);
  const totalVal = accountValue(data, account.id);
  const isActive = state.selectedType === "account" && state.selectedAccountId === account.id;

  return (
    <div
      className={`pw-selected-account-strip ${isActive ? "pw-active" : ""} ${manageMode ? "pw-manageable" : ""}`}
      role="button"
      tabIndex={0}
      onClick={() => dispatch({ type: "selectAccount", accountId: account.id })}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          dispatch({ type: "selectAccount", accountId: account.id });
        }
      }}
    >
      {manageMode && (
        <button
          className="pw-overlay-action"
          type="button"
          aria-label="Delete portfolio"
          title="Delete portfolio"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteAccount?.();
          }}
        >
          ×
        </button>
      )}
      <div className="pw-strip-label">Selected Portfolio</div>
      <div className="pw-strip-row">
        <div>
          <div className="pw-item-title">{account.name}</div>
          <div className="pw-item-sub">{account.type}</div>
        </div>
        <div className="pw-item-right">
          {!isPercentMode && <strong>{fmtMoney0(totalVal)}</strong>}
          <span className={dailyPct >= 0 ? "pw-up" : "pw-down"}>
            {dailyPct >= 0 ? "+" : ""}{dailyPct.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}
