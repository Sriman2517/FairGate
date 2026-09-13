import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Movies | FairGate", template: "%s | FairGate" },
  description: "Explore the FairGate cinema demo and book a seat for a fictional film.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="site-header">
          <div className="container header-content">
            <Link className="brand" href="/">FairGate<span>CINEMA</span></Link>
            <nav className="header-nav" aria-label="Main navigation">
              <span className="demo-label">Demo cinema</span>
              <Link href="/bookings">My bookings</Link>
              <Link href="/account">Account</Link>
            </nav>
          </div>
        </header>
        <main id="main-content" className="container">{children}</main>
        <footer className="container site-footer">
          Fictional films and showtimes. Demo bookings only. No payment is collected.
        </footer>
      </body>
    </html>
  );
}
