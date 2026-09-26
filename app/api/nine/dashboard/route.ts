import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { getPaperAccount, getPaperEvents } from "@/lib/trading/paperTrading";
import { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const symbol: MarketSymbol = "XAUUSD";
    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    return NextResponse.json({ ok: true, mode: "LIVE_DATA_PAPER_TRADING", provider: "Twelve Data", market, orchestration, account, events: getPaperEvents(30), chart: market.timeframes?.["1min"]?.candles.slice(-60) ?? [], generatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ ok: false, mode: "LIVE_DATA_PAPER_TRADING", error: error instanceof Error ? error.message : "Unknown error.", market: null, orchestration: null, account: getPaperAccount() }, { status: 503 });
  }
}
