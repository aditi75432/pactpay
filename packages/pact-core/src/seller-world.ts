/**
 * The simulated seller's memory.
 *
 * "Demo control" lets a judge change a seller's offer after the shopper approved it. That change has to
 * stay true afterwards, or an agent that retries would simply meet the unchanged live catalog and buy the
 * same offer again. A seller-world effect is keyed by a stable offer identity (product + merchant), not by
 * snapshot id, because every search creates a fresh snapshot of the same offer.
 *
 * This is a test layer. It never touches real merchants, only what the simulated seller would show.
 */
export type SellerWorldScenario = "OUT_OF_STOCK" | "PRICE_INCREASE" | "PROMPT_INJECTION" | "CURRENCY_MISMATCH";

const BLOCKING: Record<SellerWorldScenario, string> = {
  OUT_OF_STOCK: "The simulated seller marked this offer out of stock, and it stays that way until you reset the simulation.",
  PRICE_INCREASE: "The simulated seller raised this offer's price above your limit, and it stays that way until you reset the simulation.",
  PROMPT_INJECTION: "The simulated seller's listing carries an instruction aimed at the agent, so the agent won't use this offer until you reset the simulation.",
  CURRENCY_MISMATCH: "The simulated seller switched this offer to another currency, and it stays that way until you reset the simulation.",
};

export function isBlockingScenario(value: unknown): value is SellerWorldScenario {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(BLOCKING, value);
}

/** Stable identity of an offer across searches: the product plus the merchant domain, case-insensitive. */
export function offerKey(productId: string, domain: string): string {
  return `${productId.trim()}|${domain.trim().toLowerCase().replace(/^www\./, "")}`.toLowerCase();
}

export function sellerWorldReason(scenarioId: string): string | null {
  return isBlockingScenario(scenarioId) ? BLOCKING[scenarioId] : null;
}

export interface SellerWorldEffect {
  offerKey: string;
  scenarioId: string;
  appliedAt: string;
}

/** Why this offer must not be used right now, or null if the simulated seller leaves it alone. */
export function blockedBySellerWorld(effects: readonly SellerWorldEffect[], key: string): string | null {
  const effect = effects.find((item) => item.offerKey === key.toLowerCase());
  return effect ? sellerWorldReason(effect.scenarioId) : null;
}
