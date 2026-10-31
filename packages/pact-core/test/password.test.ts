import { describe, expect, it } from "vitest";
import { hashPassword, normalizeUsername, validatePassword, verifyPassword } from "../src/password";

describe("password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery", stored)).toBe(true);
    expect(await verifyPassword("correct horse batterY", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });
  it("uses a fresh salt every time and never stores the password", async () => {
    const [a, b] = await Promise.all([hashPassword("same password 1"), hashPassword("same password 1")]);
    expect(a).not.toBe(b);
    expect(a).not.toContain("same password 1");
  });
  it("rejects malformed stored values instead of throwing", async () => {
    for (const bad of ["", "plain", "scrypt$1$2", "bcrypt$1$1$1$AAAA$AAAA", "scrypt$x$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA==", "scrypt$999999999$8$1$AAAAAAAAAAA=$AAAAAAAAAAAAAAAAAAAAAA=="]) {
      expect(await verifyPassword("anything", bad)).toBe(false);
    }
  });
});

describe("input rules", () => {
  it("normalizes valid usernames and rejects the rest", () => {
    expect(normalizeUsername("  Judge.One ")).toBe("judge.one");
    for (const bad of [null, 5, "", "ab", "a b", "-lead", "x".repeat(33), "bad/name", "emoji😀name"]) expect(normalizeUsername(bad)).toBeNull();
  });
  it("enforces password length and not-the-username", () => {
    expect(validatePassword("short")).toMatch(/at least 8/);
    expect(validatePassword("x".repeat(129))).toMatch(/at most/);
    expect(validatePassword("judgejudge", "JudgeJudge")).toMatch(/same as your username/);
    expect(validatePassword("a fine passphrase", "judge")).toBeNull();
    expect(validatePassword(12345678 as unknown)).toMatch(/Enter a password/);
  });
});
