"use client";

import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";

type Me = { demo: { username: string; password: string } | null };

const BUYER_EMAIL = process.env.NEXT_PUBLIC_SANDBOX_BUYER_EMAIL ?? "";
const BUYER_PASSWORD = process.env.NEXT_PUBLIC_SANDBOX_BUYER_PASSWORD ?? "";

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" aria-label={`Copy ${label}`} onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }).catch(() => undefined); }}>{done ? "Copied" : "Copy"}</button>
  );
}

function Cred({ label, value }: { label: string; value: string }) {
  return <div className="jd-cred"><span>{label}</span><code>{value}</code><Copy value={value} label={label} /></div>;
}

export default function JudgesPage() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { void fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json() as Promise<Me>).then(setMe).catch(() => undefined); }, []);

  return (
    <AppShell>
      <p className="pp-eyebrow">Judge guide · about 4 minutes</p>
      <h1 className="pp-h1" style={{ marginTop: 12 }}>Two paths. Both work without reading code.</h1>
      <p className="pp-lede" style={{ marginTop: 16 }}>PactPay runs in test mode: PayPal Sandbox money only, and no retailer order is ever placed. Path A is the full PayPal flow. Path B is the browser extension on a demo store. Each stands alone.</p>

      <section className="jd-creds" aria-label="Test credentials">
        <div className="pp-card">
          <p className="pp-eyebrow">Sign in to PactPay</p>
          {me?.demo ? (<><Cred label="Username" value={me.demo.username} /><Cred label="Password" value={me.demo.password} /></>) : <p className="pp-small pp-muted" style={{ marginTop: 8 }}>This deployment doesn&apos;t require sign-in, or hides the demo login. If you see a sign-in page, use the credentials in the README.</p>}
          <a className="pp-btn pp-btn-secondary pp-btn-sm" style={{ marginTop: 12 }} href="/login">Open sign in</a>
        </div>
        {BUYER_EMAIL && (
          <div className="pp-card">
            <p className="pp-eyebrow">PayPal Sandbox buyer (test money)</p>
            <Cred label="Email" value={BUYER_EMAIL} />
            {BUYER_PASSWORD && <Cred label="Password" value={BUYER_PASSWORD} />}
            <p className="pp-small pp-muted" style={{ marginTop: 10 }}>Use this on PayPal&apos;s approval screen when asked to approve the hold.</p>
          </div>
        )}
      </section>

      <div className="jd-paths">
        <section className="pp-card jd-path">
          <div className="jd-tag">Path A · the PayPal flow · 2 min</div>
          <h2 className="pp-h2">An agent shops. PayPal holds. Fixed code decides.</h2>
          <ol className="jd-steps">
            <li><b>Say it.</b> On <a href="/">Shop</a> press <i>Turn this into rules</i>. Tick <i>make the seller&apos;s checkout page hostile</i>, keep <i>Ask me above a limit</i>, then <i>Approve and let the agent start</i>.</li>
            <li><b>Watch the agent</b> call its tools live: read your rules, search a real catalog, rank offers, ask PayPal for an authorization hold.</li>
            <li><b>Approve on PayPal</b> as the Sandbox buyer. Nothing is charged yet.</li>
            <li><b>See the block.</b> Two AI readers inspect the checkout; fixed rules say <i>Do not pay</i>. The hold is voided and <b>$0 moves</b>.</li>
            <li><b>Run it again honestly</b> (hostile box unticked): <i>Safe to pay</i>, and the gate captures once.</li>
          </ol>
          <a className="pp-btn pp-btn-primary" href="/">Start Path A</a>
        </section>

        <section className="pp-card jd-path">
          <div className="jd-tag">Path B · the Guard extension · 2 min</div>
          <h2 className="pp-h2">Check the real checkout on any store.</h2>
          <ol className="jd-steps">
            <li><b>Install.</b> <a href="/api/guard/extension" download>Download the extension</a>, unzip, open <code>chrome://extensions</code>, turn on Developer mode, <i>Load unpacked</i>. It already points at this site.</li>
            <li><b>Open the <a href="/store" target="_blank" rel="noopener">demo store</a></b> and click each checkout. Expect: honest = <i>Safe</i>; hidden fee, CSS-drawn fee, invisible instruction to an AI, over budget = <i>Do not pay</i>.</li>
            <li><b>Click Place order</b> on a blocked one. Guard stops it, the same way it would stop an AI agent.</li>
            <li><b>Press Set my rules</b>, say &ldquo;total under $30 including shipping&rdquo;, review, approve in the pop-up. No sign-in needed.</li>
            <li>Optional: <a href="/extension">link the extension</a> and see each check in <a href="/control-center">Activity → Guard checks</a>.</li>
          </ol>
          <a className="pp-btn pp-btn-primary" href="/extension">Start Path B</a>
        </section>
      </div>

      <h2 className="pp-h2" style={{ marginTop: 44 }}>What to look for</h2>
      <div className="jd-look">
        <div className="pp-card"><h3 className="pp-h3">PayPal is the safety mechanism</h3><p className="pp-small pp-muted" style={{ marginTop: 6 }}>Authorize first, capture only if the gate passes, void otherwise. Orders v2, Payments v2 and signed webhooks.</p></div>
        <div className="pp-card"><h3 className="pp-h3">Models propose, code disposes</h3><p className="pp-small pp-muted" style={{ marginTop: 6 }}>No model sits in the settlement path or in Guard&apos;s verdict. Models only draft rules or read pixels.</p></div>
        <div className="pp-card"><h3 className="pp-h3">Eyes and code differ</h3><p className="pp-small pp-muted" style={{ marginTop: 6 }}>Invisible text is only in the code. A CSS-drawn fee is only on screen. If they disagree, nothing is safe.</p></div>
        <div className="pp-card"><h3 className="pp-h3">Unknown is never safe</h3><p className="pp-small pp-muted" style={{ marginTop: 6 }}>Missing shipping or tax is &ldquo;can&apos;t verify&rdquo;, never zero. Everything simulated is labelled.</p></div>
      </div>
      <p className="pp-small pp-muted" style={{ marginTop: 20, maxWidth: "50em" }}>Honest limits: a sandbox has no real retailer checkout, so Path A draws the checkout from the order&apos;s sandbox terms. Guard is how the same inspection reaches real pages, and the demo store exists so it can be shown without a third party&apos;s brand. Free hosting can take ~30 seconds to wake on the first visit.</p>
    </AppShell>
  );
}
