import AppShell from "../components/AppShell";

export const metadata = { title: "PactPay for AI platforms" };

const TOOLS: Array<[string, string, string]> = [
  ["pactpay_get_rules", "Read the rules the user approved and how much you may do alone", "Read only. There is no tool to change them."],
  ["pactpay_shortlist", "Search live stores and rank offers against the rules", "Only offers that pass can be held."],
  ["pactpay_hold_payment", "Ask for a PayPal hold on a passing offer", "A person approves each hold on PayPal. May need a human click, depending on the user's setting."],
  ["pactpay_request_settlement", "Ask PactPay to re-check the live offer and settle", "PactPay decides. It captures only if every rule still passes, otherwise it voids the hold."],
  ["pactpay_order_status", "Check authorization, capture and amount", "Read only."],
];

export default function PlatformsPage() {
  return (
    <AppShell>
      <p className="pp-eyebrow">For AI shopping assistants, marketplaces and procurement tools</p>
      <h1 className="pp-h1" style={{ marginTop: 12, maxWidth: "14em" }}>Let your agent act. Prove it stayed in bounds.</h1>
      <p className="pp-lede" style={{ marginTop: 16 }}>
        Platforms that let agents buy have two choices today: ask the user to confirm every purchase, or accept the risk. PactPay is a third: the user approves rules once, and a check at the moment of payment guarantees the agent can&apos;t spend outside them.
      </p>
      <p className="pp-small pp-muted" style={{ marginTop: 10, maxWidth: "46em" }}>
        Why platforms care: in a Riskified Q1 2026 consumer survey, about half of respondents said the AI platform, not the retailer, should be responsible for unauthorized agent purchases. This is survey data, not observed behavior.
      </p>

      <section className="pp-card" style={{ marginTop: 32 }}>
        <h2 className="pp-h2">How an agent connects</h2>
        <ol style={{ margin: "14px 0 0", paddingLeft: 22, display: "grid", gap: 10 }}>
          <li>The user approves their rules and picks how much the agent may do alone (always ask, ask above a limit, or act within the rules).</li>
          <li>The user creates a limited agent key. It is tied to those rules, expires in 24 hours and can be revoked.</li>
          <li>Your agent calls the PactPay tools over MCP or HTTP. PactPay holds the money, re-checks the live offer, and either captures or voids.</li>
        </ol>
        <table className="pp-table" style={{ marginTop: 20 }}>
          <thead><tr><th>Tool</th><th>What it does</th><th>Guardrail</th></tr></thead>
          <tbody>{TOOLS.map(([name, what, guard]) => <tr key={name}><td><code>{name}</code></td><td>{what}</td><td className="pp-small">{guard}</td></tr>)}</tbody>
        </table>
      </section>

      <section className="pp-card" style={{ marginTop: 20 }}>
        <h2 className="pp-h2">What a misbehaving agent can&apos;t do</h2>
        <ul style={{ margin: "12px 0 0", paddingLeft: 22, display: "grid", gap: 8 }}>
          <li>Change the user&apos;s rules or raise its own autonomy. There is no such tool.</li>
          <li>Release a payment above the limit the user set. The server refuses it, and only the user can release it.</li>
          <li>Hold an offer that already failed its check. The same offer is refused even after a fresh search.</li>
          <li>Act with a missing, wrong, expired or revoked key, or on another user&apos;s order.</li>
          <li>Talk the gate into a capture: the decision is made by fixed rules that re-check the live offer, not by a model.</li>
        </ul>
        <p className="pp-small" style={{ marginTop: 14 }}>Run <code>pnpm agent:redteam</code> against any key to watch these attacks get refused.</p>
      </section>

      <section className="pp-card" style={{ marginTop: 20 }}>
        <h2 className="pp-h2">What this prototype is, and isn&apos;t</h2>
        <ul style={{ margin: "12px 0 0", paddingLeft: 22, display: "grid", gap: 8 }}>
          <li>It runs on PayPal Sandbox with test money, and no retailer order is placed.</li>
          <li>There are no user accounts yet. A browser session stands in for the user, and an agent key stands in for the agent. A real deployment would authenticate both.</li>
          <li>Each new hold still needs the buyer to approve it on PayPal.</li>
        </ul>
      </section>
    </AppShell>
  );
}
