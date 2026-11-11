import { renderStorefront } from "../../lib/demo-store";

export const dynamic = "force-static";

/** Marlow & Finch, the fictional demo storefront for trying the PactPay Guard extension. Standalone HTML on purpose. */
export function GET() {
  return new Response(renderStorefront(), { headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" } });
}
