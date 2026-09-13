import Link from "next/link";

export default function NotFound() {
  return (
    <section className="notice page-notice">
      <p className="eyebrow">PAGE NOT FOUND</p>
      <h1>We couldn't find that page.</h1>
      <p>The link may be incorrect, or this item may not be available to your account.</p>
      <Link className="button" href="/">Browse movies</Link>
    </section>
  );
}
