import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { marketFeedStatus, runtimeDiagnostics, runtimeSafety } from "@/lib/trading/runtime";
import type { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const symbols: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    requireUser(request);
    const requested = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
    const symbol = symbols.includes(requested as MarketSymbol) ? requested as MarketSymbol : "XAUUSD";
    const runtime = runtimeDiagnostics();
    let market: unknown = null;
    let feed: unknown = marketFeedStatus(null);
    let marketError: string | null = null;
    try {
      const snapshot = await getLiveMarketSnapshot(symbol);
      market = snapshot;
      feed = marketFeedStatus(snapshot);
    } catch (error) {
      marketError = error instanceof Error ? error.message : "Market diagnostics failed.";
    }
    return NextResponse.json({ ok: true, version: runtime.version, symbol, runtime, safety: runtimeSafety(), market, feed, marketError, generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnostics unavailable.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 503 });
  }
}
