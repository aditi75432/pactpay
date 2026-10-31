import { NextResponse } from "next/server";
import { sellerWorldReason } from "@pactpay/pact-core/seller-world";
import { clearSellerWorld, listSellerWorld } from "../../../../../lib/seller-world";
import { readSessionId } from "../../../lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The simulated seller changes this browser has made, so the agent can respect them. Test layer only. */
export async function GET() {
  try {
    const sessionId = await readSessionId();
    const effects = sessionId ? await listSellerWorld(sessionId) : [];
    return NextResponse.json({
      effects: effects.map((effect) => ({ ...effect, reason: sellerWorldReason(effect.scenarioId) })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Seller world read failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ effects: [], error: "Couldn't read the seller simulation." }, { status: 500 });
  }
}

/** Reset the simulation for this browser: every simulated seller returns to its real catalog state. */
export async function DELETE() {
  try {
    const sessionId = await readSessionId();
    const cleared = sessionId ? await clearSellerWorld(sessionId) : 0;
    return NextResponse.json({ cleared }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Seller world reset failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "Couldn't reset the seller simulation." }, { status: 500 });
  }
}
