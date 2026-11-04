/**
 * The Meta model gateway. Every AI call in PactPay goes through here, and every provider is a Meta model:
 *
 *   meta     Meta Model API (https://api.meta.ai/v1), Muse Spark. Key: MODEL_API_KEY (alias META_API_KEY).
 *   baseten  Muse Spark Open, Meta's open-weight model, served by Baseten. Key: BASETEN_API_KEY.
 *
 * Pick one with AI_PROVIDER, or let the order above decide. When both are configured the Checkout Inspector
 * uses them as two independent readers. The model only ever drafts or reads. It never has authority over a
 * payment: the settlement gate is fixed code.
 *
 * Notes taken from Meta's Chat Completions docs (dev.meta.ai):
 *   - output cap is `max_completion_tokens` (`max_tokens` is a deprecated alias)
 *   - `reasoning_effort` accepts minimal | low | medium | high | xhigh ("none" is a 400 on Muse Spark)
 *   - structured output uses response_format { type: "json_schema" }; tool_choice supports only "auto"
 *   - a tool-calling transcript must replay the assistant message and answer every tool_call
 */
import type { AssistantMessage, AgentToolSpec, ChatMessage } from "@pactpay/pact-core/agent-loop";

export type ProviderId = "meta" | "baseten";
export type Effort = "minimal" | "low" | "medium" | "high";

export interface Provider {
  id: ProviderId;
  label: string;
  baseUrl: string;
  apiKey: string;
  keyEnv: string;
  model: string;
  /** True for Meta's open-weight models, which also qualify for the open-weights prize. */
  openWeights: boolean;
  /** Parameter this provider uses to cap output length. */
  tokenParam: "max_completion_tokens" | "max_tokens";
  /** Whether the provider documents `reasoning_effort`. */
  reasoningEffort: boolean;
  /** Whether `response_format: json_schema` is supported. Muse Spark Open on Baseten has no structured-output or JSON mode. */
  structuredOutput: boolean;
}

const clean = (value: string | undefined): string => (value ?? "").trim();

const BASETEN_DEFAULT_MODEL = "meta-models/muse-spark-open";
/** An earlier example file used a `-1026` suffix that Baseten answers with 404, so that value is treated as the default. */
function basetenModel(): string {
  const configured = clean(process.env.BASETEN_MODEL);
  return !configured || configured === "meta-models/muse-spark-open-1026" ? BASETEN_DEFAULT_MODEL : configured;
}

function build(id: ProviderId): Provider | null {
  if (id === "meta") {
    const apiKey = clean(process.env.MODEL_API_KEY) || clean(process.env.META_API_KEY);
    if (!apiKey) return null;
    return {
      id, label: "Meta Model API", apiKey, keyEnv: "MODEL_API_KEY",
      baseUrl: (clean(process.env.META_API_BASE_URL) || "https://api.meta.ai/v1").replace(/\/$/, ""),
      model: clean(process.env.META_MODEL) || "muse-spark-1.3",
      openWeights: false, tokenParam: "max_completion_tokens", reasoningEffort: true, structuredOutput: true,
    };
  }
  const apiKey = clean(process.env.BASETEN_API_KEY);
  if (!apiKey) return null;
  return {
    id, label: "Muse Spark Open (Baseten)", apiKey, keyEnv: "BASETEN_API_KEY",
    baseUrl: (clean(process.env.BASETEN_BASE_URL) || "https://inference.baseten.co/v1").replace(/\/$/, ""),
    model: basetenModel(),
    openWeights: true, tokenParam: "max_tokens", reasoningEffort: false, structuredOutput: false,
  };
}

function isProviderId(value: unknown): value is ProviderId {
  return value === "meta" || value === "baseten";
}

/**
 * Chooses the provider. `requested` (for example the UI asking for the open-weights model) is honored only when
 * that provider is configured; otherwise AI_PROVIDER, then Meta Model API, then Muse Spark Open.
 */
export function resolveProvider(requested?: unknown): Provider | null {
  if (isProviderId(requested)) {
    const chosen = build(requested);
    if (chosen) return chosen;
  }
  const forced = clean(process.env.AI_PROVIDER).toLowerCase();
  if (isProviderId(forced)) {
    const chosen = build(forced);
    if (chosen) return chosen;
  }
  return build("meta") ?? build("baseten");
}

/** Providers that are configured right now. */
export function configuredProviders(): Provider[] {
  return (["meta", "baseten"] as const).map(build).filter((item): item is Provider => item !== null);
}

/** The Meta Model API provider, needed for models that exist only there (Muse Voice Transcribe). */
export function metaApiProvider(): Provider | null {
  return build("meta");
}

/**
 * Per-call timeout. AI_TIMEOUT_MS overrides the default, but a blank or invalid value (for example a copied
 * `AI_TIMEOUT_MS=` line) means "not set". It must never turn into 0 and clamp every call to the minimum.
 */
export function aiTimeoutMs(fallbackMs: number, min = 3_000, max = 60_000): number {
  const raw = clean(process.env.AI_TIMEOUT_MS);
  const configured = raw === "" ? NaN : Number(raw);
  const chosen = Number.isFinite(configured) && configured > 0 ? configured : fallbackMs;
  return Math.min(max, Math.max(min, chosen));
}

export interface ModelRequest {
  messages: ReadonlyArray<ChatMessage | { role: string; content?: unknown; tool_calls?: unknown; tool_call_id?: string }>;
  tools?: readonly AgentToolSpec[];
  /** e.g. { type: "json_schema", json_schema: { name, schema, strict: false } } */
  responseFormat?: Record<string, unknown>;
  temperature?: number;
  maxTokens: number;
  effort?: Effort;
  timeoutMs: number;
}

export interface ModelReply {
  ok: boolean;
  /** HTTP status, or 0 when the request never completed (timeout, network). */
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
    const payload = await response.clone().json() as { error?: { message?: unknown; code?: unknown } | string };
    const error = payload.error;
    if (typeof error === "string") return error.slice(0, 400);
    if (error && typeof error === "object" && typeof error.message === "string") return error.message.slice(0, 400);
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
  if (request.effort && provider.reasoningEffort) body.reasoning_effort = request.effort;
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

/** Calls the provider once, retrying a single time on rate limits and brief outages. Never throws. */
export async function callModel(provider: Provider, request: ModelRequest): Promise<ModelReply> {
  const first = await once(provider, request);
  if (first.status === 429 || first.status === 503 || first.status === 502) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    return once(provider, request);
  }
  return first;
}

/** Pulls a JSON value out of model text that may be wrapped in a code fence or chatter. */
export function parseModelJson(content: string): unknown {
  const trimmed = content.trim();
  const candidates = [trimmed, trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim(), /\{[\s\S]*\}/.exec(trimmed)?.[0] ?? ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the next form */ }
  }
  return null;
}

/** Safe-to-show description of what is configured. Never includes a key. */
export function describeProviders(): Array<{ id: ProviderId; label: string; model: string; openWeights: boolean }> {
  return configuredProviders().map((provider) => ({ id: provider.id, label: provider.label, model: provider.model, openWeights: provider.openWeights }));
}
