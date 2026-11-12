/**
 * Human-readable names for the configured model, so the UI always identifies what produced an AI result.
 */
export function modelDisplayName(model: string | null | undefined): string {
  const id = (model ?? "").toLowerCase();
  if (!id) return "AI model";
  if (id.includes("muse-spark-open")) return "Muse Spark Open";
  if (id.includes("muse-glimmer")) return "Muse Glimmer";
  if (id.includes("muse-wonder")) return "Muse Wonder";
  const spark = /muse-spark-(\d+(?:\.\d+)?)/.exec(id);
  if (spark) return `Muse Spark ${spark[1]}`;
  if (id.includes("muse-spark")) return "Muse Spark";
  if (id.includes("muse-voice")) return "Muse Voice Transcribe";
  if (id.includes("openai/gpt-oss-20b")) return "GPT-OSS 20B";
  if (id.includes("openai/gpt-oss-120b")) return "GPT-OSS 120B";
  if (id.includes("qwen/qwen3.8-27b")) return "Qwen 3.8 27B";
  if (id.includes("muse")) return "Muse";
  return model ?? "AI model";
}

/** True when the model is one of Meta's open-weight models (Muse Spark Open or Muse Glimmer). */
export function isMetaOpenWeights(model: string | null | undefined): boolean {
  const id = (model ?? "").toLowerCase();
  return id.includes("muse-spark-open") || id.includes("muse-glimmer");
}
