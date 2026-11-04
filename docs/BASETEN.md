# Baseten credit request

**Project one-liner**
PactPay × Meta Muse - An AI agent that shops for you, reads the real checkout page, and can't be talked into overspending.

**What are you building and how will you use Baseten?**
PactPay is a safety layer for AI shopping agents: an agent shops, a fixed gate decides whether money moves. We use Baseten to serve Meta's open-weight Muse Spark Open as an independent second reader in our Checkout Inspector, so two different Meta models must read a checkout page the same way before we call it safe. It also runs the same features (rule drafting, tool-calling agent, seller-text reading) on open weights, so platforms can host the safety path themselves. Requests are short, mostly image-plus-JSON calls with occasional tool-calling loops.

**GitHub profile or repo link**
`https://github.com/<your-user>/<repo>` **YOU:** fill in.

**Expected request volume**
**Moderate.** (Light prototyping is also honest for the hackathon; choose Moderate if you want headroom: each Inspector run makes two vision calls and an agent run makes up to about a dozen calls.)

Technical details if asked: endpoint `https://inference.baseten.co/v1`, model slug `meta-models/muse-spark-open`, env `BASETEN_API_KEY`, output cap via `max_tokens`.
