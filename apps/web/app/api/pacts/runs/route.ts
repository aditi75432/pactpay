import { NextResponse } from "next/server";
import { listRecentPolicyRuns } from "../../../../../../lib/db";
import { requireLogin } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET() {
  const loginDenied = await requireLogin();
  if (loginDenied) return loginDenied;
  try {
    const runs = await listRecentPolicyRuns(20);
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("PactPay policy run history failed", error);
    return NextResponse.json({ error: "Unable to load Policy Lab history." }, { status: 500 });
  }
}
