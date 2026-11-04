"use client";

export type Ev =
  | { type: "start"; modelLabel: string; model: string; openWeights: boolean; autonomy: string }
  | { type: "model"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; status: number; refused: boolean; data: Record<string, unknown> }
  | { type: "needs_human"; approvalUrl: string; transactionId: string | null }
  | { type: "done"; reason: string; steps: number }
  | { type: "error"; message: string };

const TOOL_TITLES: Record<string, string> = {
  get_rules: "Reading your locked rules",
  shortlist: "Searching live stores and ranking offers",
  hold_payment: "Asking PayPal to hold the money",
  request_settlement: "Asking PactPay's gate to settle",
  order_status: "Checking the order",
};

export function summarize(name: string, data: Record<string, unknown>): string {
  if (name === "shortlist" && Array.isArray(data.results)) {
    const rows = data.results as Array<{ verdict?: string }>;
    return `${rows.length} offers ranked · ${rows.filter((row) => row.verdict === "PASS").length} pass your rules`;
  }
  if (name === "get_rules" && Array.isArray(data.rules)) return `${(data.rules as unknown[]).length} locked rules`;
  if (name === "hold_payment" && typeof data.approvalUrl === "string") return "Hold created. Nothing is charged.";
  if (name === "request_settlement" && typeof data.outcome === "string") return data.outcome === "CAPTURED" ? "Captured once" : data.outcome === "BLOCKED_AND_VOIDED" ? "Blocked. Hold voided. $0 moved." : String(data.outcome);
  if (typeof data.error === "string") return data.error;
  return "";
}

export async function streamAgent(body: Record<string, unknown>, signal: AbortSignal, onEvent: (event: Ev) => void): Promise<void> {
  const response = await fetch("/api/muse-agent", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify(body) });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? "The agent couldn't start.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
      if (!line) continue;
      try { onEvent(JSON.parse(line) as Ev); } catch { /* partial line */ }
    }
  }
}

export function Timeline({ events }: { events: Ev[] }) {
  return (
    <div className="pp-timeline" aria-live="polite">
      {events.map((event, index) => {
        if (event.type === "start") return <div key={index} className="pp-ev pp-ev-model pp-enter"><div className="pp-ev-head">Model</div>{event.modelLabel} ({event.openWeights ? "open weights" : "Meta Model API"})</div>;
        if (event.type === "model") return <div key={index} className="pp-ev pp-ev-model pp-enter"><div className="pp-ev-head">🧠 Muse says</div>{event.text}</div>;
        if (event.type === "tool_call") return <div key={index} className="pp-ev pp-ev-tool pp-enter"><div className="pp-ev-head">🔧 {TOOL_TITLES[event.name] ?? event.name} <code>{event.name}</code></div></div>;
        if (event.type === "tool_result") return (
          <div key={index} className={`pp-ev pp-enter ${event.refused ? "pp-ev-refused" : event.status < 300 ? "pp-ev-good" : "pp-ev-tool"}`}>
            <div className="pp-ev-head">{event.refused ? "⛔ PactPay refused" : event.status < 300 ? "✅ Done" : "⚠️ Problem"}</div>{summarize(event.name, event.data)}
          </div>
        );
        if (event.type === "needs_human") return <div key={index} className="pp-ev pp-ev-tool pp-enter"><div className="pp-ev-head">🙋 Paused for you</div>A person approves the hold on PayPal before anything else can happen.</div>;
        if (event.type === "done") return null;
        return <div key={index} className="pp-callout pp-callout-bad pp-enter" role="alert">{event.message}</div>;
      })}
    </div>
  );
}

