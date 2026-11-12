import { NextResponse } from "next/server";
import { modelDisplayName } from "@pactpay/pact-core/ai-labels";
import { configuredProviders, describeProviders, groqSpeechConfig, metaApiProvider, resolveVisionProviders } from "../../../../../../lib/llm-provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const providers = describeProviders().map((item) => ({ ...item, modelLabel: modelDisplayName(item.model) }));
  const visionProviders = resolveVisionProviders();
  const crossModel = visionProviders.length > 1 && visionProviders[0]!.model !== visionProviders[1]!.model;
  const groqSelected = process.env.AI_PROVIDER?.trim().toLowerCase() === "groq";
  return NextResponse.json({
    configured: configuredProviders().length > 0,
    providers,
    crossModel,
    vision: visionProviders.length > 0,
    voice: groqSelected ? groqSpeechConfig() !== null : (metaApiProvider() !== null || groqSpeechConfig() !== null),
    voiceModel: groqSelected ? (groqSpeechConfig()?.model ?? null) : (metaApiProvider() ? "muse-voice-transcribe-1.0" : (groqSpeechConfig()?.model ?? null)),
  }, { headers: { "Cache-Control": "no-store" } });
}
