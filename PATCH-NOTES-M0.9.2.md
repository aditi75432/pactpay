# PactPay M0.9.2 — Groq structured-output compatibility

## Files
- `apps/web/app/api/intent/compile/route.ts`

## Why
The previous route returned a generic error for every Groq HTTP 400 and did not read the provider error body, so it could not reveal whether the model, request parameters, or schema was rejected.

## Behavior
1. Keeps strict JSON Schema mode as the first attempt.
2. Logs the provider's sanitized error message (message/code/type, truncated) server-side when Groq returns HTTP 400.
3. Retries once with Groq JSON Object Mode if strict structured output is rejected.
4. Supplies the desired schema as explicit prompt instructions for that retry.
5. Always runs successful model output through `normalizeIntentCompilation` before returning it to the UI. Unsupported fields, invalid comparators, invalid numeric/date values, too many constraints, and invalid currency still fail validation and are shown as a clearly labelled local rule-based draft.
6. Adds an explicit user-facing notice when JSON Object Mode is used; the UI must not present the fallback path as strict constrained output.

## Apply
Extract the ZIP directly into the PactPay repository root and overwrite the included file. No dependencies or database migrations are required.

Run from repository root, one command at a time:

```powershell
pnpm typecheck
pnpm test
pnpm dev
```

Try the Purchase Pact compiler. If the first strict-mode request is rejected but JSON Object Mode succeeds, the result notice should mention that and the server console should log the provider's original error. If both fail, the interface will transparently show the local rule-based draft and the console will contain the provider error needed for diagnosis.
