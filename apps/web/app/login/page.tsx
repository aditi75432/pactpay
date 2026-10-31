"use client";

import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";

type Me = { authenticated: boolean; username: string | null; loginRequired: boolean; demo: { username: string; password: string } | null };

function safeNext(): string {
  try {
    const next = new URLSearchParams(window.location.search).get("next");
    return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  } catch { return "/"; }
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me", { cache: "no-store" }).then((response) => response.json() as Promise<Me>).then((value) => {
      setMe(value);
      if (value.authenticated) window.location.replace(safeNext());
    }).catch(() => undefined);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "That didn't work. Please try again.");
      window.location.assign(safeNext());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That didn't work. Please try again.");
      setBusy(false);
    }
  }

  return (
    <AppShell narrow>
      <div style={{ maxWidth: 460, margin: "24px auto 0" }}>
        <p className="pp-eyebrow">PactPay</p>
        <h1 className="pp-h2" style={{ marginTop: 8 }}>{mode === "login" ? "Sign in" : "Create your account"}</h1>
        <p className="pp-muted" style={{ marginTop: 8 }}>Your approved rules, agent keys and activity are private to your account. This is a test-mode demo: PayPal Sandbox money only.</p>

        {me?.demo && (
          <div className="pp-callout pp-callout-info" style={{ marginTop: 18 }}>
            <p style={{ fontWeight: 700 }}>Judges and reviewers: use the shared demo account</p>
            <p className="pp-small" style={{ marginTop: 4 }}>Username <code>{me.demo.username}</code> · password <code>{me.demo.password}</code></p>
            <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" style={{ marginTop: 10 }} onClick={() => { setMode("login"); setUsername(me.demo!.username); setPassword(me.demo!.password); }}>Fill it in</button>
            <p className="pp-tiny" style={{ marginTop: 8 }}>The demo account is shared, so its Activity may show other reviewers&apos; attempts. Create your own account for a private view.</p>
          </div>
        )}

        <form className="pp-card" style={{ marginTop: 18 }} onSubmit={submit}>
          <div className="pp-stack" style={{ gap: 14 }}>
            <div>
              <label className="pp-label" htmlFor="username">Username</label>
              <input id="username" className="pp-input" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} maxLength={32} required />
              {mode === "signup" && <p className="pp-tiny pp-muted" style={{ marginTop: 6 }}>3 to 32 characters: letters, numbers, dots, dashes, underscores.</p>}
            </div>
            <div>
              <label className="pp-label" htmlFor="password">Password</label>
              <input id="password" className="pp-input" type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} maxLength={128} required />
              {mode === "signup" && <p className="pp-tiny pp-muted" style={{ marginTop: 6 }}>At least 8 characters.</p>}
            </div>
            {error && <p className="pp-callout pp-callout-bad" role="alert">{error}</p>}
            <button type="submit" className="pp-btn pp-btn-primary pp-btn-block" disabled={busy}>
              {busy ? <><span className="pp-spinner" aria-hidden="true" /> Please wait…</> : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </div>
        </form>
        <p className="pp-small" style={{ marginTop: 14, textAlign: "center" }}>
          {mode === "login" ? <>New here? <button type="button" className="pp-link-btn" onClick={() => { setMode("signup"); setError(null); }}>Create an account</button></> : <>Already have an account? <button type="button" className="pp-link-btn" onClick={() => { setMode("login"); setError(null); }}>Sign in</button></>}
        </p>
        {me && !me.loginRequired && <p className="pp-tiny pp-muted" style={{ marginTop: 10, textAlign: "center" }}>Accounts are optional on this deployment. <a href="/">Continue as a guest</a>.</p>}
      </div>
    </AppShell>
  );
}
