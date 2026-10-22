"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

function Brand() {
  return (
    <a href="/" className="pp-brand" aria-label="PactPay home">
      <span className="pp-brand-mark" aria-hidden="true">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      </span>
      PactPay
    </a>
  );
}

const NAV = [
  { href: "/", label: "Shop" },
  { href: "/control-center", label: "Activity" },
];

export default function AppShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  const path = usePathname() ?? "/";
  return (
    <div className="pp-app">
      <header className="pp-header">
        <div className="pp-header-inner">
          <Brand />
          <nav className="pp-nav" aria-label="Main">
            {NAV.map((item) => {
              const active = item.href === "/" ? path === "/" || path.startsWith("/agent") || path.startsWith("/order") : path.startsWith(item.href);
              return <a key={item.href} href={item.href} {...(active ? { "aria-current": "page" as const } : {})}>{item.label}</a>;
            })}
          </nav>
          <span className="pp-testmode" title="Payments use PayPal Sandbox test money only."><i aria-hidden="true" />Test mode · no real money</span>
          <details className="pp-dev">
            <summary>Developer</summary>
            <div className="pp-dev-menu">
              <a href="/discover">All offers</a>
              <a href="/evidence">Evidence desk</a>
              <a href="/pact-lab">Policy lab</a>
              <a href="/protected-demo">Fixed $849 simulator</a>
            </div>
          </details>
        </div>
      </header>
      <main className={`pp-main${narrow ? " pp-narrow" : ""}`} style={narrow ? { maxWidth: 820 } : undefined}>{children}</main>
    </div>
  );
}
