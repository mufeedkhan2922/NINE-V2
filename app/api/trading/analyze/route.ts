import { NextResponse } from "next/server";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import type { MarketSymbol } from "@/lib/trading/types";
import { NINE_VERSION } from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

export async function GET(request: Request) {
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
