# ADR-009: Merchant Evidence Intake Requires Explicit Human Review

- **Status:** Accepted for the local prototype
- **Context:** Channel3 catalog data does not supply every fact needed to determine final payable total, shipping, destination-specific delivery, return window, or all product attributes. User-entered values must not silently become trusted evaluation inputs.
- **Decision:** Store each claim immutably, require an HTTPS source URL on the selected offer's merchant domain, apply conservative field-specific local TTLs, and store review events append-only. Only claims whose latest review event is `HUMAN_REVIEWED` are supplied to the deterministic evaluator; rejected and submitted-only claims are excluded.
- **Trust boundary:** Human review is an attestation, not independent authentication. The local prototype does not fetch merchant pages and does not authenticate reviewer identity. It must not be exposed publicly as a production trust service.
- **Consequences:** We gain traceable, attributable observations while preserving fail-closed semantics. Conflicting fresh reviewed claims remain conflicts, and missing/stale evidence remains unknown. The implementation stays payment-inert.
- **Follow-up:** Add real auth, evidence capture/provenance, stronger source authenticity, and a dedicated adversarial test suite before any public deployment or capture capability.
