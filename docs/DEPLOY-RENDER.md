# Deploying PactPay on Render

1. Push the repository to GitHub (public, with the license visible).
2. In Render choose **New > Blueprint**, pick the repository. `render.yaml` creates the web service and a Postgres database and wires `DATABASE_URL` for you.
3. Fill the secrets Render asks for: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `CHANNEL3_API_KEY`, `GROQ_API_KEY`. Use **separate keys and low spend limits** for the hosted app, not your personal ones.
4. After the first deploy, open `https://<your-service>.onrender.com/api/health`. It should show `{"ok":true,"database":true}`.
5. In the PayPal developer dashboard, add the return URL if your app restricts it. The app reads `NEXT_PUBLIC_APP_URL`, and falls back to Render's `RENDER_EXTERNAL_URL`.
6. Run the whole flow once on the hosted URL: approve rules, shortlist, hold, PayPal approve, settle. Then run it again with a seller change.

Notes
- The free web service sleeps when idle, so the first request can take about a minute. Open the site just before recording or judging. The free database expires after 30 days.
- Put a sandbox **buyer** login in the Devpost private testing instructions, not in the repository.
- Set `PACTPAY_CONTROL_CENTER_SCOPE` only on a private deployment. The default shows each visitor only their own activity.
