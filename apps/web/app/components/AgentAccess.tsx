"use client";

import { useEffect, useMemo, useState } from "react";
import { logEvent } from "./agentLog";

/** Creates a short-lived key bound to the shopper's approved Pact and exposes a remote MCP endpoint. */
export default function AgentAccess({ approvalId: suppliedApprovalId }: { approvalId?: string | null }) {
  const [storedApprovalId, setStoredApprovalId] = useState<string | null>(suppliedApprovalId ?? null);
  const [origin, setOrigin] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
    if (suppliedApprovalId !== undefined) {
      setStoredApprovalId(suppliedApprovalId);
      return;
    }
    try {
      const raw = window.sessionStorage.getItem("pactpay.activeApproval.v1");
      const parsed = raw ? JSON.parse(raw) as { approvalId?: unknown } : null;
      if (parsed && typeof parsed.approvalId === "string") setStoredApprovalId(parsed.approvalId);
    } catch { /* no approved Pact in this tab */ }
  }, [suppliedApprovalId]);

  const endpoint = origin ? `${origin}/api/mcp` : "/api/mcp";
  const remoteConfig = useMemo(() => JSON.stringify({
    mcpServers: {
      pactpay: {
        url: endpoint,
        headers: { Authorization: `Bearer ${key ?? "ppk_YOUR_KEY"}` },
      },
    },
  }, null, 2), [endpoint, key]);
  const httpExample = useMemo(() => `const PACTPAY_URL = ${JSON.stringify(origin || "https://your-pactpay-domain")};
const PACTPAY_KEY = ${JSON.stringify(key ?? "ppk_YOUR_KEY")};

async function pactpay(path, method = "GET", body) {
  const response = await fetch(PACTPAY_URL + path, {
    method,
    headers: {
      Authorization: "Bearer " + PACTPAY_KEY,
      "Content-Type": "application/json"
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "PactPay request failed: " + response.status);
  return data;
}

// Read the user's approved rules, then retrieve offers with images and policy verdicts.
const rules = await pactpay("/api/agent/v1/rules");
const shortlist = await pactpay("/api/agent/v1/shortlist", "POST", { query: "wireless headphones" });
console.log(shortlist.results); // title, imageUrl, price, merchant, verdict, reason, offerUrl

// Use a returned snapshotId to request a hold only for an eligible PASS offer.
// A person still approves the PayPal Sandbox hold before settlement.`, [origin, key]);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setError("Clipboard access was blocked. Select and copy the text manually.");
    }
  }

  async function create() {
    if (!storedApprovalId || busy) return;
    setBusy(true); setError(null); setKey(null);
    try {
      const response = await fetch("/api/agent-keys", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId: storedApprovalId }), cache: "no-store",
      });
      const payload = await response.json() as { key?: string; expiresAt?: string; error?: string };
      if (!response.ok || !payload.key) throw new Error(payload.error ?? "Couldn't create an agent key.");
      setKey(payload.key);
      setExpiresAt(payload.expiresAt ?? null);
      logEvent("you", "Created a limited remote key for my own AI agent.", `key:${storedApprovalId}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't create an agent key.");
    } finally { setBusy(false); }
  }

  async function revoke() {
    if (!storedApprovalId || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/agent-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approvalId: storedApprovalId }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Couldn't revoke the key.");
      setKey(null); setExpiresAt(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn't revoke the key.");
    } finally { setBusy(false); }
  }

  return (
    <details className="pp-card-flat">
      <summary style={{ cursor: "pointer", fontWeight: 700 }}>Connect your own AI agent <span className="pp-small pp-muted" style={{ fontWeight: 500 }}>· remote MCP, no download needed</span></summary>
      <div className="pp-stack" style={{ marginTop: 12, gap: 12 }}>
        <p className="pp-small">Connect any agent that supports remote MCP over Streamable HTTP. Your key is tied to this approved Purchase Pact, expires automatically and can be revoked. Your agent can read rules, search offers, request a hold and request settlement. It cannot edit your rules or bypass PactPay's payment checks.</p>
        {!key && <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" style={{ justifySelf: "start" }} onClick={() => void create()} disabled={busy || !storedApprovalId}>{busy ? "Creating…" : "Create remote agent key"}</button>}
        {error && <p className="pp-callout pp-callout-bad" role="alert">{error}</p>}
        {key && (
          <>
            <div>
              <p className="pp-small" style={{ fontWeight: 700 }}>1. Your agent key <span className="pp-muted" style={{ fontWeight: 500 }}>(shown once{expiresAt ? ` · expires ${new Date(expiresAt).toLocaleString()}` : ""})</span></p>
              <pre className="pp-code">{key}</pre>
              <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => void copy("key", key)}>{copied === "key" ? "Copied" : "Copy key"}</button>
            </div>
            <div>
              <p className="pp-small" style={{ fontWeight: 700 }}>2. Remote MCP endpoint</p>
              <pre className="pp-code">{endpoint}</pre>
              <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => void copy("endpoint", endpoint)}>{copied === "endpoint" ? "Copied" : "Copy endpoint"}</button>
            </div>
            <div>
              <p className="pp-small" style={{ fontWeight: 700 }}>3. Paste this into your MCP client's remote-server settings</p>
              <pre className="pp-code">{remoteConfig}</pre>
              <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => void copy("config", remoteConfig)}>{copied === "config" ? "Copied" : "Copy remote config"}</button>
            </div>
            <div className="pp-callout pp-callout-warn">
              <p className="pp-small"><strong>No PactPay repository, Node install or local MCP script is required.</strong> This connects directly to the hosted endpoint. Your AI client must support remote MCP / Streamable HTTP and custom Authorization headers.</p>
            </div>
            <div>
              <p className="pp-small" style={{ fontWeight: 700 }}>4. Direct HTTPS API (no MCP client or PactPay files required)</p>
              <p className="pp-tiny pp-muted" style={{ margin: "4px 0 8px" }}>Use this from your own server-side agent or application. The response includes product images, prices, merchant links, rule verdicts and reasons.</p>
              <pre className="pp-code" style={{ maxHeight: 260, overflow: "auto" }}>{httpExample}</pre>
              <button type="button" className="pp-btn pp-btn-secondary pp-btn-sm" onClick={() => void copy("http", httpExample)}>{copied === "http" ? "Copied" : "Copy HTTP example"}</button>
            </div>
            <div className="pp-callout pp-callout-info">
              <p className="pp-small"><strong>HTTP endpoints</strong></p>
              <p className="pp-tiny">GET /api/agent/v1/rules · POST /api/agent/v1/shortlist · POST /api/agent/v1/hold · POST /api/agent/v1/settle · GET /api/agent/v1/orders/{"{transactionId}"}</p>
              <p className="pp-tiny pp-muted" style={{ marginTop: 5 }}>Send the key as an Authorization: Bearer header on every request. The API is intended for server-side agent runtimes; do not expose the key in public browser code.</p>
            </div>
            <p className="pp-tiny pp-muted">Available tools: read approved rules, shortlist all matching offers with images and links, request a PayPal Sandbox hold, request settlement and check order status. The key is limited to this Purchase Pact.</p>
            <button type="button" className="pp-link-btn" style={{ justifySelf: "start" }} onClick={() => void revoke()} disabled={busy}>Revoke key</button>
          </>
        )}
      </div>
    </details>
  );
}
