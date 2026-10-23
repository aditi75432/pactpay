import { Pool } from "pg";
import { ensureDatabase } from "./db";
import { isBlockingScenario, type SellerWorldEffect } from "@pactpay/pact-core/seller-world";

/**
 * Persistence for the simulated seller's state, scoped to one browser session. See
 * packages/pact-core/src/seller-world.ts for why this exists. Effects only ever make an offer LESS usable;
 * nothing here can create a pass.
 */
declare global {
  // eslint-disable-next-line no-var
  var pactPaySellerWorldSchemaPromise: Promise<void> | undefined;
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
  if (!global.pactPaySellerWorldSchemaPromise) {
    global.pactPaySellerWorldSchemaPromise = pool().query(`
      CREATE TABLE IF NOT EXISTS pactpay_seller_world (
        session_id CHAR(64) NOT NULL,
        offer_key TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (session_id, offer_key)
      );
    `).then(() => undefined).catch((error) => {
      global.pactPaySellerWorldSchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPaySellerWorldSchemaPromise;
}

/** A blocking scenario is remembered. BASELINE ("nothing changes") clears that offer's effect. */
export async function recordSellerWorldEffect(sessionId: string, offerKey: string, scenarioId: string): Promise<void> {
  await ensureSchema();
  const key = offerKey.toLowerCase();
  if (!isBlockingScenario(scenarioId)) {
    await pool().query("DELETE FROM pactpay_seller_world WHERE session_id = $1 AND offer_key = $2", [sessionId, key]);
    return;
  }
  await pool().query(
    `INSERT INTO pactpay_seller_world (session_id, offer_key, scenario_id) VALUES ($1, $2, $3)
     ON CONFLICT (session_id, offer_key) DO UPDATE SET scenario_id = EXCLUDED.scenario_id, applied_at = NOW()`,
    [sessionId, key, scenarioId],
  );
}

export async function listSellerWorld(sessionId: string): Promise<SellerWorldEffect[]> {
  await ensureSchema();
  const result = await pool().query<{ offer_key: string; scenario_id: string; applied_at: string }>(
    "SELECT offer_key, scenario_id, applied_at::text AS applied_at FROM pactpay_seller_world WHERE session_id = $1 ORDER BY applied_at DESC LIMIT 100",
    [sessionId],
  );
  return result.rows.map((row) => ({ offerKey: row.offer_key, scenarioId: row.scenario_id, appliedAt: row.applied_at }));
}

export async function clearSellerWorld(sessionId: string): Promise<number> {
  await ensureSchema();
  const result = await pool().query("DELETE FROM pactpay_seller_world WHERE session_id = $1", [sessionId]);
  return result.rowCount ?? 0;
}
