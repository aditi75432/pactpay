# Connecting an AI agent to PactPay

PactPay gives any agent a limited key tied to the rules a shopper approved. The agent can shop. It can't change the rules or override the settlement check.

## 1. Get a key

Approve your rules in the app, open **Connect your own AI agent** on the shortlist screen, and click **Create an agent key**. The key (`ppk_...`) is shown once, expires in 24 hours, and can be revoked. Only a SHA-256 hash is stored.

## 2a. Use it from an MCP client (Claude Desktop, Cursor, ...)

Add this to your client's MCP config (the app shows a copy-ready version with your key):

```json
{ "mcpServers": { "pactpay": {
  "command": "node",
  "args": ["scripts/mcp-server.mjs"],
  "env": { "PACTPAY_URL": "http://localhost:3000", "PACTPAY_AGENT_KEY": "ppk_..." }
} } }
```

Tools: `pactpay_get_rules`, `pactpay_shortlist`, `pactpay_hold_payment`, `pactpay_request_settlement`, `pactpay_order_status`. The server has no dependencies (`node scripts/mcp-server.mjs`).

## 2b. Or call the HTTP gateway

```bash
KEY=ppk_...
curl -s localhost:3000/api/agent/v1/rules -H "Authorization: Bearer $KEY"
curl -s localhost:3000/api/agent/v1/shortlist -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"query":"wireless mouse"}'
curl -s localhost:3000/api/agent/v1/hold      -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"snapshotId":"..."}'
curl -s localhost:3000/api/agent/v1/settle    -H "Authorization: Bearer $KEY" -H 'content-type: application/json' -d '{"transactionId":"..."}'
curl -s localhost:3000/api/agent/v1/orders/<transactionId> -H "Authorization: Bearer $KEY"
```

## What the server enforces

| Attack | Result |
|---|---|
| No key, a made-up key, an expired or revoked key | 401 |
| Change the rules or raise the agent's own autonomy | No such endpoint (404/405) |
| Settle above the user's limit, or when they chose "Ask me every time" | 403 `requiresHuman`. The gateway always acts as the agent, never as the user |
| Hold an offer that already failed (even after a fresh search) | 409 |
| Touch another user's order | 404 |
| Talk the gate into a capture | Not possible: a fixed function re-checks the live offer |

Prove it: `PACTPAY_AGENT_KEY=ppk_... pnpm agent:redteam` (add `--tx <transactionId>` to test the settlement limit on a held payment).

## What the agent cannot do alone

Each new hold must be approved by a person on PayPal. PactPay never skips that step.

## Honest limits

There are no user accounts in this prototype. A browser session stands in for the shopper, and an agent key stands in for the agent. A real deployment would authenticate the shopper, and anyone who can approve rules could create their own key, so the key protects the shopper's rules and money from the agent, not from the shopper's own session.
