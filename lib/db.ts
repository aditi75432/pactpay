import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import {
  AUDIT_GENESIS_HASH,
  hashAuditEvent,
  hashCanonicalJson,
  sortAuditRowsById,
  verifyAuditRows,
  type AuditHashRow,
} from "./audit-chain";
import {
  assertSettlementTransition,
  type SettlementState,
} from "@pactpay/pact-core/settlement-state";

export type TransactionStatus =
  | "CREATING"
  | "ORDER_CREATED"
  | "AUTHORIZING"
  | "AUTHORIZED"
  | "AUTHORIZATION_REVIEW"
  | "VERIFYING"
  | "CAPTURE_ELIGIBLE"
  | "CAPTURING"
  | "CAPTURE_REVIEW"
  | "POLICY_BLOCKED"
  | "VOIDING"
  | "VOID_REVIEW"
  | "CAPTURED"
  | "VOIDED"
  | "CANCELLED"
  | "FAILED";

export interface PactPayTransaction {
  id: string;
  status: TransactionStatus;
  amount: string;
  currency: string;
  paypal_order_id: string | null;
  paypal_order_status: string | null;
  authorization_id: string | null;
  paypal_authorization_status: string | null;
  authorization_expires_at: string | null;
  create_request_id: string;
  authorize_request_id: string;
  offer_snapshot_id: string | null;
  policy_run_id: string | null;
  pact_hash: string | null;
  paypal_capture_id: string | null;
  paypal_capture_status: string | null;
  paypal_void_status: string | null;
  capture_origin: "PACTPAY_GATE" | "EXTERNAL_WEBHOOK" | null;
  capture_request_id: string | null;
  void_request_id: string | null;
  captured_at: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
  authorized_at: string | null;
  last_error_message: string | null;
}

export interface StoredProtectedDemoContext {
  transaction_id: string;
  mode: "DEMO_SIMULATOR";
  pact_json: Record<string, unknown>;
  pact_hash: string;
  baseline_offer: Record<string, unknown>;
  baseline_offer_hash: string;
  current_offer: Record<string, unknown>;
  scenario_id: string;
  security_finding: string | null;
  revision: number;
  gate_decision: "UNVERIFIED" | "PASS" | "BLOCK";
  gate_verification: Record<string, unknown> | null;
  gate_hash: string | null;
  gate_verified_at: string | null;
  gate_valid_until: string | null;
  created_at: string;
  updated_at: string;
}

declare global {
  // Reuse the connection pool across Next.js development hot reloads.
  // eslint-disable-next-line no-var
  var pactPayPgPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var pactPaySchemaPromise: Promise<void> | undefined;
  // Keeps the additive Evidence Desk schema idempotent across Next.js dev reloads.
  var pactPayEvidenceSchemaPromise: Promise<void> | undefined;
}

function getPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  if (!global.pactPayPgPool) {
    global.pactPayPgPool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return global.pactPayPgPool;
}

async function createSchema(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pactpay_transactions (
      id UUID PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN (
        'CREATING', 'ORDER_CREATED', 'AUTHORIZING', 'AUTHORIZED',
        'AUTHORIZATION_REVIEW', 'VERIFYING', 'CAPTURE_ELIGIBLE', 'CAPTURING',
        'CAPTURE_REVIEW', 'POLICY_BLOCKED', 'VOIDING', 'VOID_REVIEW',
        'CAPTURED', 'VOIDED', 'CANCELLED', 'FAILED'
      )),
      amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
      currency CHAR(3) NOT NULL DEFAULT 'USD',
      paypal_order_id TEXT UNIQUE,
      paypal_order_status TEXT,
      authorization_id TEXT UNIQUE,
      paypal_authorization_status TEXT,
      authorization_expires_at TIMESTAMPTZ,
      create_request_id UUID NOT NULL UNIQUE,
      authorize_request_id UUID NOT NULL UNIQUE,
      offer_snapshot_id UUID,
      policy_run_id UUID,
      pact_hash CHAR(64),
      paypal_capture_id TEXT UNIQUE,
      paypal_capture_status TEXT,
      paypal_void_status TEXT,
      capture_request_id UUID UNIQUE,
      void_request_id UUID UNIQUE,
      captured_at TIMESTAMPTZ,
      voided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      authorized_at TIMESTAMPTZ,
      last_error_message TEXT
    );
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS offer_snapshot_id UUID;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS policy_run_id UUID;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS pact_hash CHAR(64);
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS paypal_capture_id TEXT;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS paypal_capture_status TEXT;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS paypal_void_status TEXT;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS capture_request_id UUID;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS void_request_id UUID;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
    ALTER TABLE pactpay_transactions ADD COLUMN IF NOT EXISTS capture_origin TEXT;
    ALTER TABLE pactpay_transactions DROP CONSTRAINT IF EXISTS pactpay_transactions_status_check;
    ALTER TABLE pactpay_transactions ADD CONSTRAINT pactpay_transactions_status_check CHECK (status IN (
      'CREATING', 'ORDER_CREATED', 'AUTHORIZING', 'AUTHORIZED', 'AUTHORIZATION_REVIEW',
      'VERIFYING', 'CAPTURE_ELIGIBLE', 'CAPTURING', 'CAPTURE_REVIEW', 'POLICY_BLOCKED',
      'VOIDING', 'VOID_REVIEW', 'CAPTURED', 'VOIDED', 'CANCELLED', 'FAILED'
    ));

    CREATE TABLE IF NOT EXISTS pactpay_audit_events (
      id BIGSERIAL PRIMARY KEY,
      transaction_id UUID NOT NULL REFERENCES pactpay_transactions(id),
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      previous_hash TEXT,
      event_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE pactpay_audit_events ADD COLUMN IF NOT EXISTS previous_hash TEXT;
    ALTER TABLE pactpay_audit_events ADD COLUMN IF NOT EXISTS event_hash TEXT;
    CREATE INDEX IF NOT EXISTS pactpay_audit_events_tx_time_idx
      ON pactpay_audit_events(transaction_id, created_at);
    CREATE INDEX IF NOT EXISTS pactpay_audit_events_chain_idx
      ON pactpay_audit_events(transaction_id, id);

    CREATE TABLE IF NOT EXISTS pactpay_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      resource_id TEXT,
      related_order_id TEXT,
      related_authorization_id TEXT,
      transaction_id UUID REFERENCES pactpay_transactions(id),
      verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE pactpay_webhook_events
      ADD COLUMN IF NOT EXISTS related_authorization_id TEXT;

    CREATE TABLE IF NOT EXISTS pactpay_policy_runs (
      id UUID PRIMARY KEY,
      scenario_id TEXT NOT NULL,
      pact_id TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('capture', 'block')),
      decision_reason TEXT NOT NULL,
      security_clear BOOLEAN NOT NULL,
      evidence_fresh BOOLEAN NOT NULL,
      evidence_attributable BOOLEAN NOT NULL,
      offer_snapshot JSONB NOT NULL,
      verification_result JSONB NOT NULL,
      pact_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
      policy_hash CHAR(64),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE pactpay_policy_runs ADD COLUMN IF NOT EXISTS pact_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE pactpay_policy_runs ADD COLUMN IF NOT EXISTS policy_hash CHAR(64);
    CREATE INDEX IF NOT EXISTS pactpay_policy_runs_created_at_idx
      ON pactpay_policy_runs(created_at DESC);

    CREATE TABLE IF NOT EXISTS pactpay_channel3_offer_snapshots (
      id UUID PRIMARY KEY,
      search_query TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_title TEXT NOT NULL,
      description TEXT,
      brand TEXT,
      image_url TEXT,
      offer_domain TEXT NOT NULL,
      offer_url TEXT NOT NULL,
      price NUMERIC(14,2) NOT NULL CHECK (price >= 0),
      currency CHAR(3) NOT NULL,
      availability TEXT,
      condition TEXT,
      ram_gb NUMERIC(8,2),
      structured_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_product JSONB NOT NULL,
      raw_offer JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      valid_until TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS pactpay_channel3_snapshots_fetched_idx
      ON pactpay_channel3_offer_snapshots(fetched_at DESC);

    CREATE TABLE IF NOT EXISTS pactpay_channel3_refresh_checks (
      id UUID PRIMARY KEY,
      previous_snapshot_id UUID NOT NULL REFERENCES pactpay_channel3_offer_snapshots(id),
      refreshed_snapshot_id UUID REFERENCES pactpay_channel3_offer_snapshots(id),
      product_id TEXT NOT NULL,
      offer_domain TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('MATCHED', 'OFFER_NOT_FOUND')),
      previous_price NUMERIC(14,2) NOT NULL,
      previous_currency CHAR(3) NOT NULL,
      current_price NUMERIC(14,2),
      current_currency CHAR(3),
      changed_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      comparison JSONB NOT NULL,
      fetched_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pactpay_channel3_refresh_checks_created_idx
      ON pactpay_channel3_refresh_checks(created_at DESC);

    CREATE TABLE IF NOT EXISTS pactpay_purchase_contexts (
      transaction_id UUID PRIMARY KEY REFERENCES pactpay_transactions(id) ON DELETE CASCADE,
      mode TEXT NOT NULL CHECK (mode = 'DEMO_SIMULATOR'),
      pact_json JSONB NOT NULL,
      pact_hash CHAR(64) NOT NULL,
      baseline_offer JSONB NOT NULL,
      baseline_offer_hash CHAR(64) NOT NULL,
      current_offer JSONB NOT NULL,
      scenario_id TEXT NOT NULL,
      security_finding TEXT,
      revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
      gate_decision TEXT NOT NULL DEFAULT 'UNVERIFIED' CHECK (gate_decision IN ('UNVERIFIED', 'PASS', 'BLOCK')),
      gate_verification JSONB,
      gate_hash CHAR(64),
      gate_verified_at TIMESTAMPTZ,
      gate_valid_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pactpay_purchase_contexts_updated_idx
      ON pactpay_purchase_contexts(updated_at DESC);
  `);
}

async function migrateAuditHashChain(): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE pactpay_audit_events IN EXCLUSIVE MODE");
    const result = await client.query<AuditHashRow>(
      `SELECT id::text AS id, transaction_id::text AS transaction_id, event_type, actor, details,
         created_at::text AS created_at, previous_hash, event_hash
       FROM pactpay_audit_events ORDER BY transaction_id ASC, id ASC`,
    );
    const rowsMissingHashes = result.rows.filter((row) => !row.previous_hash || !row.event_hash);
    const allRowsUninitialized = result.rows.every((row) => !row.previous_hash && !row.event_hash);
    if (rowsMissingHashes.length > 0 && !allRowsUninitialized) {
      // Never silently recompute a partially populated chain: that could conceal a damaged or
      // manually edited event. Operators must investigate partial chains explicitly.
      throw new Error("Audit hash migration found a partially populated chain; refusing to rewrite existing hashes.");
    }
    if (rowsMissingHashes.length > 0) {
      // One-time backfill for legacy rows whose new hash columns are all NULL.
      let currentTransactionId = "";
      let previousHash = AUDIT_GENESIS_HASH;
      for (const row of result.rows) {
        if (row.transaction_id !== currentTransactionId) {
          currentTransactionId = row.transaction_id;
          previousHash = AUDIT_GENESIS_HASH;
        }
        const eventHash = hashAuditEvent({
          id: row.id,
          transactionId: row.transaction_id,
          eventType: row.event_type,
          actor: row.actor,
          details: row.details ?? {},
          createdAt: row.created_at,
          previousHash,
        });
        await client.query(
          `UPDATE pactpay_audit_events SET previous_hash = $2, event_hash = $3 WHERE id = $1`,
          [row.id, previousHash, eventHash],
        );
        previousHash = eventHash;
      }
    }
    await client.query("ALTER TABLE pactpay_audit_events ALTER COLUMN previous_hash SET NOT NULL");
    await client.query("ALTER TABLE pactpay_audit_events ALTER COLUMN event_hash SET NOT NULL");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function initializeDatabase(): Promise<void> {
  await createSchema();
  await migrateAuditHashChain();
}

export async function ensureDatabase(): Promise<void> {
  if (!global.pactPaySchemaPromise) {
    global.pactPaySchemaPromise = initializeDatabase().catch((error) => {
      global.pactPaySchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPaySchemaPromise;
}

async function audit(
  client: PoolClient,
  transactionId: string,
  eventType: string,
  actor: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  // Serialize audit appends for a transaction, even when a caller doesn't already hold the row lock.
  await client.query("SELECT id FROM pactpay_transactions WHERE id = $1 FOR UPDATE", [transactionId]);
  const previous = await client.query<AuditHashRow>(
    `SELECT id::text AS id, transaction_id::text AS transaction_id, event_type, actor, details,
       created_at::text AS created_at, previous_hash, event_hash
     FROM pactpay_audit_events WHERE transaction_id = $1 ORDER BY id ASC`,
    [transactionId],
  );
  const chain = verifyAuditRows(previous.rows);
  if (!chain.valid && previous.rows.length > 0) {
    throw new Error(`Refusing to append to an invalid audit chain (event ${chain.firstInvalidEventId}).`);
  }
  const previousHash = chain.lastHash ?? AUDIT_GENESIS_HASH;
  const sequence = await client.query<{ id: string }>(
    `SELECT nextval(pg_get_serial_sequence('pactpay_audit_events', 'id'))::text AS id`,
  );
  const eventId = sequence.rows[0]?.id;
  if (!eventId) throw new Error("Could not allocate audit event ID.");
  const createdAt = new Date();
  const eventHash = hashAuditEvent({
    id: eventId,
    transactionId,
    eventType,
    actor,
    details,
    createdAt,
    previousHash,
  });
  await client.query(
    `INSERT INTO pactpay_audit_events
      (id, transaction_id, event_type, actor, details, previous_hash, event_hash, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::timestamptz)`,
    [eventId, transactionId, eventType, actor, JSON.stringify(details), previousHash, eventHash, createdAt.toISOString()],
  );
}


/** Additive schema for manually submitted merchant-page observations and append-only review events. */
export async function ensureEvidenceSchema(): Promise<void> {
  await ensureDatabase();
  if (!global.pactPayEvidenceSchemaPromise) {
    global.pactPayEvidenceSchemaPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS pactpay_offer_evidence (
        id UUID PRIMARY KEY,
        snapshot_id UUID NOT NULL REFERENCES pactpay_channel3_offer_snapshots(id),
        field TEXT NOT NULL CHECK (field IN (
          'total', 'shippingFee', 'deliveryDate', 'returnWindowDays',
          'attributes.itemPrice', 'attributes.ramGb', 'attributes.condition', 'attributes.availability'
        )),
        claim_value JSONB NOT NULL,
        source_url TEXT NOT NULL,
        source_domain TEXT NOT NULL,
        note TEXT,
        observed_at TIMESTAMPTZ NOT NULL,
        valid_until TIMESTAMPTZ NOT NULL,
        content_hash CHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (valid_until > observed_at)
      );
      CREATE INDEX IF NOT EXISTS pactpay_offer_evidence_snapshot_time_idx
        ON pactpay_offer_evidence(snapshot_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS pactpay_offer_evidence_field_idx
        ON pactpay_offer_evidence(snapshot_id, field, observed_at DESC);

      CREATE TABLE IF NOT EXISTS pactpay_offer_evidence_reviews (
        id UUID PRIMARY KEY,
        evidence_id UUID NOT NULL REFERENCES pactpay_offer_evidence(id),
        decision TEXT NOT NULL CHECK (decision IN ('HUMAN_REVIEWED', 'REJECTED')),
        reviewer_label TEXT NOT NULL,
        source_inspected BOOLEAN NOT NULL DEFAULT FALSE,
        review_note TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS pactpay_offer_evidence_reviews_latest_idx
        ON pactpay_offer_evidence_reviews(evidence_id, created_at DESC, id DESC);
    `).then(() => undefined).catch((error) => {
      global.pactPayEvidenceSchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPayEvidenceSchemaPromise;
}


export async function createLocalTransaction(args: {
  id: string;
  amount: string;
  createRequestId: string;
  authorizeRequestId: string;
  /** Original immutable Channel3 snapshot used to prepare an offer-bound Sandbox test checkout. */
  offerSnapshotId?: string | null;
}): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO pactpay_transactions
        (id, status, amount, currency, create_request_id, authorize_request_id, offer_snapshot_id)
       VALUES ($1, 'CREATING', $2, 'USD', $3, $4, $5)`,
      [args.id, args.amount, args.createRequestId, args.authorizeRequestId, args.offerSnapshotId ?? null],
    );
    await audit(client, args.id, "TRANSACTION_CREATED", "system", {
      amount: args.amount,
      currency: "USD",
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function attachPayPalOrder(args: {
  transactionId: string;
  orderId: string;
  orderStatus: string;
}): Promise<void> {
  assertSettlementTransition("CREATING", "ORDER_CREATED");
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE pactpay_transactions
       SET status = 'ORDER_CREATED', paypal_order_id = $2,
           paypal_order_status = $3, updated_at = NOW(), last_error_message = NULL
       WHERE id = $1 AND status = 'CREATING'`,
      [args.transactionId, args.orderId, args.orderStatus],
    );
    if (result.rowCount !== 1) {
      throw new Error("Transaction could not be bound to the PayPal order.");
    }
    await audit(client, args.transactionId, "PAYPAL_ORDER_CREATED", "paypal", {
      paypalOrderId: args.orderId,
      paypalOrderStatus: args.orderStatus,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markTransactionFailed(transactionId: string, message: string): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE pactpay_transactions
       SET status = 'FAILED', updated_at = NOW(), last_error_message = $2
       WHERE id = $1 AND status IN ('CREATING', 'ORDER_CREATED')`,
      [transactionId, message.slice(0, 500)],
    );
    if (result.rowCount === 1) {
      await audit(client, transactionId, "TRANSACTION_FAILED", "system", {
        reason: message.slice(0, 300),
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markTransactionCancelled(transactionId: string): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE pactpay_transactions
       SET status = 'CANCELLED', updated_at = NOW()
       WHERE id = $1 AND status IN ('CREATING', 'ORDER_CREATED')`,
      [transactionId],
    );
    if (result.rowCount === 1) {
      await audit(client, transactionId, "BUYER_CANCELLED_CHECKOUT", "user");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getTransactionById(id: string): Promise<PactPayTransaction | null> {
  await ensureDatabase();
  const result = await getPool().query<PactPayTransaction>(
    `SELECT id, status, amount::text AS amount, currency,
       paypal_order_id, paypal_order_status, authorization_id,
       paypal_authorization_status,
       authorization_expires_at::text AS authorization_expires_at,
       create_request_id, authorize_request_id, offer_snapshot_id, policy_run_id, pact_hash,
       paypal_capture_id, paypal_capture_status, paypal_void_status, capture_origin, capture_request_id, void_request_id,
       captured_at::text AS captured_at, voided_at::text AS voided_at,
       created_at::text AS created_at, updated_at::text AS updated_at,
       authorized_at::text AS authorized_at, last_error_message
     FROM pactpay_transactions WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getTransactionByPayPalOrderId(orderId: string): Promise<PactPayTransaction | null> {
  await ensureDatabase();
  const result = await getPool().query<PactPayTransaction>(
    `SELECT id, status, amount::text AS amount, currency,
       paypal_order_id, paypal_order_status, authorization_id,
       paypal_authorization_status,
       authorization_expires_at::text AS authorization_expires_at,
       create_request_id, authorize_request_id, offer_snapshot_id, policy_run_id, pact_hash,
       paypal_capture_id, paypal_capture_status, paypal_void_status, capture_origin, capture_request_id, void_request_id,
       captured_at::text AS captured_at, voided_at::text AS voided_at,
       created_at::text AS created_at, updated_at::text AS updated_at,
       authorized_at::text AS authorized_at, last_error_message
     FROM pactpay_transactions WHERE paypal_order_id = $1`,
    [orderId],
  );
  return result.rows[0] ?? null;
}

export async function claimAuthorization(transactionId: string): Promise<boolean> {
  assertSettlementTransition("ORDER_CREATED", "AUTHORIZING");
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE pactpay_transactions
       SET status = 'AUTHORIZING', updated_at = NOW(), last_error_message = NULL
       WHERE id = $1 AND status = 'ORDER_CREATED'`,
      [transactionId],
    );
    if (result.rowCount === 1) {
      await audit(client, transactionId, "AUTHORIZATION_REQUESTED", "system");
    }
    await client.query("COMMIT");
    return result.rowCount === 1;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function recordAuthorizationSuccess(args: {
  transactionId: string;
  authorizationId: string;
  authorizationStatus: string;
  /** Top-level Orders API status returned by the authorize request, e.g. COMPLETED. */
  orderStatus: string | null;
  authorizationExpiresAt: string | null;
  amount: string;
  currency: string;
}): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const txResult = await client.query<{
      amount: string;
      currency: string;
      status: string;
      authorization_id: string | null;
      paypal_authorization_status: string | null;
      paypal_order_status: string | null;
    }>(
      `SELECT amount::text AS amount, currency, status, authorization_id,
         paypal_authorization_status, paypal_order_status
       FROM pactpay_transactions WHERE id = $1 FOR UPDATE`,
      [args.transactionId],
    );
    const tx = txResult.rows[0];
    if (!tx) throw new Error("Transaction not found while recording authorization.");

    // Retry-safe only when the repeated PayPal response is identical to the persisted result.
    // Never treat a different authorization ID or status as an idempotent duplicate.
    if (tx.status === "AUTHORIZED" || tx.status === "AUTHORIZATION_REVIEW") {
      const isExactDuplicate = tx.authorization_id === args.authorizationId &&
        tx.paypal_authorization_status === args.authorizationStatus &&
        tx.paypal_order_status === args.orderStatus &&
        Number(tx.amount).toFixed(2) === Number(args.amount).toFixed(2) &&
        tx.currency.trim() === args.currency;
      if (!isExactDuplicate) {
        throw new Error("Conflicting authorization response for a transaction that already recorded an authorization result.");
      }
      await client.query("COMMIT");
      return;
    }
    if (tx.status !== "AUTHORIZING") {
      throw new Error(`Cannot persist PayPal authorization from transaction state ${tx.status}.`);
    }

    const amountMatches = Number(tx.amount).toFixed(2) === Number(args.amount).toFixed(2);
    const currencyMatches = tx.currency.trim() === args.currency;
    const authorizationStatusMatches = args.authorizationStatus === "CREATED";
    const orderStatusMatches = args.orderStatus === "COMPLETED";
    const statusMatches = authorizationStatusMatches && orderStatusMatches;
    const nextStatus: TransactionStatus = amountMatches && currencyMatches && statusMatches
      ? "AUTHORIZED"
      : "AUTHORIZATION_REVIEW";
    assertSettlementTransition("AUTHORIZING", nextStatus as SettlementState);

    const updated = await client.query(
      `UPDATE pactpay_transactions
       SET status = $2, paypal_order_status = COALESCE($7, paypal_order_status),
           authorization_id = $3, paypal_authorization_status = $4,
           authorization_expires_at = $5, authorized_at = CASE WHEN $2 = 'AUTHORIZED' THEN NOW() ELSE authorized_at END,
           updated_at = NOW(),
           last_error_message = CASE WHEN $2 = 'AUTHORIZED' THEN NULL ELSE $6 END
       WHERE id = $1 AND status = 'AUTHORIZING'`,
      [
        args.transactionId,
        nextStatus,
        args.authorizationId,
        args.authorizationStatus,
        args.authorizationExpiresAt,
        `Authorization requires review: amountMatches=${amountMatches}, currencyMatches=${currencyMatches}, authorizationStatusMatches=${authorizationStatusMatches}, orderStatusMatches=${orderStatusMatches}`,
        args.orderStatus,
      ],
    );
    if (updated.rowCount !== 1) {
      throw new Error("Authorization state changed before the PayPal response could be persisted.");
    }
    await audit(client, args.transactionId, nextStatus === "AUTHORIZED" ? "PAYPAL_AUTHORIZED" : "AUTHORIZATION_REQUIRES_REVIEW", "paypal", {
      authorizationId: args.authorizationId,
      authorizationStatus: args.authorizationStatus,
      paypalOrderStatus: args.orderStatus,
      amount: args.amount,
      currency: args.currency,
      authorizationExpiresAt: args.authorizationExpiresAt,
      amountMatches,
      currencyMatches,
      statusMatches,
      authorizationStatusMatches,
      orderStatusMatches,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function resetAuthorizationForRetry(transactionId: string, message: string): Promise<void> {
  assertSettlementTransition("AUTHORIZING", "ORDER_CREATED");
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE pactpay_transactions
       SET status = 'ORDER_CREATED', updated_at = NOW(), last_error_message = $2
       WHERE id = $1 AND status = 'AUTHORIZING'`,
      [transactionId, message.slice(0, 500)],
    );
    if (result.rowCount === 1) {
      await audit(client, transactionId, "AUTHORIZATION_ATTEMPT_FAILED", "system", {
        reason: message.slice(0, 300),
      });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getAuditEvents(transactionId: string): Promise<Array<{
  id: string;
  event_type: string;
  actor: string;
  details: Record<string, unknown>;
  previous_hash: string;
  event_hash: string;
  created_at: string;
}>> {
  await ensureDatabase();
  const result = await getPool().query(
    `SELECT id::text AS id, event_type, actor, details, previous_hash, event_hash, created_at::text AS created_at
     FROM pactpay_audit_events WHERE transaction_id = $1 ORDER BY id ASC`,
    [transactionId],
  );
  return sortAuditRowsById(result.rows);
}

export async function verifyAuditChain(transactionId: string): Promise<{
  valid: boolean;
  eventCount: number;
  lastHash: string | null;
  firstInvalidEventId: string | null;
}> {
  await ensureDatabase();
  const result = await getPool().query<AuditHashRow>(
    `SELECT id::text AS id, transaction_id::text AS transaction_id, event_type, actor, details,
       created_at::text AS created_at, previous_hash, event_hash
     FROM pactpay_audit_events WHERE transaction_id = $1 ORDER BY id ASC`,
    [transactionId],
  );
  return verifyAuditRows(result.rows);
}


export interface PolicyRunSummaryRow {
  id: string;
  scenario_id: string;
  pact_id: string;
  decision: "capture" | "block";
  decision_reason: string;
  security_clear: boolean;
  evidence_fresh: boolean;
  evidence_attributable: boolean;
  created_at: string;
}

export async function recordPolicyRun(args: {
  id: string;
  scenarioId: string;
  pactId: string;
  decision: "capture" | "block";
  decisionReason: string;
  securityClear: boolean;
  evidenceFresh: boolean;
  evidenceAttributable: boolean;
  offerSnapshot: Record<string, unknown>;
  verificationResult: Record<string, unknown>;
  pactSnapshot: Record<string, unknown>;
}): Promise<void> {
  await ensureDatabase();
  const policyHash = hashCanonicalJson({
    id: args.id,
    scenarioId: args.scenarioId,
    pactSnapshot: args.pactSnapshot,
    offerSnapshot: args.offerSnapshot,
    verificationResult: args.verificationResult,
  });
  await getPool().query(
    `INSERT INTO pactpay_policy_runs
      (id, scenario_id, pact_id, decision, decision_reason, security_clear,
       evidence_fresh, evidence_attributable, offer_snapshot, verification_result, pact_snapshot, policy_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb, $12)`,
    [
      args.id,
      args.scenarioId,
      args.pactId,
      args.decision,
      args.decisionReason.slice(0, 500),
      args.securityClear,
      args.evidenceFresh,
      args.evidenceAttributable,
      JSON.stringify(args.offerSnapshot),
      JSON.stringify(args.verificationResult),
      JSON.stringify(args.pactSnapshot),
      policyHash,
    ],
  );
}

export async function listRecentPolicyRuns(limit = 20): Promise<PolicyRunSummaryRow[]> {
  await ensureDatabase();
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 50) : 20;
  const result = await getPool().query<PolicyRunSummaryRow>(
    `SELECT id, scenario_id, pact_id, decision, decision_reason, security_clear,
       evidence_fresh, evidence_attributable, created_at::text AS created_at
     FROM pactpay_policy_runs ORDER BY created_at DESC LIMIT $1`,
    [safeLimit],
  );
  return result.rows;
}


/** Detailed, read-only rows for the PactPay operator Control Center. */
export interface PolicyRunDetailRow extends PolicyRunSummaryRow {
  offer_snapshot: Record<string, unknown>;
  verification_result: Record<string, unknown>;
  pact_snapshot: Record<string, unknown>;
  policy_hash: string | null;
}

export async function listRecentPolicyRunDetails(limit = 50): Promise<PolicyRunDetailRow[]> {
  await ensureDatabase();
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const result = await getPool().query<PolicyRunDetailRow>(
    `SELECT id, scenario_id, pact_id, decision, decision_reason, security_clear,
       evidence_fresh, evidence_attributable, created_at::text AS created_at,
       offer_snapshot, verification_result, pact_snapshot, policy_hash
     FROM pactpay_policy_runs ORDER BY created_at DESC LIMIT $1`,
    [safeLimit],
  );
  return result.rows;
}

export interface TransactionControlRow {
  transaction_id: string;
  status: string;
  amount: string;
  currency: string;
  order_id: string | null;
  order_status: string | null;
  authorization_id: string | null;
  authorization_status: string | null;
  capture_id: string | null;
  capture_status: string | null;
  void_status: string | null;
  offer_snapshot_id: string | null;
  policy_run_id: string | null;
  pact_hash: string | null;
  capture_origin: string | null;
  created_at: string;
  authorized_at: string | null;
  captured_at: string | null;
  voided_at: string | null;
  last_error_message: string | null;
}

export async function listRecentTransactions(limit = 50): Promise<TransactionControlRow[]> {
  await ensureDatabase();
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  const result = await getPool().query<TransactionControlRow>(
    `SELECT id::text AS transaction_id, status, amount::text AS amount, BTRIM(currency) AS currency,
       paypal_order_id AS order_id, paypal_order_status AS order_status,
       authorization_id, paypal_authorization_status AS authorization_status,
       paypal_capture_id AS capture_id, paypal_capture_status AS capture_status,
       paypal_void_status AS void_status, offer_snapshot_id::text AS offer_snapshot_id,
       policy_run_id::text AS policy_run_id, pact_hash, capture_origin,
       created_at::text AS created_at, authorized_at::text AS authorized_at,
       captured_at::text AS captured_at, voided_at::text AS voided_at,
       last_error_message
     FROM pactpay_transactions ORDER BY created_at DESC LIMIT $1`,
    [safeLimit],
  );
  return result.rows;
}

export async function recordVerifiedWebhook(args: {
  eventId: string;
  eventType: string;
  resourceId: string | null;
  relatedOrderId: string | null;
  relatedAuthorizationId: string | null;
}): Promise<{ duplicate: boolean; transactionId: string | null }> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const transactionResult = await client.query<{ id: string; authorization_id: string | null; paypal_order_id: string | null; status: string }>(
      `SELECT id, authorization_id, paypal_order_id, status FROM pactpay_transactions
       WHERE ($1::text IS NOT NULL AND paypal_order_id = $1)
          OR ($2::text IS NOT NULL AND authorization_id = $2)
          OR ($3::text IS NOT NULL AND authorization_id = $3)
       LIMIT 1 FOR UPDATE`,
      [args.relatedOrderId, args.resourceId, args.relatedAuthorizationId],
    );
    const tx = transactionResult.rows[0] ?? null;
    const inserted = await client.query(
      `INSERT INTO pactpay_webhook_events
        (event_id, event_type, resource_id, related_order_id, related_authorization_id, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [args.eventId, args.eventType, args.resourceId, args.relatedOrderId, args.relatedAuthorizationId, tx?.id ?? null],
    );
    if (inserted.rowCount === 0) {
      await client.query("COMMIT");
      return { duplicate: true, transactionId: tx?.id ?? null };
    }

    if (tx) {
      await audit(client, tx.id, "PAYPAL_WEBHOOK_VERIFIED", "paypal", {
        eventId: args.eventId,
        eventType: args.eventType,
        resourceId: args.resourceId,
      });
      if (args.eventType === "PAYMENT.AUTHORIZATION.VOIDED" && tx.authorization_id === args.resourceId) {
        await client.query(
          `UPDATE pactpay_transactions SET status = 'VOIDED', paypal_authorization_status = 'VOIDED', updated_at = NOW()
           WHERE id = $1 AND status IN ('AUTHORIZED', 'AUTHORIZATION_REVIEW')`,
          [tx.id],
        );
        await audit(client, tx.id, "PAYPAL_AUTHORIZATION_VOIDED", "paypal", { authorizationId: args.resourceId });
      }
      if (
        args.eventType === "PAYMENT.CAPTURE.COMPLETED" &&
        (tx.authorization_id === args.relatedAuthorizationId || tx.paypal_order_id === args.relatedOrderId)
      ) {
        // Reflect a verified PayPal fact if a capture occurs outside PactPay. M0.1 exposes no capture endpoint.
        await client.query(
          `UPDATE pactpay_transactions SET status = 'CAPTURED', updated_at = NOW()
           WHERE id = $1 AND status IN ('AUTHORIZED', 'AUTHORIZATION_REVIEW')`,
          [tx.id],
        );
        await audit(client, tx.id, "PAYPAL_CAPTURE_REPORTED_BY_WEBHOOK", "paypal", {
          captureId: args.resourceId,
          relatedAuthorizationId: args.relatedAuthorizationId,
        });
      }
    }

    await client.query("COMMIT");
    return { duplicate: false, transactionId: tx?.id ?? null };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Store the approved simulator pact and exact baseline offer before the buyer is redirected to PayPal.
 * This context is separate from real Channel3 snapshots: the payment is a Sandbox demo, not a retailer order.
 */
export async function storeProtectedDemoContext(args: {
  transactionId: string;
  pact: Record<string, unknown>;
  pactHash: string;
  baselineOffer: Record<string, unknown>;
  baselineOfferHash: string;
  currentOffer: Record<string, unknown>;
  scenarioId: string;
  securityFinding: string | null;
}): Promise<void> {
  await ensureDatabase();
  const computedPactHash = hashCanonicalJson(args.pact);
  const computedBaselineHash = hashCanonicalJson(args.baselineOffer);
  const computedCurrentHash = hashCanonicalJson(args.currentOffer);
  if (!/^[a-f0-9]{64}$/i.test(args.pactHash) || args.pactHash !== computedPactHash ||
      !/^[a-f0-9]{64}$/i.test(args.baselineOfferHash) || args.baselineOfferHash !== computedBaselineHash ||
      computedCurrentHash !== computedBaselineHash) {
    throw new Error("Purchase Pact or baseline/current offer binding hash is invalid.");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tx = await client.query<{ status: string }>(
      "SELECT status FROM pactpay_transactions WHERE id = $1 FOR UPDATE",
      [args.transactionId],
    );
    if (tx.rows[0]?.status !== "CREATING") {
      throw new Error("Protected demo context must be bound before creating the PayPal order.");
    }
    await client.query(
      `INSERT INTO pactpay_purchase_contexts
        (transaction_id, mode, pact_json, pact_hash, baseline_offer, baseline_offer_hash, current_offer, scenario_id, security_finding, revision, gate_decision)
       VALUES ($1, 'DEMO_SIMULATOR', $2::jsonb, $3, $4::jsonb, $5, $6::jsonb, $7, $8, 1, 'UNVERIFIED')`,
      [args.transactionId, JSON.stringify(args.pact), args.pactHash, JSON.stringify(args.baselineOffer), args.baselineOfferHash,
        JSON.stringify(args.currentOffer), args.scenarioId, args.securityFinding],
    );
    const txUpdate = await client.query(
      `UPDATE pactpay_transactions SET pact_hash = $2, updated_at = NOW()
       WHERE id = $1 AND status = 'CREATING' AND pact_hash IS NULL`,
      [args.transactionId, args.pactHash],
    );
    if (txUpdate.rowCount !== 1) throw new Error("Transaction could not be bound to the approved Purchase Pact.");
    await audit(client, args.transactionId, "PURCHASE_PACT_APPROVED", "user-consent", {
      pactHash: args.pactHash,
      mode: "DEMO_SIMULATOR",
      explicitApproval: true,
      note: "Explicit approval of a controlled simulator purchase pact; not a real retailer order.",
    });
    await audit(client, args.transactionId, "PURCHASE_PACT_BOUND", "system", {
      pactHash: args.pactHash,
      baselineOfferHash: args.baselineOfferHash,
      currentOfferHash: computedCurrentHash,
      mode: "DEMO_SIMULATOR",
      scenarioId: args.scenarioId,
      revision: 1,
      authorityCanCapture: false,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getProtectedDemoContext(transactionId: string): Promise<StoredProtectedDemoContext | null> {
  await ensureDatabase();
  const result = await getPool().query<StoredProtectedDemoContext>(
    `SELECT transaction_id::text, mode, pact_json, pact_hash, baseline_offer, baseline_offer_hash, current_offer,
       scenario_id, security_finding, revision, gate_decision, gate_verification, gate_hash,
       gate_verified_at::text AS gate_verified_at, gate_valid_until::text AS gate_valid_until,
       created_at::text AS created_at, updated_at::text AS updated_at
     FROM pactpay_purchase_contexts WHERE transaction_id = $1`,
    [transactionId],
  );
  return result.rows[0] ?? null;
}

export async function updateProtectedDemoScenario(args: {
  transactionId: string;
  expectedRevision: number;
  scenarioId: string;
  currentOffer: Record<string, unknown>;
  securityFinding: string | null;
}): Promise<StoredProtectedDemoContext> {
  await ensureDatabase();
  const currentOfferHash = hashCanonicalJson(args.currentOffer);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const tx = await client.query<{ status: string; capture_request_id: string | null }>(
      "SELECT status, capture_request_id FROM pactpay_transactions WHERE id = $1 FOR UPDATE",
      [args.transactionId],
    );
    if (tx.rows[0]?.status !== "AUTHORIZED") {
      throw new Error("Simulator facts can change only while the protected Sandbox authorization is unsettled.");
    }
    const updated = await client.query(
      `UPDATE pactpay_purchase_contexts
       SET current_offer = $3::jsonb, scenario_id = $4, security_finding = $5,
           revision = revision + 1, gate_decision = 'UNVERIFIED', gate_verification = NULL,
           gate_hash = NULL, gate_verified_at = NULL, gate_valid_until = NULL, updated_at = NOW()
       WHERE transaction_id = $1 AND revision = $2
       RETURNING transaction_id`,
      [args.transactionId, args.expectedRevision, JSON.stringify(args.currentOffer), args.scenarioId, args.securityFinding],
    );
    if (updated.rowCount !== 1) throw new Error("Purchase context changed concurrently; refresh before retrying.");
    await audit(client, args.transactionId, "DEMO_SCENARIO_APPLIED", "simulator", {
      scenarioId: args.scenarioId,
      currentOfferHash,
      securityFindingPresent: Boolean(args.securityFinding),
      previousRevision: args.expectedRevision,
      nextRevision: args.expectedRevision + 1,
    });
    const result = await client.query<StoredProtectedDemoContext>(
      `SELECT transaction_id::text, mode, pact_json, pact_hash, baseline_offer, baseline_offer_hash, current_offer,
         scenario_id, security_finding, revision, gate_decision, gate_verification, gate_hash,
         gate_verified_at::text AS gate_verified_at, gate_valid_until::text AS gate_valid_until,
         created_at::text AS created_at, updated_at::text AS updated_at
       FROM pactpay_purchase_contexts WHERE transaction_id = $1`,
      [args.transactionId],
    );
    await client.query("COMMIT");
    if (!result.rows[0]) throw new Error("Purchase context disappeared after update.");
    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type ProtectedSettlementClaimResult =
  | { claimed: true; action: "CAPTURE" | "VOID"; authorizationId: string; requestId: string; amount: string; currency: string }
  | { claimed: false; reason: "NOT_FOUND" | "WRONG_STATE" | "REVISION_CHANGED" | "AUDIT_HEAD_CHANGED" | "EVIDENCE_EXPIRED" | "IN_PROGRESS" | "TERMINAL" };

export async function claimProtectedSettlementAction(args: {
  transactionId: string;
  expectedRevision: number;
  decision: "PASS" | "BLOCK";
  reason: string;
  policyRunId: string;
  verification: Record<string, unknown>;
  expectedPactHash: string;
  expectedAuditHeadHash: string;
  gateHash: string;
  gateValidUntil: string;
}): Promise<ProtectedSettlementClaimResult> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const txResult = await client.query<{
      status: TransactionStatus;
      authorization_id: string | null;
      amount: string;
      currency: string;
      capture_request_id: string | null;
      void_request_id: string | null;
      pact_hash: string | null;
    }>(
      `SELECT status, authorization_id, amount::text AS amount, currency,
         capture_request_id, void_request_id, pact_hash
       FROM pactpay_transactions WHERE id = $1 FOR UPDATE`,
      [args.transactionId],
    );
    const tx = txResult.rows[0];
    if (!tx) { await client.query("ROLLBACK"); return { claimed: false, reason: "NOT_FOUND" }; }
    if (["CAPTURED", "VOIDED", "CANCELLED", "FAILED"].includes(tx.status)) {
      await client.query("COMMIT");
      return { claimed: false, reason: "TERMINAL" };
    }
    if (["CAPTURING", "VOIDING", "CAPTURE_REVIEW", "VOID_REVIEW", "POLICY_BLOCKED"].includes(tx.status)) {
      await client.query("COMMIT");
      return { claimed: false, reason: "IN_PROGRESS" };
    }
    if (tx.status !== "AUTHORIZED" || !tx.authorization_id) {
      await client.query("COMMIT");
      return { claimed: false, reason: "WRONG_STATE" };
    }
    const contextResult = await client.query<{ revision: number; pact_hash: string }>(
      `SELECT revision, pact_hash FROM pactpay_purchase_contexts WHERE transaction_id = $1 FOR UPDATE`,
      [args.transactionId],
    );
    const context = contextResult.rows[0];
    if (!context) { await client.query("ROLLBACK"); return { claimed: false, reason: "WRONG_STATE" }; }
    if (context.revision !== args.expectedRevision) {
      await client.query("COMMIT");
      return { claimed: false, reason: "REVISION_CHANGED" };
    }
    const latestAudit = await client.query<{ event_hash: string }>(
      "SELECT event_hash FROM pactpay_audit_events WHERE transaction_id = $1 ORDER BY id DESC LIMIT 1",
      [args.transactionId],
    );
    const auditHead = latestAudit.rows[0]?.event_hash?.trim() ?? null;
    if (!auditHead || auditHead !== args.expectedAuditHeadHash.trim()) {
      await client.query("COMMIT");
      return { claimed: false, reason: "AUDIT_HEAD_CHANGED" };
    }
    if (!/^[a-f0-9]{64}$/i.test(args.gateHash) || !/^[a-f0-9]{64}$/i.test(args.expectedPactHash) ||
        context.pact_hash.trim().toLowerCase() !== args.expectedPactHash.toLowerCase() ||
        tx.pact_hash?.trim().toLowerCase() !== args.expectedPactHash.toLowerCase()) {
      await client.query("ROLLBACK");
      throw new Error("Persisted pact binding hash does not match the settlement request.");
    }
    if (args.decision === "PASS") {
      const expiryResult = await client.query<{ fresh: boolean }>("SELECT $1::timestamptz > NOW() AS fresh", [args.gateValidUntil]);
      if (!expiryResult.rows[0]?.fresh) {
        await client.query("COMMIT");
        return { claimed: false, reason: "EVIDENCE_EXPIRED" };
      }
    }

    const action: "CAPTURE" | "VOID" = args.decision === "PASS" ? "CAPTURE" : "VOID";
    let captureRequestId = tx.capture_request_id;
    let voidRequestId = tx.void_request_id;
    if (!captureRequestId || !voidRequestId) {
      const generatedCaptureId = captureRequestId ?? randomUUID();
      const generatedVoidId = voidRequestId ?? randomUUID();
      await client.query(
        `UPDATE pactpay_transactions SET capture_request_id = $2, void_request_id = $3 WHERE id = $1`,
        [args.transactionId, generatedCaptureId, generatedVoidId],
      );
      captureRequestId = generatedCaptureId;
      voidRequestId = generatedVoidId;
    }
    await client.query(
      `UPDATE pactpay_purchase_contexts
       SET gate_decision = $2, gate_verification = $3::jsonb, gate_hash = $4,
           gate_verified_at = NOW(), gate_valid_until = $5::timestamptz, updated_at = NOW()
       WHERE transaction_id = $1`,
      [args.transactionId, args.decision, JSON.stringify(args.verification), args.gateHash, args.gateValidUntil],
    );
    await client.query(
      `UPDATE pactpay_transactions SET status = 'VERIFYING', policy_run_id = $2, updated_at = NOW() WHERE id = $1 AND status = 'AUTHORIZED'`,
      [args.transactionId, args.policyRunId],
    );
    assertSettlementTransition("AUTHORIZED", "VERIFYING");
    await audit(client, args.transactionId, "SETTLEMENT_GATE_EVALUATED", "policy-engine", {
      decision: args.decision, reason: args.reason, gateHash: args.gateHash,
      policyRunId: args.policyRunId, revision: args.expectedRevision,
    });
    if (action === "CAPTURE") {
      assertSettlementTransition("VERIFYING", "CAPTURE_ELIGIBLE");
      assertSettlementTransition("CAPTURE_ELIGIBLE", "CAPTURING");
      await client.query(`UPDATE pactpay_transactions SET status = 'CAPTURE_ELIGIBLE', updated_at = NOW() WHERE id = $1 AND status = 'VERIFYING'`, [args.transactionId]);
      await audit(client, args.transactionId, "SETTLEMENT_GATE_PASSED", "policy-engine", { reason: args.reason, gateHash: args.gateHash, revision: args.expectedRevision });
      await client.query(`UPDATE pactpay_transactions SET status = 'CAPTURING', updated_at = NOW() WHERE id = $1 AND status = 'CAPTURE_ELIGIBLE'`, [args.transactionId]);
      await audit(client, args.transactionId, "PAYPAL_CAPTURE_REQUESTED", "settlement-gate", { authorizationId: tx.authorization_id, requestId: captureRequestId });
    } else {
      assertSettlementTransition("VERIFYING", "POLICY_BLOCKED");
      assertSettlementTransition("POLICY_BLOCKED", "VOIDING");
      await client.query(`UPDATE pactpay_transactions SET status = 'POLICY_BLOCKED', updated_at = NOW() WHERE id = $1 AND status = 'VERIFYING'`, [args.transactionId]);
      await audit(client, args.transactionId, "SETTLEMENT_GATE_BLOCKED", "policy-engine", { reason: args.reason, gateHash: args.gateHash, revision: args.expectedRevision });
      await client.query(`UPDATE pactpay_transactions SET status = 'VOIDING', updated_at = NOW() WHERE id = $1 AND status = 'POLICY_BLOCKED'`, [args.transactionId]);
      await audit(client, args.transactionId, "PAYPAL_VOID_REQUESTED", "settlement-gate", { authorizationId: tx.authorization_id, requestId: voidRequestId });
    }
    await client.query("COMMIT");
    return {
      claimed: true, action, authorizationId: tx.authorization_id,
      requestId: action === "CAPTURE" ? captureRequestId! : voidRequestId!, amount: tx.amount, currency: tx.currency.trim(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeProtectedCapture(args: {
  transactionId: string;
  captureId: string;
  captureStatus: string;
  amount: string | null;
  currency: string | null;
  /** Present only when reconciling a completed capture from fresh PayPal GET responses. */
  reconciliation?: { orderId: string; authorizationId: string };
}): Promise<{ status: TransactionStatus; amountMatches: boolean; currencyMatches: boolean }> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: TransactionStatus; amount: string; currency: string; paypal_capture_id: string | null }>(
      `SELECT status, amount::text AS amount, currency, paypal_capture_id FROM pactpay_transactions WHERE id = $1 FOR UPDATE`,
      [args.transactionId],
    );
    const tx = result.rows[0];
    if (!tx) throw new Error("Transaction not found after PayPal capture.");
    const amountMatches = args.amount !== null && Number(tx.amount).toFixed(2) === Number(args.amount).toFixed(2);
    const currencyMatches = args.currency !== null && tx.currency.trim() === args.currency.trim();
    if (tx.status === "CAPTURED") {
      if (tx.paypal_capture_id !== args.captureId || !amountMatches || !currencyMatches || args.captureStatus !== "COMPLETED") {
        throw new Error("Repeated PayPal capture response conflicts with the persisted capture.");
      }
      await client.query("COMMIT");
      return { status: "CAPTURED", amountMatches, currencyMatches };
    }
    if (tx.status !== "CAPTURING" && tx.status !== "CAPTURE_REVIEW") throw new Error(`Cannot record capture from state ${tx.status}.`);
    if (args.captureStatus === "COMPLETED" && args.captureId && amountMatches && currencyMatches) {
      assertSettlementTransition(tx.status, "CAPTURED");
      await client.query(
        `UPDATE pactpay_transactions SET status = 'CAPTURED', paypal_capture_id = $2, paypal_capture_status = $3,
           capture_origin = 'PACTPAY_GATE', captured_at = NOW(), paypal_authorization_status = 'CAPTURED',
           updated_at = NOW(), last_error_message = NULL WHERE id = $1`,
        [args.transactionId, args.captureId, args.captureStatus],
      );
      await audit(
        client,
        args.transactionId,
        args.reconciliation ? "PAYPAL_CAPTURE_RECONCILED" : "PAYPAL_CAPTURE_COMPLETED",
        args.reconciliation ? "reconciliation" : "paypal",
        {
          captureId: args.captureId,
          amount: args.amount,
          currency: args.currency,
          captureOrigin: "PACTPAY_GATE",
          ...(args.reconciliation ? {
            orderId: args.reconciliation.orderId,
            authorizationId: args.reconciliation.authorizationId,
            verifiedFromPayPalReadOnlyResources: true,
          } : {}),
        },
      );
      await client.query("COMMIT");
      return { status: "CAPTURED", amountMatches, currencyMatches };
    }
    assertSettlementTransition(tx.status, "CAPTURE_REVIEW");
    await client.query(
      `UPDATE pactpay_transactions SET status = 'CAPTURE_REVIEW', paypal_capture_id = $2, paypal_capture_status = $3,
         updated_at = NOW(), last_error_message = $4 WHERE id = $1`,
      [args.transactionId, args.captureId || null, args.captureStatus, `PayPal capture needs reconciliation: status=${args.captureStatus}, amountMatches=${amountMatches}, currencyMatches=${currencyMatches}`],
    );
    await audit(client, args.transactionId, "PAYPAL_CAPTURE_REQUIRES_RECONCILIATION", "paypal", {
      captureId: args.captureId || null, captureStatus: args.captureStatus, amountMatches, currencyMatches,
    });
    await client.query("COMMIT");
    return { status: "CAPTURE_REVIEW", amountMatches, currencyMatches };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeProtectedVoid(transactionId: string): Promise<TransactionStatus> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: TransactionStatus }>(
      "SELECT status FROM pactpay_transactions WHERE id = $1 FOR UPDATE", [transactionId],
    );
    const status = result.rows[0]?.status;
    if (!status) throw new Error("Transaction not found after PayPal void.");
    if (status === "VOIDED") { await client.query("COMMIT"); return "VOIDED"; }
    if (status !== "VOIDING" && status !== "VOID_REVIEW") throw new Error(`Cannot record void from state ${status}.`);
    assertSettlementTransition(status, "VOIDED");
    await client.query(
      `UPDATE pactpay_transactions SET status = 'VOIDED', paypal_void_status = 'VOIDED',
         paypal_authorization_status = 'VOIDED', voided_at = NOW(), updated_at = NOW(), last_error_message = NULL
       WHERE id = $1`,
      [transactionId],
    );
    await audit(client, transactionId, "PAYPAL_AUTHORIZATION_VOIDED", "paypal", { authorizationStatus: "VOIDED" });
    await client.query("COMMIT");
    return "VOIDED";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markProtectedSettlementUncertain(args: {
  transactionId: string;
  action: "CAPTURE" | "VOID";
  message: string;
}): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ status: TransactionStatus }>(
      "SELECT status FROM pactpay_transactions WHERE id = $1 FOR UPDATE", [args.transactionId],
    );
    const status = result.rows[0]?.status;
    if (!status) throw new Error("Transaction not found while recording settlement uncertainty.");
    const expected = args.action === "CAPTURE" ? "CAPTURING" : "VOIDING";
    const review = args.action === "CAPTURE" ? "CAPTURE_REVIEW" : "VOID_REVIEW";
    if (status === "CAPTURED" || status === "VOIDED") { await client.query("COMMIT"); return; }
    if (status !== expected && status !== review) throw new Error(`Cannot record settlement uncertainty from state ${status}.`);
    if (status === expected) assertSettlementTransition(status, review);
    await client.query(
      `UPDATE pactpay_transactions SET status = $2, updated_at = NOW(), last_error_message = $3 WHERE id = $1`,
      [args.transactionId, review, args.message.slice(0, 500)],
    );
    await audit(client, args.transactionId, `${args.action}_OUTCOME_UNCERTAIN`, "system", {
      action: args.action, reason: args.message.slice(0, 300), manualReconciliationRequired: true,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}


export interface Channel3OfferSnapshotInput {
  id: string;
  searchQuery: string;
  productId: string;
  productTitle: string;
  description: string | null;
  brand: string | null;
  imageUrl: string | null;
  offerDomain: string;
  offerUrl: string;
  price: number;
  currency: string;
  availability: string | null;
  condition: string | null;
  ramGb: number | null;
  structuredAttributes: Record<string, unknown>;
  rawProduct: Record<string, unknown>;
  rawOffer: Record<string, unknown>;
  fetchedAt: string;
  validUntil: string;
}

export interface Channel3OfferSnapshotRow {
  id: string;
  search_query: string;
  product_id: string;
  product_title: string;
  description: string | null;
  brand: string | null;
  image_url: string | null;
  offer_domain: string;
  offer_url: string;
  price: string;
  currency: string;
  availability: string | null;
  condition: string | null;
  ram_gb: string | null;
  structured_attributes: Record<string, unknown>;
  raw_product: Record<string, unknown>;
  raw_offer: Record<string, unknown>;
  fetched_at: string;
  valid_until: string;
}

export async function storeChannel3OfferSnapshots(rows: Channel3OfferSnapshotInput[]): Promise<void> {
  if (rows.length === 0) return;
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO pactpay_channel3_offer_snapshots
          (id, search_query, product_id, product_title, description, brand, image_url,
           offer_domain, offer_url, price, currency, availability, condition, ram_gb,
           structured_attributes, raw_product, raw_offer, fetched_at, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15::jsonb, $16::jsonb, $17::jsonb, $18::timestamptz, $19::timestamptz)`,
        [
          row.id, row.searchQuery, row.productId, row.productTitle, row.description, row.brand,
          row.imageUrl, row.offerDomain, row.offerUrl, row.price, row.currency, row.availability,
          row.condition, row.ramGb, JSON.stringify(row.structuredAttributes), JSON.stringify(row.rawProduct),
          JSON.stringify(row.rawOffer), row.fetchedAt, row.validUntil,
        ],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getChannel3OfferSnapshot(id: string): Promise<Channel3OfferSnapshotRow | null> {
  await ensureDatabase();
  const result = await getPool().query<Channel3OfferSnapshotRow>(
    `SELECT id, search_query, product_id, product_title, description, brand, image_url,
       offer_domain, offer_url, price::text AS price, currency, availability, condition,
       ram_gb::text AS ram_gb, structured_attributes, raw_product, raw_offer,
       fetched_at::text AS fetched_at, valid_until::text AS valid_until
     FROM pactpay_channel3_offer_snapshots WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}


export interface Channel3RefreshCheckInput {
  id: string;
  previousSnapshotId: string;
  refreshedSnapshot: Channel3OfferSnapshotInput | null;
  productId: string;
  offerDomain: string;
  status: "MATCHED" | "OFFER_NOT_FOUND";
  previousPrice: number;
  previousCurrency: string;
  currentPrice: number | null;
  currentCurrency: string | null;
  changedFields: string[];
  comparison: Record<string, unknown>;
  fetchedAt: string;
}

/** Persist the new immutable snapshot, if matched, and its comparison atomically. */
export async function storeChannel3RefreshCheck(args: Channel3RefreshCheckInput): Promise<void> {
  await ensureDatabase();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (args.refreshedSnapshot) {
      const row = args.refreshedSnapshot;
      await client.query(
        `INSERT INTO pactpay_channel3_offer_snapshots
          (id, search_query, product_id, product_title, description, brand, image_url,
           offer_domain, offer_url, price, currency, availability, condition, ram_gb,
           structured_attributes, raw_product, raw_offer, fetched_at, valid_until)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15::jsonb, $16::jsonb, $17::jsonb, $18::timestamptz, $19::timestamptz)`,
        [
          row.id, row.searchQuery, row.productId, row.productTitle, row.description, row.brand,
          row.imageUrl, row.offerDomain, row.offerUrl, row.price, row.currency, row.availability,
          row.condition, row.ramGb, JSON.stringify(row.structuredAttributes), JSON.stringify(row.rawProduct),
          JSON.stringify(row.rawOffer), row.fetchedAt, row.validUntil,
        ],
      );
    }
    await client.query(
      `INSERT INTO pactpay_channel3_refresh_checks
        (id, previous_snapshot_id, refreshed_snapshot_id, product_id, offer_domain, status,
         previous_price, previous_currency, current_price, current_currency, changed_fields,
         comparison, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::timestamptz)`,
      [
        args.id,
        args.previousSnapshotId,
        args.refreshedSnapshot?.id ?? null,
        args.productId,
        args.offerDomain,
        args.status,
        args.previousPrice,
        args.previousCurrency,
        args.currentPrice,
        args.currentCurrency,
        JSON.stringify(args.changedFields),
        JSON.stringify(args.comparison),
        args.fetchedAt,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export type OfferEvidenceDecision = "HUMAN_REVIEWED" | "REJECTED" | "SUBMITTED";

export interface OfferEvidenceInput {
  id: string;
  snapshotId: string;
  field: string;
  value: string | number;
  sourceUrl: string;
  sourceDomain: string;
  note: string | null;
  observedAt: string;
  validUntil: string;
  contentHash: string;
}

export interface OfferEvidenceRow {
  id: string;
  snapshot_id: string;
  field: string;
  claim_value: string | number | boolean;
  source_url: string;
  source_domain: string;
  note: string | null;
  observed_at: string;
  valid_until: string;
  content_hash: string;
  created_at: string;
  review_status: OfferEvidenceDecision;
  reviewer_label: string | null;
  source_inspected: boolean;
  review_note: string | null;
  reviewed_at: string | null;
}

/** Store the original manual claim as immutable data; review decisions are separate append-only rows. */
export async function storeOfferEvidence(args: OfferEvidenceInput): Promise<void> {
  await ensureEvidenceSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const snapshot = await client.query<{ id: string }>(
      "SELECT id FROM pactpay_channel3_offer_snapshots WHERE id = $1 FOR SHARE",
      [args.snapshotId],
    );
    if (snapshot.rowCount !== 1) throw new Error("Offer snapshot was not found.");

    await client.query(
      `INSERT INTO pactpay_offer_evidence
        (id, snapshot_id, field, claim_value, source_url, source_domain, note,
         observed_at, valid_until, content_hash)
       VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::timestamptz, $9::timestamptz, $10)`,
      [
        args.id,
        args.snapshotId,
        args.field,
        JSON.stringify(args.value),
        args.sourceUrl,
        args.sourceDomain,
        args.note,
        args.observedAt,
        args.validUntil,
        args.contentHash,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Append a review decision; never edits the submitted evidence row. */
export async function recordOfferEvidenceReview(args: {
  id: string;
  evidenceId: string;
  snapshotId: string;
  decision: Exclude<OfferEvidenceDecision, "SUBMITTED">;
  reviewerLabel: string;
  sourceInspected: boolean;
  reviewNote: string | null;
}): Promise<boolean> {
  await ensureEvidenceSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const evidence = await client.query<{ id: string }>(
      "SELECT id FROM pactpay_offer_evidence WHERE id = $1 AND snapshot_id = $2 FOR SHARE",
      [args.evidenceId, args.snapshotId],
    );
    if (evidence.rowCount !== 1) {
      await client.query("ROLLBACK");
      return false;
    }
    await client.query(
      `INSERT INTO pactpay_offer_evidence_reviews
        (id, evidence_id, decision, reviewer_label, source_inspected, review_note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [args.id, args.evidenceId, args.decision, args.reviewerLabel, args.sourceInspected, args.reviewNote],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** List a snapshot's observations with their latest review status. */
export async function listOfferEvidence(snapshotId: string): Promise<OfferEvidenceRow[]> {
  await ensureEvidenceSchema();
  const result = await getPool().query<OfferEvidenceRow>(
    `SELECT e.id, e.snapshot_id, e.field, e.claim_value, e.source_url, e.source_domain,
       e.note, e.observed_at::text AS observed_at, e.valid_until::text AS valid_until,
       e.content_hash, e.created_at::text AS created_at,
       COALESCE(latest.decision, 'SUBMITTED') AS review_status,
       latest.reviewer_label, COALESCE(latest.source_inspected, FALSE) AS source_inspected,
       latest.review_note, latest.created_at::text AS reviewed_at
     FROM pactpay_offer_evidence e
     LEFT JOIN LATERAL (
       SELECT r.decision, r.reviewer_label, r.source_inspected, r.review_note, r.created_at
       FROM pactpay_offer_evidence_reviews r
       WHERE r.evidence_id = e.id
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE e.snapshot_id = $1
     ORDER BY e.created_at DESC, e.id DESC`,
    [snapshotId],
  );
  return result.rows;
}

/** Return only claims whose most recent decision is HUMAN_REVIEWED. */
export async function listHumanReviewedOfferEvidence(snapshotId: string): Promise<OfferEvidenceRow[]> {
  const rows = await listOfferEvidence(snapshotId);
  return rows.filter((row) => row.review_status === "HUMAN_REVIEWED" && row.source_inspected === true);
}
