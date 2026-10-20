import { describe, expect, it } from "vitest";
import {
  compareChannel3OfferRefresh,
  matchRefreshedChannel3Offer,
  type Channel3NormalizedOffer,
} from "../src/channel3";

function offer(overrides: Partial<Channel3NormalizedOffer> = {}): Channel3NormalizedOffer {
  return {
    productId: "laptop-123",
    productTitle: "ThinkPad Laptop",
    description: null,
    brand: "Lenovo",
    imageUrl: null,
    offerDomain: "example.com",
    offerUrl: "https://buy.trychannel3.com/laptop-123-merchant-a?o=old&aid=old",
    price: 799,
    currency: "USD",
    availability: "InStock",
    condition: "refurbished",
    ramGb: 16,
    structuredAttributes: { ram: "16 GB" },
    rawProduct: { id: "laptop-123" },
    rawOffer: { url: "https://buy.trychannel3.com/laptop-123-merchant-a?o=old" },
    ...overrides,
  };
}

const identity = {
  productId: "laptop-123",
  offerDomain: "www.example.com",
  offerUrl: "https://buy.trychannel3.com/laptop-123-merchant-a?o=previous&aid=previous",
};

describe("Channel3 offer refresh matching", () => {
  it("matches the same offer when only tracking query parameters change", () => {
    const current = offer({ offerUrl: "https://buy.trychannel3.com/laptop-123-merchant-a?o=new&aid=new" });
    expect(matchRefreshedChannel3Offer(identity, [current])).toBe(current);
  });

  it("matches a unique offer from the same merchant when the URL path changes", () => {
    const current = offer({ offerUrl: "https://buy.trychannel3.com/new-affiliate-path?o=new" });
    expect(matchRefreshedChannel3Offer(identity, [current])).toBe(current);
  });

  it("fails closed when the same merchant has multiple ambiguous offers", () => {
    const first = offer({ offerUrl: "https://buy.trychannel3.com/path-one" });
    const second = offer({ offerUrl: "https://buy.trychannel3.com/path-two" });
    expect(matchRefreshedChannel3Offer(identity, [first, second])).toBeNull();
  });

  it("does not switch to a different merchant", () => {
    expect(matchRefreshedChannel3Offer(identity, [offer({ offerDomain: "other.example" })])).toBeNull();
  });

  it("does not switch to a different product", () => {
    expect(matchRefreshedChannel3Offer(identity, [offer({ productId: "other-product" })])).toBeNull();
  });
});

describe("Channel3 offer refresh comparison", () => {
  const previous = offer();

  it("reports no changed catalog fields when values are unchanged", () => {
    expect(compareChannel3OfferRefresh(previous, offer()).changedFields).toEqual([]);
  });

  it("detects price, availability, condition, and structured RAM drift", () => {
    const result = compareChannel3OfferRefresh(previous, offer({
      price: 829,
      availability: "OutOfStock",
      condition: "used",
      ramGb: 8,
    }));
    expect(result.changedFields).toEqual(["itemPrice", "availability", "condition", "structuredRam"]);
  });

  it("does not invent changed values when no offer can be matched", () => {
    const result = compareChannel3OfferRefresh(previous, null);
    expect(result.matchedOffer).toBe(false);
    expect(result.current).toBeNull();
    expect(result.changedFields).toEqual([]);
  });
});
