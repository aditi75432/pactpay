# PactPay M0.6.1 — Evidence Desk UI hotfix

## What this fixes

The Evidence Desk's checkbox handler and review-note handler read `event.currentTarget` inside a React state-updater callback. React may execute that callback after the event handler has completed, when `currentTarget` is no longer available. The handlers now copy the checkbox state / input value synchronously before calling the state updater.

No API routes, database schema, saved evidence, PayPal configuration, or payment behavior are changed.

## Apply

Extract the ZIP directly into the existing PactPay repository root. The ZIP intentionally has no enclosing project directory. Allow this file to overwrite:

`apps/web/app/evidence/page.tsx`

Then restart the Next.js dev server (`Ctrl+C`, then `pnpm dev`) and refresh the Evidence Desk page.

## Verify

1. Open `/evidence?snapshotId=<the-snapshot-id>` again, or revisit the same Evidence page.
2. For each `SUBMITTED` evidence item, tick the confirmation checkbox.
3. Optionally type a review note.
4. Click `Mark human-reviewed` only after opening the exact merchant page and checking the claimed value.
5. Confirm the browser no longer reports `Cannot read properties of null (reading 'checked')` and the API returns a successful review response.

This is a UI crash fix only. The reviewer must still inspect the source; PactPay does not independently authenticate merchant pages at this stage. No PayPal transaction is changed by the Evidence Desk.
