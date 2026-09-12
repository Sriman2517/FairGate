import Link from "next/link";

export default function NotFound() {
  return (
    <section className="notice page-notice">
      <p className="eyebrow">PAGE NOT FOUND</p>
      <h1>That page isn't in the listings.</h1>
      <p>The link may be incorrect, or the movie may no longer be listed.</p>
      <Link className="button" href="/">Browse movies</Link>
    </section>
  );
}
