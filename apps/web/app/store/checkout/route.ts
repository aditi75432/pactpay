import { isScenario, renderCheckout } from "../../../lib/demo-store";

export const dynamic = "force-dynamic";

/** A checkout page that behaves honestly or hostilely depending on the scenario. Inputs are allow-listed in renderCheckout. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const scenarioParam = params.get("scenario");
  const scenario = isScenario(scenarioParam) ? scenarioParam : "honest";
  return new Response(renderCheckout(scenario, params.get("p"), params.get("qty")), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
  });
}
