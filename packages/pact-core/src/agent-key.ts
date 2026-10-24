import { createHash, randomBytes } from "node:crypto";

/**
 * Agent keys: a credential for software acting for the shopper, deliberately separate from the shopper's
 * own browser session. A key is bound to ONE approved Pact. It can only use the gateway tools, and the
 * gateway always acts as the "agent" (never as "user"), so the autonomy limit the shopper chose is enforced
 * on the server for any agent that holds a key. Only a SHA-256 hash of a key is ever stored.
 */
export const AGENT_KEY_PREFIX = "ppk_";
export const AGENT_KEY_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^ppk_[A-Za-z0-9_-]{43}$/;

export function generateAgentKey(entropy: Buffer = randomBytes(32)): string {
  if (entropy.length !== 32) throw new Error("An agent key needs exactly 32 bytes of entropy.");
  return `${AGENT_KEY_PREFIX}${entropy.toString("base64url")}`;
}

export function looksLikeAgentKey(value: unknown): value is string {
  return typeof value === "string" && KEY_PATTERN.test(value);
}

export function hashAgentKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Extracts the key from an "Authorization: Bearer ppk_..." header, or null if absent or malformed. */
export function parseBearerKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const candidate = match?.[1];
  return candidate && looksLikeAgentKey(candidate) ? candidate : null;
}
