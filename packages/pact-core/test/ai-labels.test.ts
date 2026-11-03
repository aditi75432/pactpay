import { describe, expect, it } from "vitest";
import { isMetaOpenWeights, modelDisplayName } from "../src/ai-labels";

describe("model labels", () => {
  it("names Meta's models precisely, open weights first", () => {
    expect(modelDisplayName("muse-spark-1.3")).toBe("Muse Spark 1.3");
    expect(modelDisplayName("muse-spark-1.3-contributor")).toBe("Muse Spark 1.3");
    expect(modelDisplayName("meta-models/muse-spark-open-1026")).toBe("Muse Spark Open");
    expect(modelDisplayName("muse-glimmer-1")).toBe("Muse Glimmer");
    expect(modelDisplayName("muse-voice-transcribe-1.0")).toBe("Muse Voice Transcribe");
    expect(modelDisplayName(null)).toBe("Muse");
  });
  it("recognizes only Meta open-weight models as open weights", () => {
    expect(isMetaOpenWeights("meta-models/muse-spark-open-1026")).toBe(true);
    expect(isMetaOpenWeights("muse-glimmer-1")).toBe(true);
    expect(isMetaOpenWeights("muse-spark-1.3")).toBe(false);
  });
});
