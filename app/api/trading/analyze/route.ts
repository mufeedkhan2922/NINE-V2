import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { getPaperAccount } from "@/lib/trading/paperTrading";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const market = await getLiveMarketSnapshot("XAUUSD");
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    return NextResponse.json({ mode: "LIVE_DATA_PAPER_TRADING", provider: "Twelve Data", market, analysis: orchestration.setup, orchestration, generatedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ mode: "LIVE_DATA_PAPER_TRADING", error: error instanceof Error ? error.message : "Unknown market-data error.", market: null, analysis: null, orchestration: null }, { status: 503 });
  }
}
