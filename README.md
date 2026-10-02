# PactPay

**Intent-Bound, Evidence-Gated Settlement for Agentic Commerce**

PactPay is a research-grade full-stack prototype for agentic commerce. It compiles a user's natural-language purchase request into a structured Purchase Pact, discovers real offers, authorizes payment through PayPal Sandbox, verifies current commercial evidence against hard constraints, and only then permits capture through a deterministic settlement gate.

## Core invariant

> A settlement capture is permitted only when the payment is authorized, every hard pact constraint is satisfied, the evidence is sufficiently fresh and attributable, and no active security policy blocks execution.

Conceptually:

`CAPTURE => AUTHORIZED && POLICY_SATISFIED && EVIDENCE_VALID && EVIDENCE_FRESH && SECURITY_CLEAR`

## Planned stack

- Next.js 16.3.x + TypeScript
- Tailwind CSS + shadcn/ui
- PostgreSQL + Prisma
- PayPal Orders v2 / Authorization / Capture / Webhooks
- Gemini or OpenAI for intent compilation and semantic verification
- Channel3 for real product discovery
- AG Grid / AG Studio for the Pact Control Center
- Render for deployment

Next.js 16 requires Node.js 20.9+ and has Turbopack enabled by default. Pin patched versions before deployment.

## Repository structure

```text
apps/
  web/                 # Next.js application
packages/
  pact-core/           # Pure domain types + deterministic policy engine
  shared/              # Shared schemas/utilities

docs/
  PRD.md
  ARCHITECTURE.md
  THREAT_MODEL.md
  RESEARCH_PLAN.md
  MVP_SCOPE.md
  adr/

evals/                 # PactBench (added in Phase 2)
```

## Security rule

The LLM must never directly call PayPal capture. The model may produce a structured proposal. A deterministic policy engine produces the only settlement decision accepted by the PayPal adapter.

## Status

Phase 0 — architecture and domain foundation.
