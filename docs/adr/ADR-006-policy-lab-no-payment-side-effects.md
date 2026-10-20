# ADR-006: Policy Lab has no payment side effects

- Status: Accepted
- Date: 2026-10-19

## Context

The deterministic policy engine has unit coverage, but it is not yet exercised through the product's server/API/UI. Integrating it with a real payment mutation before the evidence model and failure paths are tested would create unnecessary settlement risk.

## Decision

Add a Policy Lab that evaluates a server-allowlisted set of deterministic simulated offers. Persist each run and expose constraint-level results in the UI. A passing decision must not trigger any PayPal API action.

## Consequences

- We can demo pass/block reasoning and evidence freshness/provenance in a real interactive web product.
- Scenario data is visibly labelled as simulated; no claims are made about live marketplace data.
- Later integration with a real product offer must bind the evaluated offer/order/amount and refresh authoritative evidence before any settlement capability is considered.
