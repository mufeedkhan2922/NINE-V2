import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { closePaperPosition, executePaperSetup, getPaperAccount } from "@/lib/trading/paperTrading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 20, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Paper-order rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
    const body = await request.json().catch(() => ({})) as { action?: "OPEN" | "CLOSE"; positionId?: string };
    const market = await getLiveMarketSnapshot("XAUUSD");
    if (body.action === "CLOSE") {
      if (!body.positionId) return NextResponse.json({ ok: false, error: "positionId is required." }, { status: 400 });
      return NextResponse.json(closePaperPosition(body.positionId, market.price));
    }
    const orchestration = await orchestrateNINE(market, getPaperAccount(market.price));
    return NextResponse.json(executePaperSetup(orchestration, market));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Paper trading request failed.";
    const status = message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
