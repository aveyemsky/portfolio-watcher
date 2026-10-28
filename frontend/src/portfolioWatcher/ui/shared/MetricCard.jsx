export default function MetricCard({ label, value, subValue, tone, tooltip }) {
  return (
    <div className="pw-metric-card" title={tooltip}>
      <span className="pw-metric-label">{label}</span>
      <strong className={!subValue && tone ? `pw-${tone}` : undefined}>{value}</strong>
      {subValue && (
        <span className={`pw-metric-sub${tone ? ` pw-${tone}` : ""}`}>
          {subValue}
        </span>
      )}
    </div>
  );
}

