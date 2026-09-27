
import { NextResponse } from "next/server";

import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import {
  getPaperAccount,
  getPaperEvents,
} from "@/lib/trading/paperTrading";
import { getOrders } from "@/lib/trading/orders";
import { MarketSymbol } from "@/lib/trading/types";
import {
  marketFeedStatus,
  runtimeSafety,
  providerDiagnostics,
  NINE_VERSION,
} from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const symbol: MarketSymbol = "XAUUSD";

    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);

    const orchestration = await orchestrateNINE(
      market,
      account,
    );

    const feed = marketFeedStatus(market);

    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      mode: "LIVE_DATA_PAPER_TRADING",
      provider:
        orchestration.marketHealth?.feed.provider ??
        feed.provider,
      runtime: runtimeSafety(),
      feed,
      market,
      orchestration,
      account,
      orders: getOrders(50),
      events: getPaperEvents(30),
      diagnostics: { provider: providerDiagnostics(symbol, { lastCandleAt: market.timeframes?.["1min"]?.candles.at(-1)?.time ?? null, lastQuoteAt: market.timestamp }) },
      chart:
        market.timeframes?.["1min"]?.candles.slice(-80) ??
        [],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        version: NINE_VERSION,
        mode: "LIVE_DATA_PAPER_TRADING",
        runtime: runtimeSafety(),
        feed: marketFeedStatus(null),
        error:
          error instanceof Error
            ? error.message
            : "Unknown market-data error.",
        market: null,
        orchestration: null,
        account: getPaperAccount(),
        orders: getOrders(50),
        events: getPaperEvents(30),
        diagnostics: { provider: providerDiagnostics(symbol) },
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}