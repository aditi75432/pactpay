# Final checklist (deadline: Nov 12, 12:00 pm Pacific = Nov 13, 12:30 am IST)

Devpost shows 1:30 am IST on Nov 13; the Official Rules say 12:00 pm PT on Nov 12. **Submit by the evening of Nov 12 IST at the latest.** Don't rely on the later time.

## Risks that can sink a good project
1. **Hosted app dies before judging (Dec 1–15).** Render free Postgres expires after 30 days, and free web services sleep. Upgrade the DB plan or re-create it around Dec 1. Keep PayPal/Channel3/AI keys and credits alive through Dec 21.
2. **No buyer login for judges.** Judges can't approve a hold without a PayPal Sandbox buyer. Put one in the README (sandbox accounts are fake).
3. **Third-party trademarks in the video** (Lenovo page, other brands, music). Use the Marlow & Finch store.
4. **Video length.** Keep under 3:00 with margin (aim 2:45).
5. **Repo hygiene.** `.gitignore` excludes `document/`, `demo-kit/`, `Patch-notes/`. Anything judges need must live in `docs/`, the README or the code. `.env.example` is now included. LICENSE must appear in the repo's About box.
6. **Extension files.** `apps/web/public/guard-extension/` must be committed: the app builds the download from it at `/api/guard/extension`. After any change in `extension/`, run `cd extension && npm run pack` and commit.
7. **New deployment.** Replace `YOUR-APP.onrender.com` in the README and `docs/JUDGES.md`. Set the same env vars as `.env.example` (hosted: `PACTPAY_REQUIRE_LOGIN=1`). The extension download stamps itself with the site it came from, so nothing else changes. After deploying, download the extension from the NEW site, load it, and run `/store`.
8. **Real retailer pages in the video.** The rules ban third-party trademarks in the video. Keep the video on the Marlow & Finch demo store. If you want a real-site clip, ask the organizers on the PayPal Discord / Devpost first and get a yes in writing.

9. **Judge credentials on the live site.** `/judges` shows the demo login and the PayPal Sandbox buyer login to anyone, even before signing in. Set `PACTPAY_SHOW_DEMO_CREDENTIALS=1`, `NEXT_PUBLIC_SANDBOX_BUYER_EMAIL` and `NEXT_PUBLIC_SANDBOX_BUYER_PASSWORD` in Render **before the build** (they are baked in at build time), then redeploy.
10. **Brand assets.** Upload `docs/brand/devpost-thumbnail-3x2.png` as the Devpost project image and use `docs/brand/video-end-card-1080p.png` as the last 3 seconds of the video.

## Sponsor prize alignment (a project can win one Grand/Honorable plus one Sponsor prize)
- **AG Grid** ($5k/$2k/$1k): 3 grids incl. the new Guard checks tab. Mention filtering, quick filter, pagination, cell styling and row clicks in the writeup and show the grid in the video.
- **Channel3** ($1.5k): live catalog, and product-detail refresh at settlement. Show it.
- **Render** (credits): hosted on Render via `render.yaml`.
- Honorable fits: **Best Use of Agentic Commerce**, **Best Use of PayPal + AI**, **Most Impactful**.

## Before you press Submit
- [ ] `pnpm --filter @pactpay/pact-core test` and `pnpm --filter web build` pass on a clean clone
- [ ] A friend opened the live URL, logged in, completed Path A and Path B from `docs/JUDGES.md`
- [ ] README placeholders replaced: `[YOUR_YOUTUBE_LINK]`, `[SANDBOX_BUYER_EMAIL]`, `[SANDBOX_BUYER_PASSWORD]`
- [ ] Draft saved on Devpost, then submitted (a draft is not a submission)
