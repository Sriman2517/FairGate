"use client";

export default function ErrorPage() {
  return (
    <section className="notice page-notice" role="alert">
      <p className="eyebrow">PLEASE TRY AGAIN</p>
      <h1>We couldn't load this page.</h1>
      <p>Something went wrong while loading this page. Please try again in a moment.</p>
      <button className="button" onClick={() => window.location.reload()}>
        Try again
      </button>
    </section>
  );
}
