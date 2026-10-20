import { createHash } from "node:crypto";

export const AUDIT_GENESIS_HASH = "0".repeat(64);

export interface AuditHashInput {
  id: string | number;
  transactionId: string;
  eventType: string;
  actor: string;
  details: unknown;
  createdAt: string | Date;
  previousHash: string;
}

export interface AuditHashRow {
  id: string | number;
  transaction_id: string;
  event_type: string;
  actor: string;
  details: unknown;
  created_at: string | Date;
  previous_hash: string | null;
  event_hash: string | null;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonicalJson(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function hashAuditEvent(input: AuditHashInput): string {
  const createdAt = input.createdAt instanceof Date
    ? input.createdAt.toISOString()
    : new Date(input.createdAt).toISOString();
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Audit timestamp is invalid.");
  return hashCanonicalJson({
    id: String(input.id),
    transactionId: input.transactionId,
    eventType: input.eventType,
    actor: input.actor,
    details: input.details ?? {},
    createdAt,
    previousHash: input.previousHash,
  });
}


/** Sort database audit IDs numerically, including BIGSERIAL IDs returned as strings.
 * Do not rely only on a caller's SQL ordering: settlement logic must use one stable chain order.
 */
export function sortAuditRowsById<T extends { id: string | number }>(rows: readonly T[]): T[] {
  const compareNumericStrings = (leftValue: string | number, rightValue: string | number): number => {
    const left = String(leftValue).trim();
    const right = String(rightValue).trim();
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const normalizedLeft = left.replace(/^0+(?=\d)/, "");
      const normalizedRight = right.replace(/^0+(?=\d)/, "");
      if (normalizedLeft.length !== normalizedRight.length) {
        return normalizedLeft.length - normalizedRight.length;
      }
      return normalizedLeft < normalizedRight ? -1 : normalizedLeft > normalizedRight ? 1 : 0;
    }
    return left.localeCompare(right);
  };
  return [...rows].sort((a, b) => compareNumericStrings(a.id, b.id));
}

export function verifyAuditRows(rows: AuditHashRow[]): {
  valid: boolean;
  eventCount: number;
  lastHash: string | null;
  firstInvalidEventId: string | null;
} {
  let previousHash = AUDIT_GENESIS_HASH;
  // A reversed/inconsistent query result must not produce a false integrity failure or a
  // mismatched settlement head. The BIGSERIAL ID is the canonical append order.
  const orderedRows = sortAuditRowsById(rows);
  for (const row of orderedRows) {
    const eventId = String(row.id);
    if (row.previous_hash !== previousHash || !row.event_hash) {
      return { valid: false, eventCount: rows.length, lastHash: previousHash, firstInvalidEventId: eventId };
    }
    let expected: string;
    try {
      expected = hashAuditEvent({
        id: row.id,
        transactionId: row.transaction_id,
        eventType: row.event_type,
        actor: row.actor,
        details: row.details ?? {},
        createdAt: row.created_at,
        previousHash,
      });
    } catch {
      return { valid: false, eventCount: rows.length, lastHash: previousHash, firstInvalidEventId: eventId };
    }
    if (expected !== row.event_hash) {
      return { valid: false, eventCount: rows.length, lastHash: previousHash, firstInvalidEventId: eventId };
    }
    previousHash = row.event_hash;
  }
  return {
    valid: rows.length > 0,
    eventCount: rows.length,
    lastHash: rows.length > 0 ? previousHash : null,
    firstInvalidEventId: rows.length > 0 ? null : "NO_AUDIT_EVENTS",
  };
}
