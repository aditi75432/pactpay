import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { ensureDatabase } from "./db";

/**
 * Checkout Inspector verdicts, stored against the order they were made for. The settlement gate reads the latest one
 * and refuses to capture unless it says SAFE_TO_PAY. An order with no inspection is decided by the other checks alone.
 */
declare global {
  // eslint-disable-next-line no-var
  var pactPayInspectionSchemaPromise: Promise<void> | undefined;
}

export type StoredOutcome = "SAFE_TO_PAY" | "DO_NOT_PAY" | "CANNOT_VERIFY";
export interface StoredInspection { id: string; outcome: StoredOutcome; headline: string; createdAt: string; readers: unknown }

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
  if (!global.pactPayInspectionSchemaPromise) {
    global.pactPayInspectionSchemaPromise = pool().query(`
      CREATE TABLE IF NOT EXISTS pactpay_checkout_inspections (
        id UUID PRIMARY KEY,
        transaction_id UUID NOT NULL,
        session_id CHAR(64) NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('SAFE_TO_PAY', 'DO_NOT_PAY', 'CANNOT_VERIFY')),
        headline TEXT NOT NULL,
        inspection_json JSONB NOT NULL,
        readers_json JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS pactpay_checkout_inspections_tx_idx ON pactpay_checkout_inspections (transaction_id, created_at DESC);
    `).then(() => undefined).catch((error) => {
      global.pactPayInspectionSchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPayInspectionSchemaPromise;
}

export async function saveCheckoutInspection(input: { transactionId: string; sessionId: string; outcome: StoredOutcome; headline: string; inspection: unknown; readers: unknown }): Promise<string> {
  await ensureSchema();
  const id = randomUUID();
  await pool().query(
    "INSERT INTO pactpay_checkout_inspections (id, transaction_id, session_id, outcome, headline, inspection_json, readers_json) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, input.transactionId, input.sessionId, input.outcome, input.headline.slice(0, 300), JSON.stringify(input.inspection), JSON.stringify(input.readers)],
  );
  return id;
}

/** The most recent inspection for an order, or null when none was attached. */
export async function getLatestCheckoutInspection(transactionId: string): Promise<StoredInspection | null> {
  await ensureSchema();
  const result = await pool().query<{ id: string; outcome: StoredOutcome; headline: string; created_at: string; readers_json: unknown }>(
    "SELECT id::text, outcome, headline, created_at::text, readers_json FROM pactpay_checkout_inspections WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1",
    [transactionId],
  );
  const row = result.rows[0];
  return row ? { id: row.id, outcome: row.outcome, headline: row.headline, createdAt: row.created_at, readers: row.readers_json } : null;
}
