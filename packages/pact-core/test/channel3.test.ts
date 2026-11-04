import { describe, expect, it } from "vitest";
import { buildChannel3SearchQueries, extractRamGb, normalizeChannel3SearchResponse } from "../src/channel3";

const validPayload = {
  products: [{
    id: "prod-1",
    title: "Laptop 16GB",
    description: "Catalog example",
    brands: [{ id: "brand-1", name: "Lenovo" }],
    images: [{ url: "https://images.example/laptop.jpg", cleaned_url: "https://images.example/laptop-clean.jpg", is_main_image: true }],
    structured_attributes: { "RAM (GB)": "16 GB", color: "silver" },
    offers: [{
      url: "https://retailer.example/item-1",
      domain: "retailer.example",
      price: { amount: 849.99, currency: "USD" },
      availability: "InStock",
      condition: "refurbished",
    }],
  }],
};

describe("Channel3 normalization", () => {
  it("normalizes product+offer as a single attributable listing", () => {
    const [offer] = normalizeChannel3SearchResponse(validPayload);
    expect(offer).toMatchObject({
      productId: "prod-1",
      productTitle: "Laptop 16GB",
      brand: "Lenovo",
      imageUrl: "https://images.example/laptop-clean.jpg",
      offerDomain: "retailer.example",
      offerUrl: "https://retailer.example/item-1",
      price: 849.99,
      currency: "USD",
      availability: "InStock",
      condition: "refurbished",
      ramGb: 16,
    });
  });

  it("normalizes the Search API reference price.price field as well as price.amount", () => {
    const payload = {
      products: [{
        id: "prod-price-field",
        title: "Wireless headphones",
        structured_attributes: {},
        offers: [{
          url: "https://retailer.example/headphones",
          domain: "retailer.example",
          price: { price: 79.95, currency: "USD", compare_at_price: 99.95 },
          availability: "InStock",
          condition: "new",
        }],
      }],
    };
    const [offer] = normalizeChannel3SearchResponse(payload);
    expect(offer).toMatchObject({ price: 79.95, currency: "USD", offerDomain: "retailer.example" });
  });

  it("does not infer RAM from product title when structured attributes are missing", () => {
    const payload = { products: [{ id: "p", title: "16GB RAM laptop", offers: [{ url: "https://retailer.example/p", domain: "retailer.example", price: { amount: 100, currency: "USD" } }] }] };
    const [offer] = normalizeChannel3SearchResponse(payload);
    if (!offer) throw new Error("Expected the well-formed fixture offer to normalize.");
    expect(offer.ramGb).toBeNull();
  });

  it("drops unsafe links and malformed price/currency offers", () => {
    const payload = { products: [{ id: "p", title: "test", offers: [
      { url: "javascript:alert(1)", domain: "bad.example", price: { amount: 10, currency: "USD" } },
      { url: "https://retailer.example/no-price", domain: "retailer.example", price: { amount: "NaN", currency: "USD" } },
      { url: "https://retailer.example/no-currency", domain: "retailer.example", price: { amount: 10, currency: "US" } },
    ] }] };
    expect(normalizeChannel3SearchResponse(payload)).toEqual([]);
  });

  it("rejects response shapes with no products array", () => {
    expect(() => normalizeChannel3SearchResponse({ data: [] })).toThrow(/products array/i);
  });

  it("parses RAM from structured attributes and ignores storage capacity", () => {
    expect(extractRamGb({ ram: "16384 MB" })).toBe(16);
    expect(extractRamGb({ "SSD storage": "1 TB", title: "RAM 16GB" })).toBeNull();
  });

  it("creates product-focused search variants without weakening approved rules", () => {
    expect(buildChannel3SearchQueries("I want Sony WH-1000XM5 headphones under $300 USD")).toEqual([
      "Sony WH-1000XM5 headphones",
    ]);
    expect(buildChannel3SearchQueries("I would like to buy a Samsung S24 Ultra 256GB phone under $900")).toEqual([
      "Samsung S24 Ultra 256GB phone",
      "Samsung S24 Ultra phone",
    ]);
    expect(buildChannel3SearchQueries("wireless mouse")).toEqual(["wireless mouse"]);
    expect(buildChannel3SearchQueries("   ")).toEqual([]);
  });

  it("reads stock and condition from flat or nested structured attributes when offer fields are absent", () => {
    const payload = { products: [{
      id: "p-attrs", title: "Wireless mouse", structured_attributes: {
        "Stock Status": { value: "In Stock" }, "Item Condition": "Brand New", Manufacturer: { name: "Logitech" },
      }, offers: [{ url: "https://retailer.example/mouse", price: { amount: 20, currency: "USD" } }],
    }] };
    expect(normalizeChannel3SearchResponse(payload)[0]).toMatchObject({ availability: "InStock", condition: "new", brand: "Logitech" });
  });

  it("keeps a product image when Channel3 returns a string image or structured image URL", () => {
    const payload = { products: [{ id: "p-image", title: "Mouse", images: ["https://img.example/mouse.jpg"], offers: [{ url: "https://retailer.example/mouse", price: { amount: 20, currency: "USD" } }] }] };
    expect(normalizeChannel3SearchResponse(payload)[0]?.imageUrl).toBe("https://img.example/mouse.jpg");
  });
});
