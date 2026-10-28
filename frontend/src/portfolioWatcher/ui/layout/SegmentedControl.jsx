import React from "react";

function shouldShowDivider(prevOption, currOption) {
  if (!prevOption || !currOption) return false;
  if (prevOption.dividerAfter || currOption.dividerBefore) return true;
  // Groupings: [chart, documents, catalysts] | [indicators] | [quant alpha / extra] | [performance_lab]
  if (prevOption.value === "catalysts") return true;
  if (prevOption.value === "documents" && currOption.value !== "catalysts") return true;
  if (prevOption.value === "indicators") return true;
  if (currOption.value === "performance_lab") return true;
  return false;
}

export default function SegmentedControl({ options, value, onChange, ariaLabel }) {
  return (
    <div className="pw-segmented" role="tablist" aria-label={ariaLabel}>
      {options.map((option, idx) => {
        const prevOption = idx > 0 ? options[idx - 1] : null;
        const showDivider = shouldShowDivider(prevOption, option);
        const isDisabled = Boolean(option.disabled || option.value === "performance");

        return (
          <React.Fragment key={option.value}>
            {showDivider && <span className="pw-seg-divider" aria-hidden="true" />}
            <button
              className={`pw-seg-btn ${value === option.value ? "pw-active" : ""} ${isDisabled ? "pw-disabled" : ""}`}
              type="button"
              role="tab"
              aria-selected={value === option.value}
              disabled={isDisabled}
              title={isDisabled ? `${option.label} (Under Development)` : undefined}
              onClick={() => {
                if (isDisabled) return;
                onChange(option.value);
              }}
            >
              {option.label}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
}

