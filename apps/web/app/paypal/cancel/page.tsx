"use client";

import { useEffect, useState } from "react";

export default function PayPalCancel() {
  const [message, setMessage] = useState("Checkout was cancelled. Recording the result…");
  useEffect(() => {
    const transactionId = new URLSearchParams(window.location.search).get("transactionId");
    if (!transactionId) {
      setMessage("Checkout was cancelled. No PactPay transaction reference was returned.");
      return;
    }
    fetch(`/api/paypal/transactions/${encodeURIComponent(transactionId)}/cancel`, { method: "POST" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Unable to record cancellation.");
        setMessage(`Checkout cancelled. PactPay state: ${data.status}. No payment was captured.`);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "Checkout was cancelled."));
  }, []);
  return <main style={{ maxWidth: 760, margin: "64px auto", padding: 24, fontFamily: "Arial, sans-serif" }}><h1>PactPay — Checkout Cancelled</h1><p aria-live="polite">{message}</p><p>No capture was performed by PactPay.</p></main>;
}
