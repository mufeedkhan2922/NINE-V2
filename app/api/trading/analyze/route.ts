import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import type { MarketSymbol } from "@/lib/trading/types";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 30, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Analysis rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 500 });
  }
  const rawSymbol = new URL(request.url)
    .searchParams.get("symbol")
    ?.toUpperCase();

  const symbol = SYMBOLS.includes(rawSymbol as MarketSymbol)
    ? (rawSymbol as MarketSymbol)
    : "XAUUSD";

  try {
    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(
      market,
      account,
    );

    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      mode: "LIVE_DATA_PAPER_TRADING",
      symbol,
      provider: "Twelve Data",
      market,
      analysis: orchestration.setup,
      orchestration,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        version: NINE_VERSION,
        mode: "LIVE_DATA_PAPER_TRADING",
        symbol,
        error:
          error instanceof Error
            ? error.message
            : "Unknown market-data error.",
        market: null,
        analysis: null,
        orchestration: null,
      },
      { status: 503 },
    );
  }
}
