import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { closePaperPosition, executePaperSetup, getPaperAccount } from "@/lib/trading/paperTrading";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    requireUser(request);
    const body = (await request.json()) as { action?: "OPEN" | "CLOSE"; positionId?: string };
    const market = await getLiveMarketSnapshot("XAUUSD");
    if (body.action === "CLOSE") {
      if (!body.positionId) return NextResponse.json({ ok: false, error: "positionId is required." }, { status: 400 });
      return NextResponse.json(closePaperPosition(body.positionId, market.price));
    }
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    return NextResponse.json(executePaperSetup(orchestration, market));
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unknown error." }, { status: 500 });
  }
}
