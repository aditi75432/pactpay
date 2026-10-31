import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { hashPassword, verifyPassword } from "@pactpay/pact-core/password";
import { ensureDatabase } from "./db";

/**
 * PactPay accounts: username and password, with server-side login sessions.
 *
 * Every account owns a private data scope (`scope_id`). The scope id is what all other tables use as
 * "session_id", so a person's approved rules, agent keys, orders and Activity follow their account across
 * browsers. The scope id is random, never derived from anything public, and never sent to the browser:
 * the browser only holds an opaque login token whose SHA-256 hash is stored here.
 */
declare global {
  // eslint-disable-next-line no-var
  var pactPayAuthSchemaPromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var pactPayDummyHash: Promise<string> | undefined;
}

export const LOGIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function pool(): Pool {
  const holder = globalThis as unknown as { pactPayPgPool?: Pool };
  if (!holder.pactPayPgPool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("Missing required environment variable: DATABASE_URL");
    holder.pactPayPgPool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  }
  return holder.pactPayPgPool;
}

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

async function ensureSchema(): Promise<void> {
  await ensureDatabase();
  if (!global.pactPayAuthSchemaPromise) {
    global.pactPayAuthSchemaPromise = (async () => {
      await pool().query(`
        CREATE TABLE IF NOT EXISTS pactpay_users (
          id UUID PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          scope_id CHAR(64) NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS pactpay_login_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          user_id UUID NOT NULL REFERENCES pactpay_users(id) ON DELETE CASCADE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        );
        CREATE INDEX IF NOT EXISTS pactpay_login_sessions_user_idx ON pactpay_login_sessions (user_id);
      `);
      // Optional shared demo account for judges (set both variables). Idempotent: never overwrites an existing account.
      const demoUser = process.env.PACTPAY_DEMO_USERNAME?.trim().toLowerCase();
      const demoPassword = process.env.PACTPAY_DEMO_PASSWORD;
      if (demoUser && demoPassword && demoPassword.length >= 8) {
        const exists = await pool().query("SELECT 1 FROM pactpay_users WHERE username = $1", [demoUser]);
        if (exists.rowCount === 0) {
          await pool().query(
            "INSERT INTO pactpay_users (id, username, password_hash, scope_id) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING",
            [randomUUID(), demoUser, await hashPassword(demoPassword), randomBytes(32).toString("hex")],
          );
        }
      }
    })().catch((error) => { global.pactPayAuthSchemaPromise = undefined; throw error; });
  }
  await global.pactPayAuthSchemaPromise;
}

export type CreateUserResult = { ok: true; userId: string } | { ok: false; reason: "USERNAME_TAKEN" };

export async function createUser(username: string, password: string): Promise<CreateUserResult> {
  await ensureSchema();
  const id = randomUUID();
  const result = await pool().query(
    "INSERT INTO pactpay_users (id, username, password_hash, scope_id) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO NOTHING",
    [id, username, await hashPassword(password), randomBytes(32).toString("hex")],
  );
  return result.rowCount === 1 ? { ok: true, userId: id } : { ok: false, reason: "USERNAME_TAKEN" };
}

/** Verifies credentials. Takes the same time whether or not the username exists, so it can't be used to probe accounts. */
export async function verifyLogin(username: string, password: string): Promise<{ userId: string; username: string } | null> {
  await ensureSchema();
  const result = await pool().query<{ id: string; username: string; password_hash: string }>("SELECT id::text AS id, username, password_hash FROM pactpay_users WHERE username = $1", [username]);
  const row = result.rows[0];
  global.pactPayDummyHash ??= hashPassword("not-a-real-account-password");
  const ok = await verifyPassword(password, row?.password_hash ?? (await global.pactPayDummyHash));
  return row && ok ? { userId: row.id, username: row.username } : null;
}

export async function createLoginSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  await ensureSchema();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + LOGIN_TTL_MS);
  await pool().query("INSERT INTO pactpay_login_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [sha256(token), userId, expiresAt.toISOString()]);
  await pool().query("DELETE FROM pactpay_login_sessions WHERE expires_at < NOW()");
  return { token, expiresAt };
}

export interface AuthUser { userId: string; username: string; scopeId: string }

export async function resolveLoginSession(token: string): Promise<AuthUser | null> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  await ensureSchema();
  const result = await pool().query<{ user_id: string; username: string; scope_id: string }>(
    `SELECT u.id::text AS user_id, u.username, BTRIM(u.scope_id) AS scope_id
     FROM pactpay_login_sessions s JOIN pactpay_users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [sha256(token)],
  );
  const row = result.rows[0];
  return row ? { userId: row.user_id, username: row.username, scopeId: row.scope_id } : null;
}

export async function deleteLoginSession(token: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await ensureSchema();
  await pool().query("DELETE FROM pactpay_login_sessions WHERE token_hash = $1", [sha256(token)]);
}
