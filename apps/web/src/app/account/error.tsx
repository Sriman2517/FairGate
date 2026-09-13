"use client";

export default function AccountError({ reset }: { reset: () => void }) {
  return (
    <section className="notice page-notice">
      <h1>We couldn’t load your account</h1>
      <p>The account service may be temporarily unavailable. Please try again.</p>
      <button className="button" onClick={reset}>Try again</button>
    </section>
  );
}
