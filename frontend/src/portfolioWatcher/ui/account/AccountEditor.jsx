import { useEffect, useState } from "react";

export default function AccountEditor({
  account,
  submitLabel,
  onCancel,
  onSubmit,
  isSubmitting
}) {
  const [name, setName] = useState(account?.name || "");
  const [type, setType] = useState(account?.type || "");

  useEffect(() => {
    setName(account?.name || "");
    setType(account?.type || "");
  }, [account]);

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit({ name: name.trim(), type: type.trim() });
  }

  return (
    <form className="pw-account-editor" onSubmit={handleSubmit}>
      <input
        type="text"
        value={name}
        placeholder="Portfolio name"
        onChange={(event) => setName(event.target.value)}
      />
      <input
        type="text"
        value={type}
        placeholder="Portfolio type"
        onChange={(event) => setType(event.target.value)}
      />
      <div className="pw-account-editor-actions">
        <button type="submit" disabled={isSubmitting || !name.trim() || !type.trim()}>
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
