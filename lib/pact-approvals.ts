import { Pool } from "pg";
import type { PurchasePact } from "@pactpay/pact-core";
import { ensureDatabase } from "./db";
import { hashCanonicalJson } from "./audit-chain";

/**
 * Server-side Purchase Pact approvals.
 *
 * The browser used to carry the approved Pact and a client-side "approved" flag. That is not an
 * authorization boundary: anything able to call the API could submit a looser Pact. Now the Pact
 * is stored here when the user clicks Approve, bound to their anonymous session, and every
 * order-creating route accepts only an approval id. The agent and the browser can read the Pact
 * but cannot alter it after approval.
 */
export interface PactApprovalRow {
  id: string;
  session_id: string;
  pact_hash: string;
  pact_json: PurchasePact;
  original_intent: string | null;
  compiler: string | null;
  created_at: string;
}

declare global {
  // eslint-disable-next-line no-var
  var pactPayApprovalSchemaPromise: Promise<void> | undefined;
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
  if (!global.pactPayApprovalSchemaPromise) {
    global.pactPayApprovalSchemaPromise = pool().query(`
      CREATE TABLE IF NOT EXISTS pactpay_pact_approvals (
        id UUID PRIMARY KEY,
        session_id CHAR(64) NOT NULL,
        pact_hash CHAR(64) NOT NULL,
        pact_json JSONB NOT NULL,
        original_intent TEXT,
        compiler TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS pactpay_pact_approvals_session_idx
        ON pactpay_pact_approvals (session_id, created_at DESC);
    `).then(() => undefined).catch((error) => {
      global.pactPayApprovalSchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPayApprovalSchemaPromise;
}

export function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function createPactApproval(args: {
  id: string;
  sessionId: string;
  pact: PurchasePact;
  originalIntent: string | null;
  compiler: string | null;
}): Promise<{ id: string; pactHash: string }> {
  await ensureSchema();
  const pactHash = hashCanonicalJson(args.pact);
  await pool().query(
    `INSERT INTO pactpay_pact_approvals (id, session_id, pact_hash, pact_json, original_intent, compiler)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [args.id, args.sessionId, pactHash, JSON.stringify(args.pact), args.originalIntent, args.compiler],
  );
  return { id: args.id, pactHash };
}

/** Loads an approval only if it belongs to the caller's session. */
export async function getPactApproval(sessionId: string, id: string): Promise<PactApprovalRow | null> {
  if (!isUuidLike(id)) return null;
  await ensureSchema();
  const result = await pool().query<PactApprovalRow>(
    `SELECT id::text AS id, BTRIM(session_id) AS session_id, BTRIM(pact_hash) AS pact_hash, pact_json,
            original_intent, compiler, created_at::text AS created_at
     FROM pactpay_pact_approvals WHERE id = $1 AND session_id = $2`,
    [id, sessionId],
  );
  const row = result.rows[0] ?? null;
  if (!row) return null;
  // Defense in depth: the stored Pact must still hash to the value recorded at approval time.
  if (hashCanonicalJson(row.pact_json) !== row.pact_hash.toLowerCase()) return null;
  return row;
}

export interface SessionScope {
  pactIds: Set<string>;
  pactHashes: Set<string>;
}

/** The Pact ids and hashes this browser approved. Used to scope the Control Center. */
export async function getSessionScope(sessionId: string): Promise<SessionScope> {
  await ensureSchema();
  const result = await pool().query<{ pact_hash: string; pact_id: string | null }>(
    `SELECT BTRIM(pact_hash) AS pact_hash, pact_json->>'id' AS pact_id
     FROM pactpay_pact_approvals WHERE session_id = $1
     ORDER BY created_at DESC LIMIT 200`,
    [sessionId],
  );
  return {
    pactIds: new Set(result.rows.flatMap((row) => (row.pact_id ? [row.pact_id] : []))),
    pactHashes: new Set(result.rows.map((row) => row.pact_hash.toLowerCase())),
  };
}
