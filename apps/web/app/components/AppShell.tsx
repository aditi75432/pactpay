"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

function Brand() {
  return (
    <a href="/" className="pp-brand" aria-label="PactPay home">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/pactpay-logo.svg" alt="PactPay" height={34} style={{ height: 34, width: "auto", display: "block" }} />
    </a>
  );
}

const NAV = [
  { href: "/", label: "Shop" },
  { href: "/extension", label: "Guard extension" },
  { href: "/platforms", label: "For AI platforms" },
  { href: "/control-center", label: "Activity" },
  { href: "/judges", label: "Judge guide" },
];

type Me = { authenticated: boolean; username: string | null; loginRequired: boolean };
type AiStatus = { configured: boolean; providers: Array<{ id: string; modelLabel: string; model: string; openWeights: boolean }>; crossModel: boolean };

/** Always-visible proof of which Meta model is behind the app right now. */
function MuseChip() {
  const [status, setStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ai/status", { cache: "no-store" }).then((r) => r.json() as Promise<AiStatus>).then((v) => { if (!cancelled) setStatus(v); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  if (!status) return null;
  const label = status.crossModel ? `${status.providers[0]?.modelLabel ?? "Muse"} + Open` : status.providers[0]?.modelLabel ?? "Muse";
  const names = status.providers.map((p) => p.modelLabel).join(" + ");
  return (
    <span className="pp-muse-chip" data-off={!status.configured} title={status.configured ? `AI calls in this app run on: ${names}` : "No Meta model is configured: the app uses its basic local parser."}>
      <i aria-hidden="true" />{status.configured ? `AI · ${label}` : "AI model not set up"}
    </span>
  );
}
const PUBLIC_PATHS = ["/login", "/platforms", "/judges", "/extension"];

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
          <div className="pp-header-right">
          <MuseChip />
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
        </div>
      </header>
      <main className={`pp-main${narrow ? " pp-narrow" : ""}`} style={narrow ? { maxWidth: 820 } : undefined}>{children}</main>
      <footer className="pp-footer">
        <div className="pp-footer-in">
          <div className="pp-footer-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/pactpay-logo.svg" alt="PactPay" height={28} style={{ height: 28, width: "auto" }} />
            <p>Let your AI agent shop. PayPal holds the money until it&apos;s right.</p>
          </div>
          <nav aria-label="Footer" className="pp-footer-nav">
            <a href="/">Shop</a><a href="/extension">Guard extension</a><a href="/control-center">Activity</a><a href="/platforms">For AI platforms</a><a href="/judges">Judge guide</a><a href="/store" target="_blank" rel="noopener">Demo store</a>
          </nav>
          <p className="pp-footer-note">Built for the PayPal AI Hackathon. PayPal Sandbox only: no real money moves and no retailer order is ever placed.</p>
        </div>
      </footer>
    </div>
  );
}
