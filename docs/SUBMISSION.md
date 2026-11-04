# Cerebral Valley submission: answers, field by field

Paste-ready answers for the Meta Global AI Developer Hackathon form. Fields marked **YOU** need your own facts or your own opinion; a draft is given where it helps. Do not claim experiences you didn't have: the judges read these.

**Deadline:** Wed Nov 4, 9:00 PM ET (= Thu Nov 5, 7:30 AM IST). Aim to submit on Nov 3.

---

### Which track are you submitting to?
**Indie Developer.**

### Which problem statement did you build towards?
**Build for Your World**: a tool for people who delegate shopping to AI agents and need to trust it with their money.

### Most Viral Track: X post link
**YOU:** post, then paste the link. Draft:

> AI agents can shop. Nobody trusts them with money.
> So I built PactPay × @Meta Muse: an agent that shops for you, reads the real checkout page, and can't be talked into overspending.
> Muse reads. A fixed gate decides.
> 🎥 [video] · 💻 [repo] #MetaHackathon

Attach a 20-second cut of scene 6 of the demo (the hidden-fee page and "Do not pay").

### Project description
AI agents can already browse and check out, but nobody trusts them with their money: one hidden fee or one line of small print aimed at the agent can make it overspend. PactPay × Meta Muse lets an agent shop while a fixed gate keeps the final say.

You speak or type what you want. Muse Voice Transcribe hears you and Muse Spark drafts editable rules; you approve them once and they're hashed and locked. A Muse agent then shops by calling tools live: it reads your rules, searches real stores, ranks offers and asks for a PayPal hold, and PactPay refuses anything outside your limits. Everything runs as one workflow: Shop, then the live Muse agent, then PayPal, then the order page where the checkout is inspected. Before money moves, the checkout page is read twice (two different Meta models when both are configured, one of them open weights). Fixed code checks that the readings agree, that the itemized lines add up to the total, and flags text aimed at an AI (a tripwire; the budget rules and settlement gate are what protect the money). The verdict is stored on the order and the settlement gate reads it, so a "Do not pay" blocks the capture and voids the hold even if the person approved it. The model reads. It never decides.

Any other agent can plug in too: a limited, expiring agent key, an MCP server and an HTTP gateway, with every abuse refused (`pnpm agent:redteam`).

### Public GitHub repository
**YOU:** `https://github.com/<your-user>/<repo>` (must be public; check in a private window).

### 3-minute demo video
**YOU:** unlisted YouTube link, opened and tested in a private window. Build it from [`demo-kit/`](../demo-kit/README.md).

### Describe your use of Meta products to build the submitted project
- **Muse Spark 1.3 (Meta Model API)** is the primary model, through one gateway (`lib/llm-provider.ts`): strict `json_schema` output to draft rules; a tool-calling agent loop (`tool_choice: "auto"`, full tool-call replay) that runs the shopping agent; vision (`image_url`) to read checkout screenshots; seller-listing extraction that keeps only verbatim quotes; plain-English explanations that are discarded if they introduce a number.
- **Muse Spark Open via Baseten** (open weights) runs the same features and is the second, independent reader in the Checkout Inspector, so two different Meta models must agree.
- **Muse Voice Transcribe 1.0** powers push-to-talk: the browser records mono 16-bit WAV and posts it to `/v1/asr/transcribe`.
- Every model output is untrusted data: parsed, bounded and validated before use. No model sits in the settlement gate.

### Why are Meta's models important to your solution?
This product needs one model family that can hear, see, read and act: voice for the request, vision for the real checkout page, structured output for rules, tool calling for the agent. Muse Spark covers all of that behind one OpenAI-compatible API, so the whole product runs on a single provider. The open-weight Muse Spark Open lets us run the same safety checks on weights a platform can host itself, which matters to the AI platforms and marketplaces that would embed a payment guard. And using two different Meta models as independent readers is only possible because there is a closed and an open model from the same family.

### Provide feedback from your experience using partner technologies
**YOU** (Baseten, PayPal Sandbox, Channel3). Factual points from the build you can adapt only if they match your runs:
- Baseten serves Muse Spark Open behind an OpenAI-compatible endpoint, but caps output with `max_tokens` whereas the Meta API uses `max_completion_tokens`; the gateway handles both.
- PayPal Sandbox's authorize-then-capture flow made the "hold, check, then capture" design natural.
- Channel3 gives real offers, but shipping, tax and final checkout totals are not in the catalog, which is why the Inspector exists.

### How likely are you to build with Meta Model API? / Overall opinion / Recommend (API) / Recommend Muse Code
**YOU.** These are your honest scores. If you ran the app with a real key, base them on that. If you didn't use Muse Code, say so or leave it blank.

### What was the biggest obstacle your team hit?
**YOU** (draft to adapt to what actually happened):
> Reasoning latency versus interactive timeouts. Muse Spark reasons before answering, so our first interactive timeouts (a few seconds) made rule drafting fail with "The model did not answer in time". We fixed it by sending `reasoning_effort: "minimal"` on short structured calls, raising and clamping the timeout, and making a blank `AI_TIMEOUT_MS` fall back to the default. Second: protocol strictness (tool-call replay, `tool_choice` supports only `auto`, WAV-only audio) meant we had to build a small, well-tested agent loop and a WAV encoder rather than rely on a generic SDK.

### Compared with other AI models you've used for the same work, how did Meta's models perform?
**YOU.** Pick the real answer. If you only used Meta models, say that.

### What matters most when choosing a model or coding tool? / specify
**YOU.** Suggested for this project: tool-calling reliability, vision accuracy on documents, structured-output compliance, latency, and open-weight availability.

### What makes it hardest to switch to a different model or tool?
**YOU.** Suggested: our prompts and schemas are tuned to Muse Spark's behavior; switching means re-validating the Inspector's readings. The gateway is provider-agnostic, so the code cost is low; the testing cost is the real one.

### If you took this to production, what would most likely stop you from using Meta's models?
**YOU.** Honest candidates: data-residency and retention terms for payment-adjacent screenshots; rate limits and latency at checkout scale; wanting a model we can pin to a version; and the need to self-host the open-weight model.

---

## What is new, and what existed

The form asks you to be clear about this. Use this wording:

> PactPay's policy engine, settlement gate, PayPal Sandbox flow, agent keys, evidence tools and activity console are the foundation. The Meta layer is what this submission adds: the Meta model gateway, Muse Voice Transcribe, rule drafting on Muse Spark, the tool-calling Muse Agent, the two-reader Checkout Inspector, its connection to the settlement gate, and the open-weights path.

Only describe the foundation as foundation. The video spends most of its time on the Meta layer.

## Prize categories to flag
Best Agentic Use-Case (Muse Agent) · Best Build on Meta Open Weight Models (Muse Spark Open as an independent reader in the safety path) · Most Viral (X post).

## Checklist
- [ ] Repo public; README shows the hosted URL and video link (edit the marked block at the top)
- [ ] Hosted app works with a fresh account; `MODEL_API_KEY` set on the host; tested in a private window
- [ ] Video 3:00 or less, link opens without a login
- [ ] All contributors listed on the form; one representative
- [ ] Meta credits claimed (by Nov 4, 9:00 PM ET) and a spend limit set
- [ ] Ran the full Shop workflow once with a real key: honest checkout (paid), hostile checkout (blocked), tempt run, voice input
- [ ] X post published and link submitted
- [ ] Submitted before Wed Nov 4, 9:00 PM ET
