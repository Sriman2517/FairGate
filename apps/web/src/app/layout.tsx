import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Movies | FairGate", template: "%s | FairGate" },
  description: "Explore the FairGate demo movie catalogue and cinema showtimes.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <header className="site-header">
          <div className="container header-content">
            <Link className="brand" href="/">FairGate<span>CINEMA</span></Link>
            <span className="demo-label">Demo cinema</span>
          </div>
        </header>
        <main id="main-content" className="container">{children}</main>
        <footer className="container site-footer">
          Fictional films and showtimes. Booking is not available in this demo yet.
        </footer>
      </body>
    </html>
  );
}
