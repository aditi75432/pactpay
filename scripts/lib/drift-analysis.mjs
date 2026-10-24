/**
 * Offer drift analysis. Input: repeated observations of the same offers over time.
 * An offer is one product at one merchant. "Drift" is a change in item price or availability.
 *
 * @typedef {{ key: string, at: string, price: number, currency?: string, availability?: string | null }} Observation
 */

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** @param {Observation[]} observations @param {{ horizonsHours?: number[] }} [options] */
export function analyzeDrift(observations, options = {}) {
  const horizons = options.horizonsHours ?? [1, 6, 24, 72];
  const byOffer = new Map();
  for (const item of observations) {
    if (!item || typeof item.key !== "string") continue;
    const time = Date.parse(item.at);
    if (!Number.isFinite(time) || !Number.isFinite(item.price)) continue;
    if (!byOffer.has(item.key)) byOffer.set(item.key, []);
    byOffer.get(item.key).push({ ...item, time });
  }

  const offers = [];
  for (const [key, list] of byOffer) {
    list.sort((a, b) => a.time - b.time);
    const first = list[0];
    const last = list[list.length - 1];
    let priceChanged = false, availabilityChanged = false, firstChangeAt = null;
    for (let index = 1; index < list.length; index += 1) {
      const before = list[index - 1], now = list[index];
      const priceMoved = Math.abs(now.price - before.price) >= 0.005;
      const stockMoved = (now.availability ?? null) !== (before.availability ?? null);
      priceChanged ||= priceMoved;
      availabilityChanged ||= stockMoved;
      if ((priceMoved || stockMoved) && firstChangeAt === null) firstChangeAt = now.time;
    }
    offers.push({
      key, observations: list.length, spanHours: (last.time - first.time) / 3_600_000, priceChanged, availabilityChanged,
      changed: priceChanged || availabilityChanged, hoursToFirstChange: firstChangeAt === null ? null : (firstChangeAt - first.time) / 3_600_000,
      relativePriceMove: first.price > 0 ? Math.abs(last.price - first.price) / first.price : 0, firstPrice: first.price, lastPrice: last.price,
    });
  }

  const repeated = offers.filter((offer) => offer.observations >= 2);
  const changed = repeated.filter((offer) => offer.changed);
  const moves = repeated.filter((offer) => offer.priceChanged).map((offer) => offer.relativePriceMove);
  const times = observations.map((item) => Date.parse(item?.at)).filter(Number.isFinite);
  return {
    observations: observations.length,
    offersTracked: offers.length,
    offersObservedRepeatedly: repeated.length,
    offersWithPriceChange: repeated.filter((offer) => offer.priceChanged).length,
    offersWithAvailabilityChange: repeated.filter((offer) => offer.availabilityChanged).length,
    offersWithAnyChange: changed.length,
    shareWithAnyChange: repeated.length ? changed.length / repeated.length : 0,
    medianPriceMove: median(moves),
    windowHours: times.length ? (Math.max(...times) - Math.min(...times)) / 3_600_000 : 0,
    // Among offers watched for at least h hours, how many changed within h hours of the first look?
    byHorizon: horizons.map((hours) => {
      const eligible = repeated.filter((offer) => offer.spanHours >= hours);
      const within = eligible.filter((offer) => offer.hoursToFirstChange !== null && offer.hoursToFirstChange <= hours);
      return { hours, eligible: eligible.length, changed: within.length, share: eligible.length ? within.length / eligible.length : null };
    }),
    biggestMoves: [...repeated].filter((offer) => offer.priceChanged).sort((a, b) => b.relativePriceMove - a.relativePriceMove).slice(0, 5)
      .map((offer) => ({ key: offer.key, from: offer.firstPrice, to: offer.lastPrice, relativeMove: offer.relativePriceMove })),
  };
}
