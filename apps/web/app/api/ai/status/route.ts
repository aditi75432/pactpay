import { NextResponse } from "next/server";
import { modelDisplayName } from "@pactpay/pact-core/ai-labels";
import { configuredProviders, describeProviders, metaApiProvider } from "../../../../../../lib/llm-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which Meta models this deployment is wired to. Never includes a key. */
export async function GET() {
  const providers = describeProviders().map((item) => ({ ...item, modelLabel: modelDisplayName(item.model) }));
  return NextResponse.json({
    configured: configuredProviders().length > 0,
    providers,
    crossModel: providers.length > 1,
    voice: metaApiProvider() !== null,
    voiceModel: "muse-voice-transcribe-1.0",
  }, { headers: { "Cache-Control": "no-store" } });
}
