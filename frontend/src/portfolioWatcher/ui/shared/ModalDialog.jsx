import React, { useEffect, useRef } from "react";

/**
 * Standard Modal Dialog component.
 * Centered in the viewport, accessible keyboard (ESC to close, auto-focus),
 * customizable title, message/body, and action buttons.
 *
 * @param {object} props
 * @param {boolean} [props.isOpen=true]
 * @param {string} [props.title]
 * @param {React.ReactNode} [props.children]
 * @param {React.ReactNode} [props.actions]
 * @param {() => void} [props.onClose]
 * @param {number|string} [props.maxWidth=440]
 * @param {string} [props.className]
 */
export default function ModalDialog({
  isOpen = true,
  title,
  children,
  actions,
  onClose,
  maxWidth = 440,
  className = ""
}) {
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e) {
      if (e.key === "Escape" && onClose) {
        e.stopPropagation();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="pw-dialog-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={`pw-dialog-box ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "pw-dialog-title" : undefined}
        style={{ maxWidth: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth }}
      >
        {title && (
          <div className="pw-dialog-header">
            <h4 id="pw-dialog-title" className="pw-dialog-title">
              {title}
            </h4>
            {onClose && (
              <button
                type="button"
                className="pw-dialog-close-btn"
                aria-label="Close dialog"
                onClick={onClose}
              >
                ×
              </button>
            )}
          </div>
        )}

        <div className="pw-dialog-body">{children}</div>

        {actions && <div className="pw-dialog-actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * Standard Confirmation Dialog for deletions and critical actions.
 *
 * @param {object} props
 * @param {boolean} [props.isOpen=true]
 * @param {string} [props.title="Confirm Action"]
 * @param {React.ReactNode} props.message
 * @param {string} [props.confirmLabel="Confirm"]
 * @param {string} [props.cancelLabel="Cancel"]
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onCancel
 * @param {boolean} [props.isDanger=false]
 * @param {boolean} [props.isSubmitting=false]
 * @param {React.ReactNode} [props.extraActions]
 */
export function ConfirmDialog({
  isOpen = true,
  title = "Confirm Action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  isDanger = false,
  isSubmitting = false,
  extraActions = null
}) {
  if (!isOpen) return null;

  return (
    <ModalDialog
      isOpen={isOpen}
      title={title}
      onClose={isSubmitting ? undefined : onCancel}
      actions={
        <>
          <button
            type="button"
            className="pw-btn-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </button>
          {extraActions}
          <button
            type="button"
            className={`pw-btn-primary ${isDanger ? "pw-btn-danger" : ""}`}
            onClick={onConfirm}
            disabled={isSubmitting}
            autoFocus
          >
            {isSubmitting ? "Processing..." : confirmLabel}
          </button>
        </>
      }
    >
      <div className="pw-dialog-msg">{message}</div>
    </ModalDialog>
  );
}
