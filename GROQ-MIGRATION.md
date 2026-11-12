# PactPay Groq deployment migration

This patch adds Groq as a first-class runtime provider to the uploaded PactPay source tree.

## Runtime split

- `openai/gpt-oss-20b` via Groq handles natural-language intent compilation, text responses and the tool-calling shopping agent.
- `qwen/qwen3.8-27b` via Groq handles checkout screenshots. GPT-OSS 20B is text-only, so it must not be used for image inspection.
- `whisper-large-v3-turbo` via Groq handles voice transcription.
- The final policy decision and PayPal capture/void remain deterministic PactPay code.

The Groq vision model must be enabled for your Groq API key. Before deploying, run the model-list check in PowerShell and confirm `qwen/qwen3.8-27b` is returned. If your account instead exposes `meta-models/muse-spark-open`, you may set `GROQ_VISION_MODEL=meta-models/muse-spark-open`; only do that if the model is actually listed for your key.

## Apply

1. Extract this patch over the PactPay repository root, preserving folders.
2. Ensure Render has `GROQ_API_KEY` set as a secret. Do not put the key in Git.
3. The updated `render.yaml` sets `AI_PROVIDER=groq`, `GROQ_MODEL=openai/gpt-oss-20b`, `GROQ_VISION_MODEL=qwen/qwen3.8-27b`, `GROQ_STT_MODEL=whisper-large-v3-turbo` and `GROQ_TIMEOUT_MS=12000`.
4. Commit and push the changed files; let Render deploy.
5. Check `/api/ai/status`. It should report GPT-OSS 20B and Qwen 3.8 27B, and voice should report Whisper Large v3 Turbo.

`AI_TIMEOUT_MS`, when set, takes precedence over `GROQ_TIMEOUT_MS`. Leave `AI_TIMEOUT_MS` unset unless you intentionally want one timeout to override every route.

## Smoke test

1. Compile a Purchase Pact from text.
2. Run the shopping agent and verify it calls its tools and returns a shortlist.
3. Open the Checkout Inspector and verify it can inspect a screenshot.
4. Run the hostile-checkout scenario and confirm the deterministic gate blocks and voids.
5. Run the safe scenario and confirm PayPal Sandbox captures once.
6. Test voice transcription.
7. Test PactPay Guard against the demo store and the Walmart unknown-tax case.

## Submission accuracy

The UI uses product-level `PactPay AI` wording, while the live status endpoint shows the actual model IDs. Public submission materials must name Groq, GPT-OSS 20B, Qwen 3.8 27B and Whisper if these are the deployed models. Do not describe GPT-OSS or Qwen as Muse models. If you later switch to Groq-hosted `meta-models/muse-spark-open`, identify it as Muse Spark Open via Groq.

## Validation limitation

The uploaded ZIP did not include installed `node_modules`, and pnpm was not available in this environment, so a complete Next.js build could not be run here. The patch was inspected and TypeScript diagnostics were checked, but the missing dependencies prevent a meaningful full typecheck. Run `pnpm install --frozen-lockfile`, `pnpm --filter web typecheck` and `pnpm --filter web build` locally before deploying.
