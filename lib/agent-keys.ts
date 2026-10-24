import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { AGENT_KEY_TTL_MS, generateAgentKey, hashAgentKey, looksLikeAgentKey } from "@pactpay/pact-core/agent-key";
import { ensureDatabase } from "./db";

/** Persistence for agent keys. Only the SHA-256 hash of a key is stored; the key is shown once at creation. */
declare global {
  // eslint-disable-next-line no-var
  var pactPayAgentKeySchemaPromise: Promise<void> | undefined;
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
  if (!global.pactPayAgentKeySchemaPromise) {
    global.pactPayAgentKeySchemaPromise = pool().query(`
      CREATE TABLE IF NOT EXISTS pactpay_agent_keys (
        id UUID PRIMARY KEY,
        session_id CHAR(64) NOT NULL,
        approval_id UUID NOT NULL,
        key_hash CHAR(64) NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS pactpay_agent_keys_session_idx ON pactpay_agent_keys (session_id, approval_id);
    `).then(() => undefined).catch((error) => {
      global.pactPayAgentKeySchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPayAgentKeySchemaPromise;
}

/** Issues a new key for one approval and revokes any earlier active key for it. Returns the plaintext key once. */
export async function issueAgentKey(sessionId: string, approvalId: string): Promise<{ key: string; expiresAt: string }> {
  await ensureSchema();
  const key = generateAgentKey();
  const expiresAt = new Date(Date.now() + AGENT_KEY_TTL_MS);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE pactpay_agent_keys SET revoked_at = NOW() WHERE session_id = $1 AND approval_id = $2 AND revoked_at IS NULL", [sessionId, approvalId]);
    await client.query(
      "INSERT INTO pactpay_agent_keys (id, session_id, approval_id, key_hash, expires_at) VALUES ($1, $2, $3, $4, $5)",
      [randomUUID(), sessionId, approvalId, hashAgentKey(key), expiresAt.toISOString()],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { key, expiresAt: expiresAt.toISOString() };
}

/** Looks a presented key up by hash. Revoked or expired keys resolve to null. */
export async function resolveAgentKey(key: string): Promise<{ sessionId: string; approvalId: string } | null> {
  if (!looksLikeAgentKey(key)) return null;
  await ensureSchema();
  const result = await pool().query<{ session_id: string; approval_id: string }>(
    `UPDATE pactpay_agent_keys SET last_used_at = NOW()
     WHERE key_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
     RETURNING BTRIM(session_id) AS session_id, approval_id::text AS approval_id`,
    [hashAgentKey(key)],
  );
  const row = result.rows[0];
  return row ? { sessionId: row.session_id, approvalId: row.approval_id } : null;
}

export async function revokeAgentKeys(sessionId: string, approvalId: string): Promise<number> {
  await ensureSchema();
  const result = await pool().query("UPDATE pactpay_agent_keys SET revoked_at = NOW() WHERE session_id = $1 AND approval_id = $2 AND revoked_at IS NULL", [sessionId, approvalId]);
  return result.rowCount ?? 0;
}

export async function getAgentKeyStatus(sessionId: string, approvalId: string): Promise<{ active: boolean; createdAt: string | null; expiresAt: string | null; lastUsedAt: string | null }> {
  await ensureSchema();
  const result = await pool().query<{ created_at: string; expires_at: string; last_used_at: string | null }>(
    `SELECT created_at::text AS created_at, expires_at::text AS expires_at, last_used_at::text AS last_used_at
     FROM pactpay_agent_keys WHERE session_id = $1 AND approval_id = $2 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [sessionId, approvalId],
  );
  const row = result.rows[0];
  return row ? { active: true, createdAt: row.created_at, expiresAt: row.expires_at, lastUsedAt: row.last_used_at } : { active: false, createdAt: null, expiresAt: null, lastUsedAt: null };
}
