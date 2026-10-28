export default function ErrorPanel({ title, message }) {
  return (
    <section className="pw-error-panel" role="alert">
      <h2>{title}</h2>
      <p>{message}</p>
    </section>
  );
}

