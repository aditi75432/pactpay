import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ensureDatabase } from "./db";

/**
 * Persistence for PactPay Guard checks (the browser extension's verdicts).
 *
 * Privacy by design: we store the merchant host, the page PATH (never the query string or fragment, which can
 * carry order ids and tokens), the verdict, the money picture and the findings. We never store screenshots or
 * page text. Quick Guard checks (no PactPay account key) are not stored at all.
 */
declare global {
  // eslint-disable-next-line no-var
  var pactPayGuardSchemaPromise: Promise<void> | undefined;
}

function pool(): Pool {
  const holder = globalThis as unknown as { pactPayPgPool?: Pool };
  if (!holder.pactPayPgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Missing required environment variable: DATABASE_URL");
    holder.pactPayPgPool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  }
  return holder.pactPayPgPool;
}

async function ensureSchema(): Promise<void> {
  await ensureDatabase();
  if (!global.pactPayGuardSchemaPromise) {
    global.pactPayGuardSchemaPromise = pool().query(`
      CREATE TABLE IF NOT EXISTS pactpay_guard_checks (
        id UUID PRIMARY KEY,
        session_id CHAR(64) NOT NULL,
        approval_id UUID,
        host TEXT NOT NULL,
        path TEXT NOT NULL,
        outcome TEXT NOT NULL,
        confidence TEXT NOT NULL,
        total NUMERIC(12,2),
        currency TEXT,
        fees NUMERIC(12,2),
        findings JSONB NOT NULL DEFAULT '[]'::jsonb,
        reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
        readers TEXT NOT NULL DEFAULT 'code',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS pactpay_guard_checks_session_idx ON pactpay_guard_checks (session_id, created_at DESC);
    `).then(() => undefined).catch((error) => {
      global.pactPayGuardSchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPayGuardSchemaPromise;
}

export interface GuardCheckRecord {
  sessionId: string;
  approvalId: string | null;
  host: string;
  path: string;
  outcome: "SAFE_TO_PAY" | "DO_NOT_PAY" | "CANNOT_VERIFY";
  confidence: "basic" | "cross-checked";
  total: number | null;
  currency: string | null;
  fees: number | null;
  findings: Array<{ kind: string; title: string; excerpt: string; how: string; blocking: boolean }>;
  reasons: string[];
  readers: string;
}

export interface GuardCheckRow {
  id: string;
  host: string;
  path: string;
  outcome: GuardCheckRecord["outcome"];
  confidence: GuardCheckRecord["confidence"];
  total: number | null;
  currency: string | null;
  fees: number | null;
  findings: GuardCheckRecord["findings"];
  reasons: string[];
  readers: string;
  createdAt: string;
}

/** Keeps only the host and path of a page URL. Query strings and fragments can hold order ids and tokens. */
export function safePageLocation(raw: unknown): { host: string; path: string } | null {
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return { host: url.host.slice(0, 120), path: url.pathname.slice(0, 160) };
  } catch {
    return null;
  }
}

export async function saveGuardCheck(record: GuardCheckRecord): Promise<string> {
  await ensureSchema();
  const id = randomUUID();
  await pool().query(
    `INSERT INTO pactpay_guard_checks (id, session_id, approval_id, host, path, outcome, confidence, total, currency, fees, findings, reasons, readers)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13)`,
    [id, record.sessionId, record.approvalId, record.host, record.path, record.outcome, record.confidence, record.total, record.currency, record.fees,
      JSON.stringify(record.findings.slice(0, 20)), JSON.stringify(record.reasons.slice(0, 20)), record.readers],
  );
  return id;
}

export async function listGuardChecks(sessionId: string, limit = 100): Promise<GuardCheckRow[]> {
  await ensureSchema();
  const result = await pool().query<{
    id: string; host: string; path: string; outcome: GuardCheckRow["outcome"]; confidence: GuardCheckRow["confidence"];
    total: string | null; currency: string | null; fees: string | null; findings: GuardCheckRow["findings"]; reasons: string[]; readers: string; created_at: Date;
  }>(
    `SELECT id::text, host, path, outcome, confidence, total::text, currency, fees::text, findings, reasons, readers, created_at
     FROM pactpay_guard_checks WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [sessionId, Math.min(Math.max(limit, 1), 500)],
  );
  return result.rows.map((row) => ({
    id: row.id, host: row.host, path: row.path, outcome: row.outcome, confidence: row.confidence,
    total: row.total === null ? null : Number(row.total), currency: row.currency, fees: row.fees === null ? null : Number(row.fees),
    findings: row.findings, reasons: row.reasons, readers: row.readers, createdAt: row.created_at.toISOString(),
  }));
}
