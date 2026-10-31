import { DEFAULT_AUTONOMY, parseAutonomy, type Autonomy } from "@pactpay/pact-core/autonomy";

/** Browser-side memory of what the agent and the shopper did in this run. Display only; never a source of truth. */
export type LogWho = "agent" | "you";
export type LogEntry = { t: number; who: LogWho; text: string; key?: string };

const LOG_KEY = "pactpay.agentLog.v1";
export const AUTONOMY_KEY = "pactpay.activeAutonomy.v1";
const EXCLUDED_KEY = "pactpay.excluded.v1";
const ATTEMPTS_KEY = "pactpay.attempts.v1";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
}
function write(key: string, value: unknown) {
  try { window.sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: the log is optional */ }
}

export function readLog(): LogEntry[] {
  const entries = read<unknown>(LOG_KEY, []);
  return Array.isArray(entries) ? entries.filter((item): item is LogEntry => typeof item === "object" && item !== null && typeof (item as LogEntry).text === "string") : [];
}

/** Adds an entry. A `key` makes it idempotent, so React re-renders and strict-mode double effects don't repeat lines. */
export function logEvent(who: LogWho, text: string, key?: string) {
  const entries = readLog();
  if (key && entries.some((item) => item.key === key)) return;
  write(LOG_KEY, [...entries, { t: Date.now(), who, text, ...(key ? { key } : {}) }].slice(-60));
}

export function resetRun() {
  write(LOG_KEY, []);
  write(EXCLUDED_KEY, []);
  write(ATTEMPTS_KEY, []);
}

/** One payment hold in this run. A run can have several if the agent has to move to another offer. */
export type Attempt = { txId: string; title: string; merchant: string; key: string | null; t: number };
export function readAttempts(): Attempt[] {
  const items = read<unknown>(ATTEMPTS_KEY, []);
  return Array.isArray(items) ? items.filter((item): item is Attempt => typeof item === "object" && item !== null && typeof (item as Attempt).txId === "string") : [];
}
export function registerAttempt(attempt: Omit<Attempt, "t">) {
  const items = readAttempts();
  if (items.some((item) => item.txId === attempt.txId)) return;
  write(ATTEMPTS_KEY, [...items, { ...attempt, t: Date.now() }].slice(-12));
}

export function readAutonomy(): { autonomy: Autonomy; acknowledgedTest: boolean } {
  const stored = read<{ autonomy?: unknown; acknowledgedTest?: unknown } | null>(AUTONOMY_KEY, null);
  if (!stored) return { autonomy: DEFAULT_AUTONOMY, acknowledgedTest: false };
  return { autonomy: parseAutonomy(stored.autonomy), acknowledgedTest: stored.acknowledgedTest === true };
}
export function saveAutonomy(autonomy: Autonomy) {
  write(AUTONOMY_KEY, { autonomy, acknowledgedTest: true });
}

export function readExcluded(): string[] {
  const ids = read<unknown>(EXCLUDED_KEY, []);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}
export function addExcluded(id: string | null | undefined) {
  if (!id) return;
  const ids = readExcluded();
  if (!ids.includes(id)) write(EXCLUDED_KEY, [...ids, id].slice(-30));
}
