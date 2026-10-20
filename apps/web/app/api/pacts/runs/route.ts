import { NextResponse } from "next/server";
import { listRecentPolicyRuns } from "../../../../../../lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const runs = await listRecentPolicyRuns(20);
    return NextResponse.json({ runs });
  } catch (error) {
    console.error("PactPay policy run history failed", error);
    return NextResponse.json({ error: "Unable to load Policy Lab history." }, { status: 500 });
  }
}
