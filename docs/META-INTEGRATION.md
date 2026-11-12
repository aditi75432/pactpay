# AI provider integration notes

The hosted Render configuration in `render.yaml` selects Groq. The runtime models are configured through `GROQ_MODEL`, `GROQ_VISION_MODEL` and `GROQ_STT_MODEL`. GPT-OSS 20B is text-only, so PactPay uses a separate vision-capable Groq model for checkout screenshots.

The application also retains the Meta and Baseten adapters described below for local testing or alternative deployments. Do not describe Meta Muse as the active hosted model unless `/api/ai/status` actually reports a Muse model.

# Meta integration

Every AI call goes through one file: [`lib/llm-provider.ts`](../lib/llm-provider.ts). The gateway supports Groq as the hosted configuration and retains Meta/Baseten adapters for optional deployments.

## Providers

| Provider | Model (default) | Endpoint | Key |
|---|---|---|---|
| Groq text / agent | `openai/gpt-oss-20b` | `https://api.groq.com/openai/v1/chat/completions` | `GROQ_API_KEY` |
| Groq vision | `qwen/qwen3.8-27b` | `https://api.groq.com/openai/v1/chat/completions` | `GROQ_API_KEY` |
| Groq voice | `whisper-large-v3-turbo` | `https://api.groq.com/openai/v1/audio/transcriptions` | `GROQ_API_KEY` |
| Meta Model API (optional) | `muse-spark-1.3` | `https://api.meta.ai/v1/chat/completions` | `MODEL_API_KEY` |
| Muse Spark Open via Baseten (optional) | `meta-models/muse-spark-open` | `https://inference.baseten.co/v1/chat/completions` | `BASETEN_API_KEY` |

`AI_PROVIDER=groq|meta|baseten` forces the hosted text/agent provider. `AI_PROVIDER=groq` uses `GROQ_MODEL` for text and `GROQ_VISION_MODEL` for screenshot reading. With neither key the app says so and uses a local rule parser. The header chip (`/api/ai/status`) always shows which models are live.

## Where each model is used

| Feature | Route | Model behavior |
|---|---|---|
| Rules from words | `POST /api/intent/compile` | `response_format: json_schema` (strict). On HTTP 400, retries with the schema in the prompt. Output is validated by `normalizeIntentCompilation`. |
| Voice input | `POST /api/voice/transcribe` | Browser records mono 16-bit WAV at 24 kHz (`pact-core/src/wav.ts`); server posts multipart `request` + `audio`. |
| Muse Agent (`/agent` step) | `POST /api/muse-agent` (NDJSON stream) | Tool calling with `tool_choice: "auto"`; loop in `pact-core/src/agent-loop.ts`. |
| Checkout inspection (order page, automatic) | `GET /api/shop/checkout-page` then `POST /api/inspector/checkout` | Two parallel vision calls with `image_url` data URLs. Two differently prompted vision reads; with the hosted Groq profile both use the configured Groq vision model. |
| Seller-text reader | `POST /api/evidence/extract` | Claims kept only if the quote appears verbatim in the source. |
| Inspector → settlement | `POST /api/inspector/checkout` with `transactionId` | Verdict saved per order; read by the settlement route as a gate fact. |
| Outcome explanation | `POST /api/explain` | Discarded if it introduces any number not in the input. |

## Protocol details we follow (from dev.meta.ai docs)

- Output cap is `max_completion_tokens` (Meta); Baseten uses `max_tokens`.
- `reasoning_effort` is `minimal`/`low` for fast calls. `"none"` is never sent (it returns 400 on Muse Spark).
- Structured output uses `json_schema` only.
- `tool_choice` is `"auto"` only; `parallel_tool_calls: false` on Meta.
- Every `tool_call` gets exactly one `tool` reply, and the assistant message is replayed in full (the API 400s otherwise).
- Images go in `user` messages as `image_url` with a base64 data URL.

## Design decisions

1. **The model never decides money.** Every model output is data that crosses a validator or the gate. See ADR-002.
2. **Two readers.** A single vision read can be fooled by what it reads. Independent reads that must agree are cheap insurance.
3. **Unknown is not safe.** Anything unreadable, missing or contested ends in *Can't verify*.
4. **Open weights in the safety path.** Muse Spark Open is a first-class provider, so the same safeguards run on weights you can host yourself.

## Tests

`pnpm --filter @pactpay/pact-core test` covers the gate, the Inspector's verdict for every built-in sample (with a perfect reading), the agent loop's protocol guarantees, and WAV encoding, with no network.

## Timeouts

`AI_TIMEOUT_MS` is optional. A blank or non-numeric value falls back to the route default, and any value is clamped to 3-60 seconds. The Groq adapter maps `minimal` to `low`; set `GROQ_TIMEOUT_MS` for Groq calls, or `AI_TIMEOUT_MS` to override all provider defaults.

## What has and hasn't been verified

The request shapes were checked against a local mock that enforces the documented protocol. Run one full Shop workflow (both the honest and the hostile checkout), the tempt run, and one voice input against a real key before recording.

## Muse Spark Open on Baseten

Model `meta-models/muse-spark-open` at `https://inference.baseten.co/v1`. It uses `max_tokens`, accepts `image_url`, and has **no structured-output or JSON mode**, so the gateway never sends `response_format` to it: JSON is requested in the prompt and parsed by the same strict validators. An older example value ending in `-1026` is treated as this default. A 404 means the model slug is wrong: list valid slugs with `GET https://inference.baseten.co/v1/models`.
