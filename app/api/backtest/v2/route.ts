import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { runBacktestV26 } from "@/lib/trading/v26";
import type { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const symbol = (url.searchParams.get("symbol") ?? "XAUUSD") as MarketSymbol;
    const allowed: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];
    if (!allowed.includes(symbol)) {
      return NextResponse.json({ ok: false, error: "Unsupported symbol." }, { status: 400 });
    }

    const initialBalance = Math.max(100, Number(url.searchParams.get("initialBalance") ?? 10000));
    const riskPercent = Math.min(2, Math.max(0.1, Number(url.searchParams.get("riskPercent") ?? 0.5)));
    const market = await getLiveMarketSnapshot(symbol);
    const candles = market.timeframes?.["1min"]?.candles ?? [];
    const result = runBacktestV26(candles, initialBalance, riskPercent);

    return NextResponse.json({
      ok: true,
      version: "2.6",
      symbol,
      source: "validated-live-candle-cache",
      result,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      version: "2.6",
      error: error instanceof Error ? error.message : "Backtest failed.",
    }, { status: 503 });
  }
}
