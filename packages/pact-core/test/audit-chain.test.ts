import { describe, expect, it } from "vitest";
import {
  AUDIT_GENESIS_HASH,
  hashAuditEvent,
  sortAuditRowsById,
  verifyAuditRows,
  type AuditHashRow,
} from "../../../lib/audit-chain.js";
import { hashMerchantEvidence, verifyMerchantEvidenceHash } from "../../../lib/merchant-evidence-integrity.js";

function makeRows(): AuditHashRow[] {
  const firstBase = {
    id: "1",
    transactionId: "00000000-0000-4000-8000-000000000001",
    eventType: "TRANSACTION_CREATED",
    actor: "system",
    details: { amount: "1.00", currency: "USD" },
    createdAt: "2026-10-19T10:00:00.000Z",
    previousHash: AUDIT_GENESIS_HASH,
  };
  const firstHash = hashAuditEvent(firstBase);
  const secondBase = {
    id: "2",
    transactionId: firstBase.transactionId,
    eventType: "PAYPAL_ORDER_CREATED",
    actor: "paypal",
    details: { orderId: "ORDER-1" },
    createdAt: "2026-10-19T10:00:01.000Z",
    previousHash: firstHash,
  };
  const secondHash = hashAuditEvent(secondBase);

  return [
    {
      id: firstBase.id,
      transaction_id: firstBase.transactionId,
      event_type: firstBase.eventType,
      actor: firstBase.actor,
      details: firstBase.details,
      created_at: firstBase.createdAt,
      previous_hash: firstBase.previousHash,
      event_hash: firstHash,
    },
    {
      id: secondBase.id,
      transaction_id: secondBase.transactionId,
      event_type: secondBase.eventType,
      actor: secondBase.actor,
      details: secondBase.details,
      created_at: secondBase.createdAt,
      previous_hash: secondBase.previousHash,
      event_hash: secondHash,
    },
  ];
}

describe("transaction audit hash chain", () => {
  it("verifies a correctly chained event sequence", () => {
    const result = verifyAuditRows(makeRows());
    expect(result.valid).toBe(true);
    expect(result.eventCount).toBe(2);
    expect(result.firstInvalidEventId).toBeNull();
  });

  it("verifies a valid chain when database results arrive out of order", () => {
    const rows = makeRows();
    const result = verifyAuditRows([...rows].reverse());
    expect(result.valid).toBe(true);
    expect(result.lastHash).toBe(rows[1]!.event_hash);
  });

  it("sorts BIGSERIAL IDs numerically rather than lexicographically", () => {
    const rows = [{ id: "10" }, { id: "5" }, { id: "9" }, { id: "11" }];
    expect(sortAuditRowsById(rows).map((row) => row.id)).toEqual(["5", "9", "10", "11"]);
  });

  it("detects altered event content", () => {
    const rows = makeRows();
    rows[0]!.details = { amount: "9.99", currency: "USD" };
    const result = verifyAuditRows(rows);
    expect(result.valid).toBe(false);
    expect(result.firstInvalidEventId).toBe("1");
  });

  it("detects a broken previous-hash link", () => {
    const rows = makeRows();
    rows[1]!.previous_hash = AUDIT_GENESIS_HASH;
    const result = verifyAuditRows(rows);
    expect(result.valid).toBe(false);
    expect(result.firstInvalidEventId).toBe("2");
  });

  it("fails closed for an empty sequence", () => {
    const result = verifyAuditRows([]);
    expect(result.valid).toBe(false);
    expect(result.firstInvalidEventId).toBe("NO_AUDIT_EVENTS");
  });

  it("detects merchant-evidence content drift before policy evaluation", () => {
    const input = {
      id: "00000000-0000-4000-8000-000000000010",
      snapshotId: "00000000-0000-4000-8000-000000000011",
      field: "attributes.ramGb",
      value: 16,
      sourceUrl: "https://merchant.example/product",
      sourceDomain: "merchant.example",
      note: "Checked the spec table",
      observedAt: "2026-10-19T10:00:00.000Z",
      validUntil: "2026-10-19T10:05:00.000Z",
    };
    const contentHash = hashMerchantEvidence(input);
    const row = {
      id: input.id,
      snapshot_id: input.snapshotId,
      field: input.field,
      claim_value: input.value,
      source_url: input.sourceUrl,
      source_domain: input.sourceDomain,
      note: input.note,
      observed_at: input.observedAt,
      valid_until: input.validUntil,
      content_hash: contentHash,
    };
    expect(verifyMerchantEvidenceHash(row, input.snapshotId)).toBe(true);
    expect(verifyMerchantEvidenceHash({ ...row, claim_value: 8 }, input.snapshotId)).toBe(false);
    expect(verifyMerchantEvidenceHash(row, "00000000-0000-4000-8000-000000000099")).toBe(false);
  });
});
