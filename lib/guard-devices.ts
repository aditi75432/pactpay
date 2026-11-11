import { createHash, randomBytes, randomInt } from "node:crypto";
import { Pool } from "pg";
import { ensureDatabase } from "./db";

/**
 * Identity for the PactPay Guard extension, so it works on its own without a web login.
 *
 * A "device" is one installed extension. On first use it asks for a device token (`pgd_...`, shown once, stored
 * only as a SHA-256 hash here). The device owns a private data scope (a 64-hex "session id", exactly like a web
 * account's scope), so rules it approves, the agent keys it holds and the Guard checks it stores are all its own.
 *
 * Linking is optional: a signed-in web user can create a short-lived, one-time link code; entering it in the
 * extension moves the device onto that account's scope, so the extension and the web app share rules and Activity.
 * A link code is valid for 5 minutes, works once, and is stored only as a hash.
 */
declare global {
  // eslint-disable-next-line no-var
  var pactPayGuardDeviceSchemaPromise: Promise<void> | undefined;
}

const LINK_TTL_MS = 5 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

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
  if (!global.pactPayGuardDeviceSchemaPromise) {
    global.pactPayGuardDeviceSchemaPromise = pool().query(`
      CREATE TABLE IF NOT EXISTS pactpay_guard_devices (
        token_hash CHAR(64) PRIMARY KEY,
        session_id CHAR(64) NOT NULL,
        linked BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS pactpay_guard_link_codes (
        code_hash CHAR(64) PRIMARY KEY,
        session_id CHAR(64) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pactpay_guard_link_codes_session_idx ON pactpay_guard_link_codes (session_id);
    `).then(() => undefined).catch((error) => {
      global.pactPayGuardDeviceSchemaPromise = undefined;
      throw error;
    });
  }
  await global.pactPayGuardDeviceSchemaPromise;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const DEVICE_TOKEN = /^pgd_[A-Za-z0-9_-]{43}$/;

export function looksLikeDeviceToken(value: unknown): value is string {
  return typeof value === "string" && DEVICE_TOKEN.test(value);
}

/** Registers a new extension install. The token is returned once and never stored in plaintext. */
export async function createGuardDevice(): Promise<{ token: string }> {
  await ensureSchema();
  const token = `pgd_${randomBytes(32).toString("base64url")}`;
  const sessionId = randomBytes(32).toString("hex");
  await pool().query("INSERT INTO pactpay_guard_devices (token_hash, session_id) VALUES ($1, $2)", [sha256(token), sessionId]);
  return { token };
}

export interface GuardDevice { sessionId: string; linked: boolean }

export async function resolveGuardDevice(token: string | null | undefined): Promise<GuardDevice | null> {
  if (!looksLikeDeviceToken(token)) return null;
  await ensureSchema();
  const result = await pool().query<{ session_id: string; linked: boolean }>(
    "UPDATE pactpay_guard_devices SET last_seen_at = NOW() WHERE token_hash = $1 RETURNING session_id, linked",
    [sha256(token)],
  );
  const row = result.rows[0];
  return row ? { sessionId: row.session_id.trim(), linked: row.linked } : null;
}

/** A signed-in web user creates a one-time code. Any earlier unused code for the same account is replaced. */
export async function createLinkCode(sessionId: string): Promise<{ code: string; expiresAt: string }> {
  await ensureSchema();
  const raw = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]!).join("");
  const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM pactpay_guard_link_codes WHERE session_id = $1 OR expires_at < NOW()", [sessionId]);
    await client.query("INSERT INTO pactpay_guard_link_codes (code_hash, session_id, expires_at) VALUES ($1, $2, $3)", [sha256(code), sessionId, expiresAt.toISOString()]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return { code, expiresAt: expiresAt.toISOString() };
}

export function normalizeLinkCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (compact.length !== 8 || [...compact].some((char) => !CODE_ALPHABET.includes(char))) return null;
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

/** Moves a device onto the account that issued the code. Returns false for an unknown, expired or already-used code. */
export async function redeemLinkCode(token: string, rawCode: unknown): Promise<boolean> {
  const code = normalizeLinkCode(rawCode);
  if (!code || !looksLikeDeviceToken(token)) return false;
  await ensureSchema();
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query<{ session_id: string }>("DELETE FROM pactpay_guard_link_codes WHERE code_hash = $1 AND expires_at > NOW() RETURNING session_id", [sha256(code)]);
    const target = found.rows[0]?.session_id.trim();
    if (!target) { await client.query("ROLLBACK"); return false; }
    const moved = await client.query("UPDATE pactpay_guard_devices SET session_id = $1, linked = TRUE WHERE token_hash = $2", [target, sha256(token)]);
    if (moved.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
