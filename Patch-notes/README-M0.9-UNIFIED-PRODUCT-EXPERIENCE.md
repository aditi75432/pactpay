# PactPay M0.9 — Unified Product Experience (Groq configuration)

M0.9 creates a user-facing Pact Composer that turns natural-language shopping intent into a reviewable Purchase Pact, then hands the approved pact to live Channel3 offer discovery. The model only drafts candidate constraints. PactPay normalizes the response, and the user must approve the draft before use. The model cannot create orders, authorize funds, capture funds or change a user-approved hard constraint.

## Configure Groq

Add the following server-side variables to `apps/web/.env.local`:

```dotenv
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=12000
```

Keep `GROQ_API_KEY` private. Do not use a `NEXT_PUBLIC_` prefix, commit `.env.local`, or share screenshots that expose the key. Restart `pnpm dev` after changing environment variables. The route calls Groq's OpenAI-compatible Chat Completions API directly, so no additional npm dependency is required. The default `openai/gpt-oss-20b` model is selected because Groq currently documents it as supporting strict JSON-schema structured outputs.

Groq applies account/model-specific rate limits. When the key is absent, the provider times out, a transient service failure occurs, or the rate limit is reached, PactPay can return the local rule-based draft with an explicit warning that it is **not an AI result**. Invalid credentials and model/schema configuration errors remain visible rather than being silently presented as AI output.

## Run and verify

From the repository root, run each command separately:

```powershell
pnpm typecheck
pnpm test
pnpm dev
```

Open `http://localhost:3000`. Submit an intent, confirm the result badge says `GROQ AI · openai/gpt-oss-20b`, and review the assumptions and rules before approving. If Groq is unavailable, the result must show `LOCAL RULE-BASED DRAFT` and a visible notice. Do not interpret schema-valid output as evidence that merchant facts are true; catalog evidence is evaluated separately.

## M0.9.1 changes

- Replaces Gemini intent compilation with Groq Chat Completions using strict JSON Schema.
- Uses `GROQ_API_KEY`, `GROQ_MODEL` and `GROQ_TIMEOUT_MS`.
- Adds explicitly-labelled local fallback on missing key, timeout, 429 and temporary 5xx responses.
- Updates the compiler badge to identify Groq rather than Gemini.
- Increases small typography throughout the Pact Composer and inline-styled discovery, evidence, policy lab and protected Sandbox screens for readability and screen recording.

## Safety boundary

Groq generates a draft only. `normalizeIntentCompilation` validates the output and `sanitizePurchasePact` remains the trust boundary for pact shape. Human approval is still required. The normal Channel3 discovery flow does not itself represent a completed real-retailer checkout; PayPal functionality shown in this prototype remains Sandbox-only.
