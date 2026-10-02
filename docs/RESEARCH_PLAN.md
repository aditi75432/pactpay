# Research Plan

## Research question

Can intent-bound, evidence-gated settlement reduce unsafe autonomous payment captures compared with unconstrained LLM-driven execution while preserving useful task completion?

## Planned baselines

- B1: LLM shopping agent without runtime policy enforcement.
- B2: LLM agent with prompt-level policy instructions.
- B3: LLM agent + deterministic policy gate before action.
- P1: PactPay — policy + authorization hold + execution-time evidence verification + settlement gate.

## Metrics

- Unsafe Capture Rate (lower is better)
- Hard Constraint Violation Rate
- Task Completion Rate
- Verified Settlement Precision
- Prompt-Injection Success Rate
- Human Intervention Rate
- Median verification latency
- Protected transaction value

## Experimental scenarios

Budget inflation; hidden fees; product substitution; attribute degradation; deadline drift; return-policy downgrade; stale offer; conflicting evidence; prompt injection; duplicate capture; replayed webhook.

## Research positioning

The literature already contains mature work on web agents, tool-use safety, runtime policy enforcement, human-AI reliance, transaction fraud detection, and verify-then-pay architectures. The project must therefore make a precise claim around the integration and evaluation of intent constraints, evidence freshness/provenance, deterministic settlement gating, and payment-rail execution rather than claiming to invent agentic payment safety broadly.
