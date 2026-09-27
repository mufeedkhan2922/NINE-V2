import { NextResponse } from "next/server";

import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { buildDecisionExplanation } from "@/lib/trading/v210";
import {
  getPaperAccount,
  getPaperEvents,
} from "@/lib/trading/paperTrading";
import { getOrders } from "@/lib/trading/orders";
import type { MarketSymbol } from "@/lib/trading/types";
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
  runtimeDiagnostics,
  NINE_VERSION,
} from "@/lib/trading/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

function requestedSymbol(request: Request): MarketSymbol {
  const value = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
  return SYMBOLS.includes(value as MarketSymbol)
    ? (value as MarketSymbol)
    : "XAUUSD";
}

export async function GET(request: Request) {
  const symbol = requestedSymbol(request);

  try {
    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);

    const feed = marketFeedStatus(market);
    const setupV26 = orchestration.v26.setup;
    const marketHealthV26 = orchestration.v26.marketHealth;
    const brainV26 = orchestration.v26.brain;
    const riskTelemetryV26 = orchestration.v26.riskTelemetry;
    const signalEventsV26 = orchestration.v26.signalEvents;
    const decisionExplanation = buildDecisionExplanation(orchestration);

    return NextResponse.json({
      ok: true,
      version: NINE_VERSION,
      mode: "LIVE_DATA_PAPER_TRADING",
      symbol,
      provider: feed.provider,
      diagnostics: runtimeDiagnostics(),
      runtime: runtimeSafety(),
      feed,
      market,
      orchestration,
      v27: {
        commandCenter: {
          status: brainV26.action,
          executionMode: orchestration.executionMode,
          tradingAllowed: market.tradingAllowed === true && feed.tradingAllowed,
        },
        brain: brainV26,
        setup: setupV26,
        marketHealth: marketHealthV26,
        risk: riskTelemetryV26,
        events: signalEventsV26,
      },
      v210: {
        decision: decisionExplanation,
        backtestAnalytics: null,
      },
      v29: {
        commandCenter: {
          status: brainV26.action,
          executionMode: orchestration.executionMode,
          tradingAllowed: market.tradingAllowed === true && feed.tradingAllowed,
        },
        brain: brainV26,
        setup: setupV26,
        marketHealth: marketHealthV26,
        risk: riskTelemetryV26,
        events: signalEventsV26,
      },
      account,
      orders: getOrders(50),
      events: getPaperEvents(30),
      chart: market.timeframes?.["1min"]?.candles.slice(-120) ?? [],
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown market-data error.";

    return NextResponse.json(
      {
        ok: false,
        version: NINE_VERSION,
        mode: "LIVE_DATA_PAPER_TRADING",
        symbol,
        runtime: runtimeSafety(),
        feed: marketFeedStatus(null),
        error: message,
        market: null,
        orchestration: null,
        v27: {
          commandCenter: {
            status: "BLOCKED",
            executionMode: "PAPER",
            tradingAllowed: false,
          },
          brain: {
            action: "BLOCKED",
            direction: "NONE",
            confidence: 0,
            evidence: [],
            blockers: [message],
            rationale: "NINE cannot generate a validated trading signal without a validated market snapshot.",
            generatedAt: Date.now(),
          },
          setup: null,
          marketHealth: {
            state: "BLOCKED",
            latencyMs: null,
            feedAgeSeconds: Number.POSITIVE_INFINITY,
            tradingAllowed: false,
            reasons: [message],
          },
          risk: null,
          events: [{
            type: "MARKET_DEGRADED",
            message: `Signal engine blocked: ${message}`,
            timestamp: Date.now(),
          }],
        },
        account: getPaperAccount(),
        orders: getOrders(50),
        events: getPaperEvents(30),
        chart: [],
        generatedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
