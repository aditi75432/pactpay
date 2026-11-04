import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { ensureDatabase } from "./db";

/** Checkout Inspector verdicts are stored against the order, exact screenshot and server-side checkout revision. */
declare global {
  // eslint-disable-next-line no-var
  var pactPayInspectionSchemaPromise: Promise<void> | undefined;
}

export type StoredOutcome = "SAFE_TO_PAY" | "DO_NOT_PAY" | "CANNOT_VERIFY";
export interface StoredInspection {
  id: string;
  outcome: StoredOutcome;
  headline: string;
  createdAt: string;
  readers: unknown;
  inspection?: unknown;
  evidenceHash?: string | null;
  contextRevision?: number | null;
  reused?: boolean;
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
      ALTER TABLE pactpay_checkout_inspections ADD COLUMN IF NOT EXISTS evidence_hash TEXT;
      ALTER TABLE pactpay_checkout_inspections ADD COLUMN IF NOT EXISTS context_revision INTEGER;
      CREATE INDEX IF NOT EXISTS pactpay_checkout_inspections_tx_idx ON pactpay_checkout_inspections (transaction_id, created_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS pactpay_checkout_inspections_evidence_idx
        ON pactpay_checkout_inspections (transaction_id, context_revision, evidence_hash)
        WHERE evidence_hash IS NOT NULL AND context_revision IS NOT NULL;
    `).then(() => undefined).catch((error) => {
      global.pactPayInspectionSchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPayInspectionSchemaPromise;
}

type InspectionDbRow = {
  id: string;
  outcome: StoredOutcome;
  headline: string;
  created_at: string;
  inspection_json: unknown;
  readers_json: unknown;
  evidence_hash: string | null;
  context_revision: number | null;
};

function fromRow(row: InspectionDbRow, reused = false): StoredInspection {
  return {
    id: row.id, outcome: row.outcome, headline: row.headline, createdAt: row.created_at,
    inspection: row.inspection_json, readers: row.readers_json,
    evidenceHash: row.evidence_hash, contextRevision: row.context_revision, reused,
  };
}

async function findEvidenceOn(client: Pick<PoolClient, "query">, transactionId: string, evidenceHash: string, contextRevision: number): Promise<InspectionDbRow | null> {
  const result = await client.query<InspectionDbRow>(
    `SELECT id::text, outcome, headline, created_at::text, inspection_json, readers_json,
       evidence_hash, context_revision
     FROM pactpay_checkout_inspections
     WHERE transaction_id = $1 AND evidence_hash = $2 AND context_revision = $3
     ORDER BY created_at DESC LIMIT 1`,
    [transactionId, evidenceHash, contextRevision],
  );
  return result.rows[0] ?? null;
}


/** Exact evidence lookup. CANNOT_VERIFY is retryable; decisive outcomes are reused. */
export async function getCheckoutInspectionForEvidence(
  transactionId: string,
  evidenceHash: string,
  contextRevision: number,
): Promise<StoredInspection | null> {
  await ensureSchema();
  const row = await findEvidenceOn(pool(), transactionId, evidenceHash, contextRevision);
  return row ? fromRow(row, true) : null;
}


/**
 * Persist one result per exact transaction revision and screenshot. The transaction lock and unique index make
 * simultaneous duplicate requests converge. CANNOT_VERIFY may be upgraded by a fresh read; decisive results stay stable.
 */
export async function saveCheckoutInspection(input: {
  transactionId: string;
  sessionId: string;
  outcome: StoredOutcome;
  headline: string;
  inspection: unknown;
  readers: unknown;
  evidenceHash: string;
  contextRevision: number;
}): Promise<StoredInspection> {
  await ensureSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.transactionId]);
    const existing = await findEvidenceOn(client, input.transactionId, input.evidenceHash, input.contextRevision);
    if (existing && (existing.outcome === "DO_NOT_PAY" || (existing.outcome === "SAFE_TO_PAY" && input.outcome !== "DO_NOT_PAY"))) {
      // Never downgrade a block; a newly confirmed block may tighten an earlier safe verdict.
      await client.query("COMMIT");
      return fromRow(existing, true);
    }
    if (existing) {
      // Unverifiable is retryable, and a newly confirmed block can tighten an earlier safe result.
      // A fresh pair of reads can resolve uncertainty without allowing DO_NOT_PAY to become SAFE_TO_PAY.
      const updated = await client.query<InspectionDbRow>(
        `UPDATE pactpay_checkout_inspections
         SET outcome = $2, headline = $3, inspection_json = $4::jsonb, readers_json = $5::jsonb, created_at = NOW()
         WHERE id = $1
         RETURNING id::text, outcome, headline, created_at::text, inspection_json, readers_json, evidence_hash, context_revision`,
        [existing.id, input.outcome, input.headline.slice(0, 300), JSON.stringify(input.inspection), JSON.stringify(input.readers)],
      );
      await client.query("COMMIT");
      if (!updated.rows[0]) throw new Error("Checkout inspection retry could not be saved.");
      return fromRow(updated.rows[0], false);
    }

    const id = randomUUID();
    const inserted = await client.query<InspectionDbRow>(
      `INSERT INTO pactpay_checkout_inspections
         (id, transaction_id, session_id, outcome, headline, inspection_json, readers_json, evidence_hash, context_revision)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)
       ON CONFLICT (transaction_id, context_revision, evidence_hash)
         WHERE evidence_hash IS NOT NULL AND context_revision IS NOT NULL
       DO NOTHING
       RETURNING id::text, outcome, headline, created_at::text, inspection_json, readers_json, evidence_hash, context_revision`,
      [id, input.transactionId, input.sessionId, input.outcome, input.headline.slice(0, 300), JSON.stringify(input.inspection), JSON.stringify(input.readers), input.evidenceHash, input.contextRevision],
    );
    if (inserted.rows[0]) {
      await client.query("COMMIT");
      return fromRow(inserted.rows[0], false);
    }

    // Defensive fallback if another process won the unique-index race before our advisory lock was acquired.
    const winner = await findEvidenceOn(client, input.transactionId, input.evidenceHash, input.contextRevision);
    await client.query("COMMIT");
    if (!winner) throw new Error("Checkout inspection could not be persisted.");
    return fromRow(winner, true);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The most recent inspection for an order, or null when none was attached. */
export async function getLatestCheckoutInspection(transactionId: string): Promise<StoredInspection | null> {
  await ensureSchema();
  const result = await pool().query<InspectionDbRow>(
    `SELECT id::text, outcome, headline, created_at::text, inspection_json, readers_json,
       evidence_hash, context_revision
     FROM pactpay_checkout_inspections WHERE transaction_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [transactionId],
  );
  const row = result.rows[0];
  return row ? fromRow(row) : null;
}
