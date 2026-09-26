
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
  buildBrainDecision,
  buildMarketHealthV26,
  buildRiskTelemetryV26,
  buildSetupV26,
  buildSignalEvents,
} from "@/lib/trading/v26";
import {
  marketFeedStatus,
  runtimeSafety,
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
    const setupV26 = buildSetupV26(market, orchestration.setup);
    const marketHealthV26 = buildMarketHealthV26(market);
    const brainV26 = buildBrainDecision(
      market,
      setupV26,
      orchestration.atlas,
      orchestration.sentinel,
    );
    const riskTelemetryV26 = buildRiskTelemetryV26(
      account,
      setupV26,
      orchestration.sentinel,
    );
    const signalEventsV26 = buildSignalEvents(
      market,
      setupV26,
      orchestration.sentinel,
    );

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
      v26: {
        brain: brainV26,
        setup: setupV26,
        marketHealth: marketHealthV26,
        risk: riskTelemetryV26,
        events: signalEventsV26,
      },
      account,
      orders: getOrders(50),
      events: getPaperEvents(30),
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
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}