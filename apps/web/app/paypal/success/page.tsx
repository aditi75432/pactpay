"use client";

import { useEffect, useState } from "react";
import AppShell from "../../components/AppShell";
import { money } from "../../components/format";

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
  const [status, setStatus] = useState("Confirming your payment hold with PayPal…");
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
        if (tx.status === "AUTHORIZED" && params.get("flow") === "protected-demo") {
          window.location.replace(`/order/${encodeURIComponent(tx.transactionId)}`);
          return;
        }
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

  const failed = Boolean(error) && !transaction;
  return (
    <AppShell narrow>
      <div className="pp-card" aria-live="polite">
        {!transaction && !failed && (
          <>
            <h1 className="pp-h2"><span className="pp-spinner pp-spinner-dark" style={{ marginRight: 12 }} aria-hidden="true" />Placing your payment hold…</h1>
            <p className="pp-muted" style={{ marginTop: 10 }}>{status}</p>
            <p className="pp-small pp-muted" style={{ marginTop: 6 }}>Nothing is being charged. We&apos;re only confirming the hold with PayPal.</p>
          </>
        )}
        {failed && (
          <>
            <h1 className="pp-h2">We couldn&apos;t confirm the hold</h1>
            <p className="pp-callout pp-callout-bad" role="alert" style={{ marginTop: 12 }}>{error}</p>
            <p className="pp-small pp-muted" style={{ marginTop: 10 }}>No money was charged. You can safely go back and try again.</p>
            <a href="/" className="pp-btn pp-btn-primary" style={{ marginTop: 16 }}>Back to start</a>
          </>
        )}
        {transaction && (
          <>
            <h1 className="pp-h2">{transaction.status === "AUTHORIZED" ? "Payment held. Nothing charged." : "Almost there"}</h1>
            <p className="pp-muted" style={{ marginTop: 10 }}>{status}</p>
            {error && <p className="pp-callout pp-callout-bad" style={{ marginTop: 12 }}>{error}</p>}
            <dl className="pp-kv" style={{ marginTop: 18 }}>
              <dt>Amount held</dt><dd>{money(Number(transaction.amount), transaction.currency.trim())}</dd>
              <dt>State</dt><dd>{transaction.status}</dd>
              <dt>PayPal order</dt><dd>{transaction.orderId ?? "—"}</dd>
              <dt>PayPal authorization</dt><dd>{transaction.authorizationId ?? "—"}</dd>
              <dt>Captured by PactPay</dt><dd>No</dd>
            </dl>
            {protectedDemoFlow && transaction.status === "AUTHORIZED" && (
              <a className="pp-btn pp-btn-primary" style={{ marginTop: 18 }} href={`/order/${encodeURIComponent(transaction.transactionId)}`}>Continue</a>
            )}
            <p className="pp-tiny pp-muted" style={{ marginTop: 18 }}>PayPal Sandbox test mode. Buyer approval is not a settlement decision: PactPay checks the offer again before any money is released.</p>
          </>
        )}
      </div>
    </AppShell>
  );
}
