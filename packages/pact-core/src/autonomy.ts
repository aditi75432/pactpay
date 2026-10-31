/**
 * How much the shopper lets the agent do without asking.
 *
 * The mode is chosen once, at approval time, and stored server-side next to the approved rules. It
 * limits only the AGENT's authority to start a hold and to settle automatically. It can never loosen
 * a rule, and settlement still passes the same deterministic gate in every mode.
 */
export type AutonomyMode = "ASK_ALWAYS" | "ASK_ABOVE" | "WITHIN_RULES";
export type ActionTrigger = "user" | "agent";

export interface Autonomy {
  mode: AutonomyMode;
  /** Only meaningful for ASK_ABOVE: the most the agent may handle on its own, in USD. */
  limitUsd: number | null;
}

export const DEFAULT_AUTONOMY: Autonomy = { mode: "ASK_ALWAYS", limitUsd: null };
export const MAX_AUTONOMY_LIMIT_USD = 100_000;

export function isAutonomyMode(value: unknown): value is AutonomyMode {
  return value === "ASK_ALWAYS" || value === "ASK_ABOVE" || value === "WITHIN_RULES";
}

/** Validates untrusted input. Anything missing or malformed falls back to the safest mode. */
export function parseAutonomy(input: unknown): Autonomy {
  if (typeof input !== "object" || input === null) return DEFAULT_AUTONOMY;
  const record = input as Record<string, unknown>;
  if (!isAutonomyMode(record.mode)) return DEFAULT_AUTONOMY;
  if (record.mode === "ASK_ABOVE") {
    const limit = typeof record.limitUsd === "number" ? record.limitUsd : Number(record.limitUsd);
    if (!Number.isFinite(limit) || limit <= 0 || limit > MAX_AUTONOMY_LIMIT_USD) return DEFAULT_AUTONOMY;
    return { mode: "ASK_ABOVE", limitUsd: Math.round(limit * 100) / 100 };
  }
  return { mode: record.mode, limitUsd: null };
}

export interface AutonomyDecision {
  allowed: boolean;
  reason: string;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** May this trigger settle a held payment of `amountUsd`? A human release is always allowed. */
export function decideSettlement(autonomy: Autonomy, amountUsd: number, trigger: ActionTrigger): AutonomyDecision {
  if (trigger === "user") return { allowed: true, reason: "Released by you." };
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { allowed: false, reason: "The held amount is not valid, so the agent will not act on it." };
  switch (autonomy.mode) {
    case "ASK_ALWAYS":
      return { allowed: false, reason: "Your setting is “Ask me every time”, so only you can release this payment." };
    case "ASK_ABOVE": {
      const limit = autonomy.limitUsd ?? 0;
      return amountUsd <= limit + 1e-9
        ? { allowed: true, reason: `${usd(amountUsd)} is within the ${usd(limit)} you let the agent handle alone.` }
        : { allowed: false, reason: `${usd(amountUsd)} is above the ${usd(limit)} you let the agent handle alone, so it needs your OK.` };
    }
    case "WITHIN_RULES":
      return { allowed: true, reason: "Your setting lets the agent act on its own within your rules." };
  }
}

/** Should the agent start the hold itself, without waiting for a click? Uses the estimated total. */
export function shouldAutoHold(autonomy: Autonomy, estimatedTotalUsd: number): boolean {
  return decideSettlement(autonomy, estimatedTotalUsd, "agent").allowed;
}

export function describeAutonomy(autonomy: Autonomy): { title: string; detail: string } {
  switch (autonomy.mode) {
    case "ASK_ALWAYS":
      return { title: "Ask me every time", detail: "The agent shops and prepares everything. You choose the offer and release the payment." };
    case "ASK_ABOVE":
      return { title: `Ask me above ${usd(autonomy.limitUsd ?? 0)}`, detail: `Up to ${usd(autonomy.limitUsd ?? 0)} the agent picks, holds and settles by itself. Above that, it waits for you.` };
    case "WITHIN_RULES":
      return { title: "Handle it within my rules", detail: "The agent picks, holds and settles by itself. It still can't break a rule, and the same gate decides every time." };
  }
}
