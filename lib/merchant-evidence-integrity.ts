import { createHash } from "node:crypto";

export interface MerchantEvidenceHashInput {
  id: string;
  snapshotId: string;
  field: string;
  value: string | number | boolean;
  sourceUrl: string;
  sourceDomain: string;
  note: string | null;
  observedAt: string;
  validUntil: string;
}

/**
 * Deterministic integrity hash for the exact user-submitted evidence record.
 * This detects content drift when the hash is not also rewritten; it is not a
 * digital signature and does not protect against a privileged DB writer.
 */
export function hashMerchantEvidence(input: MerchantEvidenceHashInput): string {
  const payload = {
    id: input.id,
    snapshotId: input.snapshotId,
    field: input.field,
    value: input.value,
    sourceUrl: input.sourceUrl,
    sourceDomain: input.sourceDomain,
    note: input.note,
    observedAt: input.observedAt,
    validUntil: input.validUntil,
  };
  return createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex");
}

function normalizeTimestamp(value: string): string | null {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Recompute a persisted evidence row's content hash before admitting it to policy evaluation. */
export function verifyMerchantEvidenceHash(row: {
  id: string;
  snapshot_id: string;
  field: string;
  claim_value: unknown;
  source_url: string;
  source_domain: string;
  note: string | null;
  observed_at: string;
  valid_until: string;
  content_hash: string;
}, expectedSnapshotId: string): boolean {
  if (row.snapshot_id !== expectedSnapshotId) return false;
  const value = row.claim_value;
  if (!(typeof value === "string" || typeof value === "number" || typeof value === "boolean")) return false;
  if (typeof value === "number" && !Number.isFinite(value)) return false;
  const observedAt = normalizeTimestamp(row.observed_at);
  const validUntil = normalizeTimestamp(row.valid_until);
  if (!observedAt || !validUntil) return false;
  let recomputed: string;
  try {
    recomputed = hashMerchantEvidence({
      id: row.id,
      snapshotId: row.snapshot_id,
      field: row.field,
      value,
      sourceUrl: row.source_url,
      sourceDomain: row.source_domain,
      note: row.note,
      observedAt,
      validUntil,
    });
  } catch {
    return false;
  }
  return /^[a-f0-9]{64}$/.test(row.content_hash) && recomputed === row.content_hash;
}
