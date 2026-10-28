export default function ListItem({
  title,
  subtitle,
  rightTop,
  rightBottom,
  extra,
  active,
  tone,
  onClick,
  manageMode,
  onManageAction,
  manageLabel = "Remove",
  className = "",
  draggable = false,
  dragHandle = false,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd
}) {
  return (
    <div
      className={`pw-list-item ${dragHandle ? "has-drag-handle" : ""} ${active ? "pw-active" : ""} ${manageMode ? "pw-manageable" : ""} ${className}`}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onClick?.();
      }}
    >
      {dragHandle && <span className="pw-drag-handle" title="Drag to reorder">⠿</span>}
      <span>
        <span className="pw-item-title">{title}</span>
        <span className="pw-item-sub">{subtitle}</span>
      </span>
      <span className="pw-item-right">
        <strong>{rightTop}</strong>
        <span className={tone ? `pw-${tone}` : undefined}>{rightBottom}</span>
        {extra}
      </span>
      {manageMode && (
        <button
          className="pw-overlay-action"
          type="button"
          aria-label={manageLabel}
          title={manageLabel}
          onClick={(event) => {
            event.stopPropagation();
            onManageAction?.();
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
