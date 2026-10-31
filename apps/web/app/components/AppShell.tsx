"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

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
  { href: "/platforms", label: "For AI platforms" },
  { href: "/control-center", label: "Activity" },
];

type Me = { authenticated: boolean; username: string | null; loginRequired: boolean };
const PUBLIC_PATHS = ["/login", "/platforms"];

export default function AppShell({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  const path = usePathname() ?? "/";
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json() as Promise<Me>).then((value) => {
      if (cancelled) return;
      setMe(value);
      if (value.loginRequired && !value.authenticated && !PUBLIC_PATHS.includes(path)) {
        window.location.replace(`/login?next=${encodeURIComponent(path)}`);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [path]);
  async function logout() {
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { window.location.assign("/login"); }
  }
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
          {me?.authenticated ? (
            <span className="pp-small" style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <strong>{me.username}</strong>
              <button type="button" className="pp-link-btn" onClick={logout}>Log out</button>
            </span>
          ) : me && !me.authenticated && path !== "/login" ? <a className="pp-btn pp-btn-secondary pp-btn-sm" href="/login">Sign in</a> : null}
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
