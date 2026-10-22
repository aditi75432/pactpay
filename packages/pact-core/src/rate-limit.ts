/**
 * Small in-memory fixed-window rate limiter.
 *
 * It is intentionally dependency-free and clock-injectable so it can be unit tested.
 * In-memory limits are per server process: they protect a single-instance demo
 * deployment from accidental abuse of paid or expensive endpoints, but they are not
 * a substitute for an edge/WAF limit in a multi-instance production deployment.
 */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export interface RateLimiter {
  check(key: string, now?: number): RateLimitDecision;
}

export interface RateLimiterOptions {
  /** Maximum requests per key within one window. */
  limit: number;
  windowMs: number;
  /** Upper bound on tracked keys; expired keys are purged first, then the oldest are dropped. */
  maxKeys?: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("limit must be a positive integer");
  if (!Number.isFinite(options.windowMs) || options.windowMs < 1) throw new Error("windowMs must be positive");
  const maxKeys = options.maxKeys ?? 5_000;
  const windows = new Map<string, { startedAt: number; count: number }>();

  function purge(now: number): void {
    for (const [key, value] of windows) {
      if (now - value.startedAt >= options.windowMs) windows.delete(key);
    }
    // Map iteration order is insertion order, so the first keys are the oldest.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();
      if (oldest.done) break;
      windows.delete(oldest.value);
    }
  }

  return {
    check(key: string, now: number = Date.now()): RateLimitDecision {
      const current = windows.get(key);
      if (!current || now - current.startedAt >= options.windowMs) {
        if (!current && windows.size >= maxKeys) purge(now);
        windows.set(key, { startedAt: now, count: 1 });
        return { allowed: true, remaining: options.limit - 1, retryAfterSec: 0 };
      }
      if (current.count >= options.limit) {
        const retryAfterMs = options.windowMs - (now - current.startedAt);
        return { allowed: false, remaining: 0, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
      current.count += 1;
      return { allowed: true, remaining: options.limit - current.count, retryAfterSec: 0 };
    },
  };
}
