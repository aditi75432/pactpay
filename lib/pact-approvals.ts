import { Pool } from "pg";
import type { PurchasePact } from "@pactpay/pact-core";
import { DEFAULT_AUTONOMY, parseAutonomy, type Autonomy } from "@pactpay/pact-core/autonomy";
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
  autonomy: Autonomy;
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
      ALTER TABLE pactpay_pact_approvals ADD COLUMN IF NOT EXISTS autonomy_mode TEXT NOT NULL DEFAULT 'ASK_ALWAYS';
      ALTER TABLE pactpay_pact_approvals ADD COLUMN IF NOT EXISTS autonomy_limit_usd NUMERIC(12,2);
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
  autonomy: Autonomy;
}): Promise<{ id: string; pactHash: string }> {
  await ensureSchema();
  const pactHash = hashCanonicalJson(args.pact);
  await pool().query(
    `INSERT INTO pactpay_pact_approvals (id, session_id, pact_hash, pact_json, original_intent, compiler, autonomy_mode, autonomy_limit_usd)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8)`,
    [args.id, args.sessionId, pactHash, JSON.stringify(args.pact), args.originalIntent, args.compiler, args.autonomy.mode, args.autonomy.limitUsd],
  );
  return { id: args.id, pactHash };
}

/** Loads an approval only if it belongs to the caller's session. */
export async function getPactApproval(sessionId: string, id: string): Promise<PactApprovalRow | null> {
  if (!isUuidLike(id)) return null;
  await ensureSchema();
  const result = await pool().query<Omit<PactApprovalRow, "autonomy"> & { autonomy_mode: string; autonomy_limit_usd: string | null }>(
    `SELECT id::text AS id, BTRIM(session_id) AS session_id, BTRIM(pact_hash) AS pact_hash, pact_json,
            original_intent, compiler, created_at::text AS created_at, autonomy_mode, autonomy_limit_usd::text AS autonomy_limit_usd
     FROM pactpay_pact_approvals WHERE id = $1 AND session_id = $2`,
    [id, sessionId],
  );
  const raw = result.rows[0] ?? null;
  if (!raw) return null;
  const { autonomy_mode, autonomy_limit_usd, ...rest } = raw;
  const row: PactApprovalRow = { ...rest, autonomy: parseAutonomy({ mode: autonomy_mode, limitUsd: autonomy_limit_usd === null ? null : Number(autonomy_limit_usd) }) };
  // Defense in depth: the stored Pact must still hash to the value recorded at approval time.
  if (hashCanonicalJson(row.pact_json) !== row.pact_hash.toLowerCase()) return null;
  return row;
}

export interface SessionScope {
  pactIds: Set<string>;
  pactHashes: Set<string>;
  /** Autonomy mode per approved pact hash, for the Control Center. */
  autonomyByHash: Map<string, Autonomy>;
}

/** The Pact ids and hashes this browser approved. Used to scope the Control Center. */
export async function getSessionScope(sessionId: string): Promise<SessionScope> {
  await ensureSchema();
  const result = await pool().query<{ pact_hash: string; pact_id: string | null; autonomy_mode: string; autonomy_limit_usd: string | null }>(
    `SELECT BTRIM(pact_hash) AS pact_hash, pact_json->>'id' AS pact_id, autonomy_mode, autonomy_limit_usd::text AS autonomy_limit_usd
     FROM pactpay_pact_approvals WHERE session_id = $1
     ORDER BY created_at DESC LIMIT 200`,
    [sessionId],
  );
  return {
    pactIds: new Set(result.rows.flatMap((row) => (row.pact_id ? [row.pact_id] : []))),
    pactHashes: new Set(result.rows.map((row) => row.pact_hash.toLowerCase())),
    autonomyByHash: new Map(result.rows.map((row) => [row.pact_hash.toLowerCase(), parseAutonomy({ mode: row.autonomy_mode, limitUsd: row.autonomy_limit_usd === null ? null : Number(row.autonomy_limit_usd) })])),
  };
}

/** The autonomy this browser chose for the Pact with this hash. Unknown or foreign hashes get the safest mode. */
export async function getAutonomyForPactHash(sessionId: string, pactHash: string): Promise<Autonomy> {
  await ensureSchema();
  const result = await pool().query<{ autonomy_mode: string; autonomy_limit_usd: string | null }>(
    `SELECT autonomy_mode, autonomy_limit_usd::text AS autonomy_limit_usd
     FROM pactpay_pact_approvals WHERE session_id = $1 AND pact_hash = $2 LIMIT 1`,
    [sessionId, pactHash.toLowerCase()],
  );
  const row = result.rows[0];
  if (!row) return DEFAULT_AUTONOMY;
  return parseAutonomy({ mode: row.autonomy_mode, limitUsd: row.autonomy_limit_usd === null ? null : Number(row.autonomy_limit_usd) });
}
