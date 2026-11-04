import { NextResponse } from "next/server";
import { buildCheckoutPage, renderCheckoutPageSvg, CHECKOUT_PAGE_SIZE, type CheckoutPageVariant } from "@pactpay/pact-core/checkout-page";
import { getProtectedDemoContext, getTransactionById, isUuid } from "../../../../../../lib/db";
import { requireTransactionAccess } from "../../../../lib/ownership";
import { enforceRateLimit } from "../../../../lib/request-guard";
import { requireLogin } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);

/**
 * The checkout page a held order would be paid on, drawn from the order's stored merchant terms (sandbox). The browser
 * turns it into a PNG and sends it to the Checkout Inspector, which treats it like any other screenshot.
 * `variant=hostile` is a labelled simulation of a seller turning on the shopper.
 */
export async function GET(request: Request) {
  const loginDenied = await requireLogin();
  if (loginDenied) return loginDenied;
  const limited = enforceRateLimit(request, "checkout-page", 60, 10 * 60_000);
  if (limited) return limited;
  const url = new URL(request.url);
  const transactionId = url.searchParams.get("tx") ?? "";
  if (!isUuid(transactionId)) return NextResponse.json({ error: "Send ?tx=<transactionId>." }, { status: 400 });
  const denied = await requireTransactionAccess(transactionId);
  if (denied) return denied;
  const variant: CheckoutPageVariant = url.searchParams.get("variant") === "hostile" ? "hostile" : "faithful";

  const [tx, context] = await Promise.all([getTransactionById(transactionId), getProtectedDemoContext(transactionId)]);
  if (!tx || !context) return NextResponse.json({ error: "No checkout terms were found for that order." }, { status: 404 });
  const offer = isRecord(context.current_offer) ? context.current_offer : isRecord(context.baseline_offer) ? context.baseline_offer : null;
  const quote = offer && isRecord(offer.sandboxQuote) ? offer.sandboxQuote : null;
  const itemPrice = quote ? num(quote.itemPrice) : null;
  const shipping = quote ? num(quote.shippingFee) : null;
  const tax = quote ? num(quote.taxAmount) : null;
  if (!offer || itemPrice === null || shipping === null || tax === null) {
    return NextResponse.json({ error: "This order has no itemized checkout terms to draw." }, { status: 409 });
  }
  const page = buildCheckoutPage({
    merchant: typeof offer.sourceDomain === "string" && offer.sourceDomain ? offer.sourceDomain : "merchant",
    title: typeof offer.sourceTitle === "string" && offer.sourceTitle ? offer.sourceTitle : "Your item",
    currency: typeof quote?.currency === "string" ? quote.currency : tx.currency.trim(),
    itemPrice, shipping, tax,
  }, variant);
  return NextResponse.json({ svg: renderCheckoutPageSvg(page), width: CHECKOUT_PAGE_SIZE.width, height: CHECKOUT_PAGE_SIZE.height, page: { merchant: page.merchant, title: page.title, total: page.total, currency: page.currency, variant: page.variant } }, { headers: { "Cache-Control": "no-store" } });
}
