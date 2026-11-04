# Reusing this project for another hackathon (PayPal)

The product, README, diagrams and demo are written so that moving from the Meta hackathon to the PayPal hackathon is a short edit, not a rewrite. If you win a Meta prize you don't need this; if not, follow it after results (Nov 9).

## What stays exactly the same
Problem, solution, architecture diagrams, limitations, threat model, ADRs, the code, the demo kit. The PayPal story is already native: authorize-then-capture (ADR-001), Orders and Payments, void on block, webhooks.

## What to change (about 30 minutes)

1. **README top block.** Edit only the section between `HACKATHON:START` and `HACKATHON:END`: new hackathon name, track, new links.
2. **README "Tools used" and the first paragraph.** Re-order so PayPal is first and Muse second ("PayPal is the money layer, Meta Muse the brain"). Keep the table; just swap the row order.
3. **Demo video.** Re-cut scene 4 (hold, capture, action centre) to 40-45 seconds and show an actual capture on a *passing* order as well as the voided one. Trim scene 3 (voice) to 10 seconds. Keep scene 6 (the Inspector blocking a capture). Keep to the PayPal time limit.
4. **Submission text.** Use `docs/hackathons/PAYPAL-SUBMISSION.md` and fill the placeholders.
5. **Search and replace** the strings below.

| Find | Replace with |
|---|---|
| `Meta Global AI Developer Hackathon` | PayPal hackathon name |
| `Indie Developer track` / `Build for Your World` | PayPal track / theme |
| `Built for:` line | PayPal line |
| `Most Viral`, `Best Agentic Use-Case`, `Best Build on Meta Open Weight Models` | PayPal prize categories |

6. **Do not** remove the "Foundation and the Meta layer" section; it keeps the project description accurate under any rules about new work.
7. Re-run `pnpm --filter @pactpay/pact-core test` and `pnpm --filter web build`. Publish the repo tag, e.g. `paypal-submission`.

## Check before submitting
- PayPal prize rules: new-work rules, required APIs, video length, and whether the repo must be public.
- Add the PayPal buyer test login to the judge instructions.
- Run one fresh Sandbox capture to be sure credentials still work.
