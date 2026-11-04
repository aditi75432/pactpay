import { describe, expect, it } from "vitest";
import { normalizeSpokenNumbers as n } from "../src/spoken-numbers";

describe("spoken numbers", () => {
  it("turns spoken amounts into dollars", () => {
    expect(n("Find me a wireless mouse under fifty dollars")).toBe("Find me a wireless mouse under $50");
    expect(n("under one hundred dollars")).toBe("under $100");
    expect(n("at most two hundred and fifty dollars in total")).toBe("at most $250 in total");
    expect(n("a hundred bucks")).toBe("$100");
    expect(n("budget is one thousand five hundred dollars")).toBe("budget is $1500");
    expect(n("under thirty-five dollars")).toBe("under $35");
    expect(n("no more than twenty dollars.")).toBe("no more than $20.");
  });
  it("converts bare tens and teens but leaves small counts alone", () => {
    expect(n("under fifty")).toBe("under 50");
    expect(n("I want one mouse and two cables")).toBe("I want one mouse and two cables");
    expect(n("a one year warranty")).toBe("a one year warranty");
    expect(n("five dollars")).toBe("$5");
  });
  it("keeps digits and normal text intact", () => {
    expect(n("USB-C charger under $40, in stock")).toBe("USB-C charger under $40, in stock");
    expect(n("100 dollars")).toBe("$100");
  });
  it("never doubles an existing dollar sign", () => {
    expect(n("catalog item price at most $50 USD, in stock")).toBe("catalog item price at most $50 USD, in stock");
    expect(n("under $50")).toBe("under $50");
    expect(n("under 50 dollars")).toBe("under $50");
  });
});
