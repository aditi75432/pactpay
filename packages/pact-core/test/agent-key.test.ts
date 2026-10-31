import { describe, expect, it } from "vitest";
import { AGENT_KEY_PREFIX, generateAgentKey, hashAgentKey, looksLikeAgentKey, parseBearerKey } from "../src/agent-key";

describe("agent keys", () => {
  it("generates well-formed, unique keys", () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    expect(a.startsWith(AGENT_KEY_PREFIX)).toBe(true);
    expect(looksLikeAgentKey(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).toHaveLength(47);
  });
  it("refuses weak entropy", () => {
    expect(() => generateAgentKey(Buffer.alloc(8))).toThrow();
  });
  it("hashes deterministically and never stores the key itself", () => {
    const key = generateAgentKey(Buffer.alloc(32, 7));
    expect(hashAgentKey(key)).toBe(hashAgentKey(key));
    expect(hashAgentKey(key)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAgentKey(key)).not.toContain(key.slice(4, 20));
    expect(hashAgentKey(key)).not.toBe(hashAgentKey(generateAgentKey(Buffer.alloc(32, 8))));
  });
  it("parses only a well-formed Bearer key", () => {
    const key = generateAgentKey();
    expect(parseBearerKey(`Bearer ${key}`)).toBe(key);
    expect(parseBearerKey(`bearer   ${key}  `)).toBe(key);
    for (const bad of [null, undefined, "", "Bearer", `Basic ${key}`, `Bearer ${key}x`, "Bearer ppk_short", `Bearer ${key.replace("ppk_", "xyz_")}`]) {
      expect(parseBearerKey(bad as string | null | undefined)).toBeNull();
    }
  });
});
