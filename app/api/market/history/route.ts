import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { getBacktestCandles } from "@/lib/trading/market";
import type { MarketSymbol, Timeframe } from "@/lib/trading/types";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const symbols: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];
const timeframes: Timeframe[] = ["1min", "5min", "15min", "1h", "4h", "1day"];

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    requireUser(request);
    const url = new URL(request.url);
    const rawSymbol = url.searchParams.get("symbol")?.toUpperCase();
    const symbol = symbols.includes(rawSymbol as MarketSymbol) ? rawSymbol as MarketSymbol : "XAUUSD";
    const rawTimeframe = url.searchParams.get("timeframe") ?? "1min";
    const timeframe = timeframes.includes(rawTimeframe as Timeframe) ? rawTimeframe as Timeframe : "1min";
    const { candles, source } = await getBacktestCandles(symbol, timeframe);
    return NextResponse.json({ ok: true, version: NINE_VERSION, symbol, timeframe, source, candles, generatedAt: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Historical market data unavailable.";
    return NextResponse.json({ ok: false, version: NINE_VERSION, error: message }, { status: message === "UNAUTHENTICATED" ? 401 : 503 });
  }
}
