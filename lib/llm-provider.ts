/**
 * Provider gateway for PactPay. AI models only draft, reason, call constrained tools or read evidence.
 * Deterministic PactPay code retains all policy and payment-settlement authority.
 *
 * Providers:
 *   meta         Meta Model API (Muse Spark) — MODEL_API_KEY
 *   baseten      Muse Spark Open via Baseten — BASETEN_API_KEY
 *   groq         Groq text/agent model — GROQ_API_KEY + GROQ_MODEL
 *   groq-vision  Groq multimodal reader — GROQ_API_KEY + GROQ_VISION_MODEL
 */
import type { AssistantMessage, AgentToolSpec, ChatMessage } from "@pactpay/pact-core/agent-loop";

export type ProviderId = "meta" | "baseten" | "groq" | "groq-vision";
export type Effort = "minimal" | "low" | "medium" | "high";

export interface Provider {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  keyEnv: string;
  model: string;
  openWeights: boolean;
  tokenParam: "max_completion_tokens" | "max_tokens";
  reasoningEffort: boolean;
  structuredOutput: boolean;
  vision: boolean;
}

const clean = (value: string | undefined): string => (value ?? "").trim();
const BASETEN_DEFAULT_MODEL = "meta-models/muse-spark-open";
const GROQ_DEFAULT_MODEL = "openai/gpt-oss-20b";
const GROQ_DEFAULT_VISION_MODEL = "qwen/qwen3.8-27b";

function basetenModel(): string {
  const configured = clean(process.env.BASETEN_MODEL);
  return !configured || configured === "meta-models/muse-spark-open-1026" ? BASETEN_DEFAULT_MODEL : configured;
}

function groqVisionModel(): string {
  return clean(process.env.GROQ_VISION_MODEL) || GROQ_DEFAULT_VISION_MODEL;
}

function build(id: ProviderId): Provider | null {
  if (id === "meta") {
    const apiKey = clean(process.env.MODEL_API_KEY) || clean(process.env.META_API_KEY);
    if (!apiKey) return null;
    return {
      id, label: "Meta Model API", apiKey, keyEnv: "MODEL_API_KEY",
      baseUrl: (clean(process.env.META_API_BASE_URL) || "https://api.meta.ai/v1").replace(/\/$/, ""),
      model: clean(process.env.META_MODEL) || "muse-spark-1.3",
      openWeights: false, tokenParam: "max_completion_tokens", reasoningEffort: true,
      structuredOutput: true, vision: true,
    };
  }

  if (id === "baseten") {
    const apiKey = clean(process.env.BASETEN_API_KEY);
    if (!apiKey) return null;
    return {
      id, label: "Muse Spark Open (Baseten)", apiKey, keyEnv: "BASETEN_API_KEY",
      baseUrl: (clean(process.env.BASETEN_BASE_URL) || "https://inference.baseten.co/v1").replace(/\/$/, ""),
      model: basetenModel(),
      openWeights: true, tokenParam: "max_tokens", reasoningEffort: false,
      structuredOutput: false, vision: true,
    };
  }

  if (id === "groq") {
    const apiKey = clean(process.env.GROQ_API_KEY);
    if (!apiKey) return null;
    return {
      id, label: "Groq inference API", apiKey, keyEnv: "GROQ_API_KEY",
      baseUrl: (clean(process.env.GROQ_BASE_URL) || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
      model: clean(process.env.GROQ_MODEL) || GROQ_DEFAULT_MODEL,
      openWeights: false, tokenParam: "max_completion_tokens", reasoningEffort: true,
      structuredOutput: true, vision: false,
    };
  }

  // GPT-OSS 20B is text-only. Keep screenshot inspection on a separately configured multimodal model.
  const apiKey = clean(process.env.GROQ_API_KEY);
  if (!apiKey) return null;
  const model = groqVisionModel();
  const supportedVisionModel = model === "qwen/qwen3.8-27b" || model === "meta-models/muse-spark-open";
  if (!supportedVisionModel) return null;
  return {
    id, label: "Groq vision API", apiKey, keyEnv: "GROQ_API_KEY",
    baseUrl: (clean(process.env.GROQ_BASE_URL) || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    model,
    openWeights: model === "meta-models/muse-spark-open", tokenParam: "max_completion_tokens", reasoningEffort: true,
    structuredOutput: true, vision: true,
  };
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "meta" || value === "baseten" || value === "groq" || value === "groq-vision";
}

/** General text/agent provider. AI_PROVIDER is authoritative when explicitly set. */
export function resolveProvider(requested?: unknown): Provider | null {
  const forced = clean(process.env.AI_PROVIDER).toLowerCase();
  if (forced === "groq") return build("groq");
  if (forced === "meta") return build("meta");
  if (forced === "baseten") return build("baseten");

  if (isProviderId(requested) && requested !== "groq-vision") {
    const chosen = build(requested);
    if (chosen) return chosen;
  }
  return build("groq") ?? build("meta") ?? build("baseten");
}

/** Vision providers are deliberately resolved separately: GPT-OSS 20B cannot accept image inputs. */
export function resolveVisionProviders(): Provider[] {
  const forced = clean(process.env.AI_PROVIDER).toLowerCase();
  if (forced === "groq") {
    const vision = build("groq-vision");
    return vision ? [vision] : [];
  }
  if (forced === "meta") {
    return [build("meta"), build("baseten")].filter((item): item is Provider => item !== null);
  }
  if (forced === "baseten") {
    return [build("baseten"), build("meta")].filter((item): item is Provider => item !== null);
  }
  return [build("groq-vision"), build("meta"), build("baseten")].filter((item): item is Provider => item !== null);
}

export function resolveVisionProvider(): Provider | null {
  return resolveVisionProviders()[0] ?? null;
}

/** Providers configured for the selected deployment mode. */
export function configuredProviders(): Provider[] {
  const forced = clean(process.env.AI_PROVIDER).toLowerCase();
  if (forced === "groq") return [build("groq"), build("groq-vision")].filter((item): item is Provider => item !== null);
  if (forced === "meta") return [build("meta"), build("baseten")].filter((item): item is Provider => item !== null);
  if (forced === "baseten") return [build("baseten"), build("meta")].filter((item): item is Provider => item !== null);
  return [build("groq"), build("groq-vision"), build("meta"), build("baseten")].filter((item): item is Provider => item !== null);
}

export function metaApiProvider(): Provider | null {
  return build("meta");
}

export function groqSpeechConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = clean(process.env.GROQ_API_KEY);
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (clean(process.env.GROQ_BASE_URL) || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    model: clean(process.env.GROQ_STT_MODEL) || "whisper-large-v3-turbo",
  };
}

/** Per-call timeout. AI_TIMEOUT_MS wins; GROQ_TIMEOUT_MS applies to Groq deployments. */
export function aiTimeoutMs(fallbackMs: number, min = 3_000, max = 60_000): number {
  const forced = clean(process.env.AI_PROVIDER).toLowerCase();
  const raw = clean(process.env.AI_TIMEOUT_MS) || (forced === "groq" ? clean(process.env.GROQ_TIMEOUT_MS) : "");
  const configured = raw === "" ? NaN : Number(raw);
  const chosen = Number.isFinite(configured) && configured > 0 ? configured : fallbackMs;
  return Math.min(max, Math.max(min, chosen));
}

export interface ModelRequest {
  messages: ReadonlyArray<ChatMessage | { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }>;
  tools?: readonly AgentToolSpec[];
  responseFormat?: Record<string, unknown>;
  temperature?: number;
  maxTokens: number;
  effort?: Effort;
  timeoutMs: number;
}

export interface ModelReply {
  ok: boolean;
  status: number;
  content: string;
  message: AssistantMessage | null;
  usage: { promptTokens: number; completionTokens: number } | null;
  refusal: string | null;
  error: string | null;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((part) => (typeof part === "object" && part !== null && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("");
  }
  return "";
}

async function providerError(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json() as { error?: { message?: unknown; code?: unknown; type?: unknown } | string };
    const error = payload.error;
    if (typeof error === "string") return error.slice(0, 400);
    if (error && typeof error === "object") {
      const parts = [error.message, error.type, error.code].filter((value): value is string => typeof value === "string" && value.length > 0);
      if (parts.length) return parts.join(" | ").slice(0, 500);
    }
  } catch { /* not JSON */ }
  return `HTTP ${response.status}`;
}

async function once(provider: Provider, request: ModelRequest): Promise<ModelReply> {
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: request.messages,
    temperature: request.temperature ?? 0,
    [provider.tokenParam]: request.maxTokens,
  };
  if (request.effort && provider.reasoningEffort) {
    body.reasoning_effort = provider.id.startsWith("groq") && request.effort === "minimal" ? "low" : request.effort;
  }
  if (provider.id.startsWith("groq")) {
    // GPT-OSS supports tool calls but not parallel tool calls. Hiding reasoning keeps the replayed
    // assistant/tool transcript compatible with PactPay's bounded agent loop.
    body.include_reasoning = false;
    if (request.tools?.length) body.parallel_tool_calls = false;
  }
  if (request.responseFormat && provider.structuredOutput) body.response_format = request.responseFormat;
  if (request.tools && request.tools.length > 0) {
    body.tools = request.tools.map((tool) => ({ type: "function", function: tool }));
    body.tool_choice = "auto";
    if (provider.id === "meta") body.parallel_tool_calls = false;
  }
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(request.timeoutMs),
    });
    if (!response.ok) {
      const detail = await providerError(response);
      const hint = response.status === 404 && provider.id === "baseten" ? ` (model "${provider.model}" was not found: set BASETEN_MODEL to a slug from GET ${provider.baseUrl}/models)` : "";
      return { ok: false, status: response.status, content: "", message: null, usage: null, refusal: null, error: detail + hint };
    }
    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: unknown; refusal?: unknown; tool_calls?: AssistantMessage["tool_calls"] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = payload.choices?.[0]?.message;
    const content = contentText(message?.content);
    const calls = Array.isArray(message?.tool_calls) ? message.tool_calls : undefined;
    return {
      ok: true, status: 200, content,
      message: { role: "assistant", content: content || null, ...(calls && calls.length > 0 ? { tool_calls: calls } : {}) },
      usage: payload.usage ? { promptTokens: payload.usage.prompt_tokens ?? 0, completionTokens: payload.usage.completion_tokens ?? 0 } : null,
      refusal: typeof message?.refusal === "string" && message.refusal ? message.refusal : null,
      error: null,
    };
  } catch (error) {
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ok: false, status: 0, content: "", message: null, usage: null, refusal: null, error: timeout ? "The model did not answer in time." : "The model could not be reached." };
  }
}

export async function callModel(provider: Provider, request: ModelRequest): Promise<ModelReply> {
  const first = await once(provider, request);
  if (first.status === 429 || first.status === 503 || first.status === 502) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return once(provider, request);
  }
  return first;
}

export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(), /\{[\s\S]*\}/.exec(trimmed)?.[0] ?? ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the next form */ }
  }
  return null;
}

export function describeProviders(): Array<{ id: ProviderId; label: string; model: string; openWeights: boolean; vision: boolean }> {
  return configuredProviders().map((provider) => ({ id: provider.id, label: provider.label, model: provider.model, openWeights: provider.openWeights, vision: provider.vision }));
}
