export default function LoadingPage() {
  return (
    <section className="notice page-notice" role="status" aria-live="polite">
      <p className="eyebrow">ONE MOMENT</p>
      <h1>Loading your page…</h1>
      <p>You can still use the navigation above while we fetch the details.</p>
    </section>
  );
}
