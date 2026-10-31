import { NextResponse } from "next/server";
import { loginRequired, readAuthUser } from "../../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Who am I, and does this deployment require an account? Optionally shows a shared judge demo account on the login page. */
export async function GET() {
  const user = await readAuthUser().catch(() => null);
  const showDemo = process.env.PACTPAY_SHOW_DEMO_CREDENTIALS === "1" && process.env.PACTPAY_DEMO_USERNAME && process.env.PACTPAY_DEMO_PASSWORD;
  return NextResponse.json({
    authenticated: Boolean(user),
    username: user?.username ?? null,
    loginRequired: loginRequired(),
    demo: showDemo ? { username: process.env.PACTPAY_DEMO_USERNAME, password: process.env.PACTPAY_DEMO_PASSWORD } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
