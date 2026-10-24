import { NextResponse } from "next/server";
import { ensureDatabase } from "../../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness and database check for hosting platforms. Reveals no configuration. */
export async function GET() {
  try {
    await ensureDatabase();
    return NextResponse.json({ ok: true, database: true });
  } catch {
    return NextResponse.json({ ok: false, database: false }, { status: 503 });
  }
}
