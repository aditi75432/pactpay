import { Pool } from "pg";
import { ensureDatabase } from "./db";

/** Read-only joins used by the Activity console. Nothing here changes a payment or a decision. */
function pool(): Pool {
  const holder = globalThis as unknown as { pactPayPgPool?: Pool };
  if (!holder.pactPayPgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Missing required environment variable: DATABASE_URL");
    holder.pactPayPgPool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  }
  return holder.pactPayPgPool;
}

export interface ActivityContextRow {
  id: string;
  title: string | null;
  domain: string | null;
  scenario_id: string | null;
  security_finding: string | null;
  pact_json: { constraints?: Array<{ id: string; description?: string }> } | null;
  gate_verification: { verification?: { results?: Array<{ constraintId: string; status: string; severity?: string }>; evidenceFresh?: boolean; evidenceAttributable?: boolean; securityClear?: boolean } } | null;
}

export async function getActivityContexts(ids: string[]): Promise<Map<string, ActivityContextRow>> {
  const clean = ids.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (clean.length === 0) return new Map();
  await ensureDatabase();
  const result = await pool().query<ActivityContextRow>(
    `SELECT transaction_id::text AS id, baseline_offer->>'sourceTitle' AS title, baseline_offer->>'sourceDomain' AS domain,
            scenario_id, security_finding, pact_json, gate_verification
     FROM pactpay_purchase_contexts WHERE transaction_id = ANY($1::uuid[])`,
    [clean],
  );
  return new Map(result.rows.map((row) => [row.id, row]));
}

export async function getTransactionPactHash(transactionId: string): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(transactionId)) return null;
  await ensureDatabase();
  const result = await pool().query<{ pact_hash: string | null }>("SELECT BTRIM(pact_hash) AS pact_hash FROM pactpay_transactions WHERE id = $1", [transactionId]);
  return result.rows[0]?.pact_hash?.toLowerCase() ?? null;
}
