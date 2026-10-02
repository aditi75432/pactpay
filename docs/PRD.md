# PactPay PRD

## Product statement

PactPay is a control plane for AI agents that move money. It turns a user's natural-language commerce intent into an enforceable Purchase Pact and binds settlement to verified execution state.

## Primary user

A consumer or business user delegating a purchase to an AI agent.

## Primary problem

An AI agent can complete a technically valid transaction while the resulting purchase no longer satisfies the user's original economic constraints.

## MVP scenario

A user requests a product with hard constraints on price, attributes, delivery deadline, and returns. PactPay discovers offers, selects a compliant offer, creates a PayPal Sandbox order with `AUTHORIZE`, obtains authorization, simulates a fulfillment change, detects the violation, blocks capture, then verifies a corrected fulfillment and captures.

## Core surfaces

1. Mission composer — natural language intent.
2. Pact view — hard constraints, soft preferences, authority envelope.
3. Offer comparison — real Channel3 results.
4. Payment state — PayPal authorization vs capture.
5. Verification center — evidence and constraint-by-constraint results.
6. Pact Control Center — AG Grid transaction/audit console.
7. Scenario simulator — deterministic demo attacks.

## Out of scope for MVP

- production card storage
- real merchant fulfillment integrations
- real-money payments
- fake escrow claims
- autonomous refunds without explicit policy
- generalized marketplace checkout across arbitrary merchants
