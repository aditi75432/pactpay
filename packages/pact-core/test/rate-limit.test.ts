import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/rate-limit";

describe("createRateLimiter", () => {
  it("allows requests up to the limit and then blocks with a retry hint", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 10_000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 1_000).allowed).toBe(true);
    const third = limiter.check("a", 2_000);
    expect(third).toMatchObject({ allowed: true, remaining: 0 });
    const blocked = limiter.check("a", 3_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(7);
  });

  it("resets after the window and tracks keys independently", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1_000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 500).allowed).toBe(false);
    expect(limiter.check("b", 500).allowed).toBe(true);
    expect(limiter.check("a", 1_000).allowed).toBe(true);
  });

  it("bounds memory by dropping the oldest keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3 });
    for (const key of ["a", "b", "c", "d"]) limiter.check(key, 0);
    // "a" was evicted to make room, so it is treated as a new key again.
    expect(limiter.check("a", 1).allowed).toBe(true);
  });

  it("rejects invalid configuration", () => {
    expect(() => createRateLimiter({ limit: 0, windowMs: 1000 })).toThrow();
    expect(() => createRateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});
