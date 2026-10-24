# Demo video script (target 2:50, hard limit 3:00)

Your first recording ran 7:00 with no audio. Judges aren't required to watch past 3:00, and a silent video can't explain the idea. Record with a voiceover, one browser tab, 1080p, browser zoom 125%.

Setup: fresh browser profile; one released and one blocked order already in Activity; run **Reset the simulation** first; a terminal ready with `pnpm agent:redteam` and an agent key. No retailer pages, no CAPTCHAs, no third-party logos, no copyrighted music.

**0:00 - 0:15 · Problem** (home page)
"AI agents can shop for you, but most people won't let them, and when it goes wrong the platform gets blamed. Nothing checks the deal at the moment money moves."

**0:15 - 0:35 · Rules and autonomy**
"I describe what I want. AI turns it into rules I can edit. I choose how much my agent does alone: ask above fifty dollars. Both are locked on the server."

**0:35 - 1:00 · The agent works** (shortlist, countdown)
"It searches real stores, reads the seller's listing with AI, and picks the best match. It's about to place a PayPal hold. I can cancel. I won't."

**1:00 - 1:10 · PayPal**
"PayPal says Pay, but this only places a hold. Nothing is charged."

**1:10 - 1:50 · The moment** (order screen with countdown)
"The agent will re-check the live offer and settle by itself. I'll make the seller sell out. This panel simulates a seller, because a sandbox can't pay a real store. The re-check is real. Blocked, hold voided, zero captured."

**1:50 - 2:15 · Recovery** (attempts table, decision receipt)
"The agent skips that offer and picks a different one. Both attempts are here: the first voided with nothing captured and why, the second verified on its own. This receipt shows each rule, what was observed, and PASS, FAIL or UNKNOWN."

**2:15 - 2:35 · Any agent** (terminal, red-team)
"Any AI agent can connect with a limited key, over MCP or HTTP. Watch a misbehaving agent try to change my rules, release money above my limit, and use someone else's order. Every attack is refused."

**2:35 - 2:50 · Close** (Activity grid)
"Every attempt is in this live grid: what was captured, what was voided, and why. The agent can recommend. It can't release your money without passing the gate. That's PactPay."
