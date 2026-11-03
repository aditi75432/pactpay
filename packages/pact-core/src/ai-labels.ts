/**
 * Human-readable names for the Meta model that produced something, so the UI always says exactly what wrote it.
 */
export function modelDisplayName(model: string | null | undefined): string {
  const id = (model ?? "").toLowerCase();
  if (!id) return "Muse";
  if (id.includes("muse-spark-open")) return "Muse Spark Open";
  if (id.includes("muse-glimmer")) return "Muse Glimmer";
  if (id.includes("muse-wonder")) return "Muse Wonder";
  const spark = /muse-spark-(\d+(?:\.\d+)?)/.exec(id);
  if (spark) return `Muse Spark ${spark[1]}`;
  if (id.includes("muse-spark")) return "Muse Spark";
  if (id.includes("muse-voice")) return "Muse Voice Transcribe";
  if (id.includes("muse")) return "Muse";
  return model ?? "Muse";
}

/** True when the model is one of Meta's open-weight models (Muse Spark Open or Muse Glimmer). */
export function isMetaOpenWeights(model: string | null | undefined): boolean {
  const id = (model ?? "").toLowerCase();
  return id.includes("muse-spark-open") || id.includes("muse-glimmer");
}
