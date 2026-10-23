# M0.9.1 — Groq + readable UI patch

## Files in this patch

- `apps/web/app/api/intent/compile/route.ts` — swaps Gemini for Groq's OpenAI-compatible Chat Completions API and strict JSON-schema output; transparently falls back to the local rule compiler for transient service problems.
- `apps/web/app/page.tsx` — updates the provider badge and response type from Gemini to Groq.
- `apps/web/app/globals.css` — increases small text sizes on the main composer and existing inline-styled product screens.
- `lib/intent-pact.ts` — allows `GROQ` as the AI compiler identifier.
- `README-M0.9-UNIFIED-PRODUCT-EXPERIENCE.md` — updates environment and setup instructions.

## Apply

Extract this ZIP into the repository root (`D:\Downloads-D\Paypal\pactpay`) and allow the files to overwrite existing versions. The archive contains repository-relative paths and no enclosing project directory.

Then add to `apps/web/.env.local`:

```dotenv
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TIMEOUT_MS=12000
```

Remove or comment out the old `GEMINI_API_KEY` and `GEMINI_MODEL` entries to avoid configuration confusion. Do not share or commit `.env.local`.

Run one command at a time:

```powershell
pnpm typecheck
pnpm test
pnpm dev
```

## Expected behavior

- With a valid Groq API key: the result badge identifies `GROQ AI · openai/gpt-oss-20b`.
- With missing key, rate limit, timeout or temporary provider error: PactPay returns an explicitly-labelled `LOCAL RULE-BASED DRAFT`, with a visible notice. It must never claim a fallback was produced by AI.
- Invalid credentials or an invalid model/schema setting return an actionable error rather than being silently hidden.
- The model compiles a draft only. The user reviews and approves it; policy enforcement and payment controls remain deterministic and server-side.
- Small microcopy is raised to a 14px minimum on inline-styled pages. Home-page labels/captions also increase from the previous 7–12px range.

## Verification note

This patch was syntax-checked locally with TypeScript's transpilation API. The complete workspace typecheck and test suite need to be run in the user's project because the isolated patch environment does not contain the project's installed workspace dependencies. Groq developer plans remain subject to provider/model rate limits.
