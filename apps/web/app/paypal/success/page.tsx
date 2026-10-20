"use client";

import { useEffect, useState } from "react";

type TransactionView = {
  transactionId: string;
  status: string;
  amount: string;
  currency: string;
  orderId: string | null;
  orderStatus: string | null;
  authorizationId: string | null;
  authorizationStatus: string | null;
  authorizationExpiresAt: string | null;
  authorizedAt: string | null;
  lastError: string | null;
};

type AuthorizeResponse = {
  transaction?: TransactionView;
  inProgress?: boolean;
  idempotent?: boolean;
  capturePerformed?: boolean;
  error?: string;
  message?: string;
};

export default function PayPalSuccess() {
  const [status, setStatus] = useState("Checking your approved Sandbox order…");
  const [transaction, setTransaction] = useState<TransactionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [protectedDemoFlow, setProtectedDemoFlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const orderToken = params.get("token");
    const localTransactionId = params.get("transactionId");
    setProtectedDemoFlow(params.get("flow") === "protected-demo");

    if (!orderToken || !localTransactionId) {
      setStatus("Missing PayPal order token or PactPay transaction reference.");
      return;
    }
    const orderId: string = orderToken;
    const transactionId: string = localTransactionId;

    async function pollTransaction(id: string): Promise<TransactionView | null> {
      for (let attempt = 0; attempt < 16 && !cancelled; attempt += 1) {
        const response = await fetch(`/api/paypal/transactions/${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to read transaction state.");
        const tx = data.transaction as TransactionView;
        if (tx.status !== "AUTHORIZING" && tx.status !== "CREATING") return tx;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      return null;
    }

    async function run() {
      try {
        const response = await fetch(`/api/paypal/orders/${encodeURIComponent(orderId)}/authorize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transactionId }),
        });
        const data = (await response.json()) as AuthorizeResponse;
        if (!response.ok) throw new Error(data.error ?? "Authorization failed.");

        let tx = data.transaction ?? null;
        if (data.inProgress || tx?.status === "AUTHORIZING") {
          setStatus("Authorization is being confirmed by PayPal…");
          tx = await pollTransaction(transactionId);
        }
        if (cancelled) return;
        if (!tx) throw new Error("Authorization is still processing. Refresh this page in a moment to check the persisted status.");
        setTransaction(tx);
        if (tx.status === "AUTHORIZED") {
          setStatus(params.get("flow") === "protected-demo"
            ? "PROTECTED SANDBOX AUTHORIZATION SUCCESSFUL — NO CAPTURE HAS BEEN PERFORMED. Continue to evaluate the bound Purchase Pact."
            : "AUTHORIZATION SUCCESSFUL — NO CAPTURE HAS BEEN PERFORMED.");
        } else if (tx.status === "AUTHORIZATION_REVIEW") {
          setStatus("AUTHORIZATION RECEIVED — MANUAL REVIEW REQUIRED. NO CAPTURE HAS BEEN PERFORMED.");
        } else {
          setStatus(`Transaction state: ${tx.status}`);
          if (tx.lastError) setError(tx.lastError);
        }
      } catch (caught) {
        if (cancelled) return;
        setStatus("We could not confirm the authorization state.");
        setError(caught instanceof Error ? caught.message : "Unexpected error");
      }
    }

    void run();
    return () => { cancelled = true; };
  }, []);

  return (
    <main style={{ maxWidth: 760, margin: "64px auto", padding: 24, fontFamily: "Arial, sans-serif", color: "#17211b" }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1.2, color: "#467358" }}>PACTPAY · SANDBOX PAYMENT FOUNDATION</p>
      <h1>PactPay — Authorized, Not Captured</h1>
      <p aria-live="polite">{status}</p>
      {error && <p style={{ color: "#a12828" }}>{error}</p>}
      {transaction && (
        <section style={{ marginTop: 24, padding: 20, border: "1px solid #d5dfd8", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Transaction receipt</h2>
          <dl style={{ display: "grid", gridTemplateColumns: "minmax(150px, 1fr) 2fr", gap: "10px 16px", overflowWrap: "anywhere" }}>
            <dt>Local transaction</dt><dd>{transaction.transactionId}</dd>
            <dt>PayPal order ID</dt><dd>{transaction.orderId ?? "Not available"}</dd>
            <dt>Amount</dt><dd>{transaction.currency} {transaction.amount}</dd>
            <dt>PactPay state</dt><dd>{transaction.status}</dd>
            <dt>PayPal authorization ID</dt><dd>{transaction.authorizationId ?? "Not available"}</dd>
            <dt>PayPal authorization status</dt><dd>{transaction.authorizationStatus ?? "Not available"}</dd>
            <dt>Authorization expiry</dt><dd>{transaction.authorizationExpiresAt ?? "Not available"}</dd>
          </dl>
          <p style={{ marginBottom: 0, fontWeight: 700 }}>Capture performed by PactPay: No</p>
        </section>
      )}
      {protectedDemoFlow && transaction?.status === "AUTHORIZED" && (
        <section style={{ marginTop: 24, padding: 20, border: "1px solid #b8d4c2", background: "#f4fbf6", borderRadius: 12 }}>
          <h2 style={{ marginTop: 0 }}>Continue to the protected demo</h2>
          <p>The Purchase Pact and simulated offer were bound before buyer approval. Inspect or change the controlled scenario, then run the server-side gate.</p>
          <a href={`/protected-demo?transactionId=${encodeURIComponent(transaction.transactionId)}`} style={{ display: "inline-block", marginTop: 8, padding: "12px 16px", background: "#276449", color: "white", textDecoration: "none", borderRadius: 8, fontWeight: 700 }}>Open protected settlement console →</a>
        </section>
      )}
      <p style={{ marginTop: 24, color: "#5d6b61" }}>
        Safety rule: buyer approval is not a settlement decision. PactPay records and revalidates the authorization separately; only the protected, bound Sandbox demo can request settlement through its deterministic gate.
      </p>
    </main>
  );
}
