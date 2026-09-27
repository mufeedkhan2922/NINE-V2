import { NextResponse } from "next/server";
import { requireUser } from "@/lib/security/auth";
import { assertSameOrigin } from "@/lib/security/requestSecurity";
import { rateLimit, requestKey } from "@/lib/security/rateLimit";

import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { buildAgentOrchestration } from "@/lib/trading/agentOrchestrator";
import { buildDecisionExplanation } from "@/lib/trading/v210";
import {
  getPaperAccount,
  getPaperEvents,
} from "@/lib/trading/paperTrading";
import { getOrders } from "@/lib/trading/orders";
import { buildStrategyLabSnapshot } from "@/lib/trading/strategyLab";
import { db } from "@/lib/trading/db";
import { reconcilePaperState } from "@/lib/trading/paperReconciliation";
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

function buildWorkstationIntelligence(market: Awaited<ReturnType<typeof getLiveMarketSnapshot>>, orchestration: Awaited<ReturnType<typeof orchestrateNINE>>) {
  const chartist = orchestration.setup.smc.chartist;
  const candles = market.timeframes?.["1min"]?.candles ?? market.candles ?? [];
  const last = candles.at(-1);
  const prev = candles.at(-2);
  const range = candles.slice(-30);
  const high = range.length ? Math.max(...range.map((c) => c.high)) : null;
  const low = range.length ? Math.min(...range.map((c) => c.low)) : null;
  const midpoint = high !== null && low !== null ? (high + low) / 2 : null;
  const setup = orchestration.setup;
  const lifecycle = setup.direction === "NONE"
    ? "WATCH"
    : !setup.validation.valid
      ? "FORMING"
      : orchestration.sentinel.approved
        ? "PAPER_READY"
        : "BLOCKED";
  const annotations = [
    chartist?.liquidityHigh !== null && chartist?.liquidityHigh !== undefined ? { type: "LIQUIDITY_HIGH", price: chartist.liquidityHigh, label: "LIQ HIGH" } : null,
    chartist?.liquidityLow !== null && chartist?.liquidityLow !== undefined ? { type: "LIQUIDITY_LOW", price: chartist.liquidityLow, label: "LIQ LOW" } : null,
    chartist?.sessionHigh !== null && chartist?.sessionHigh !== undefined ? { type: "SESSION_HIGH", price: chartist.sessionHigh, label: "SESSION HIGH" } : null,
    chartist?.sessionLow !== null && chartist?.sessionLow !== undefined ? { type: "SESSION_LOW", price: chartist.sessionLow, label: "SESSION LOW" } : null,
    midpoint !== null ? { type: "EQUILIBRIUM", price: midpoint, label: "50%" } : null,
    ...((chartist?.fairValueGaps ?? []).slice(-4).map((z, i) => ({ type: "FVG", high: z.high, low: z.low, direction: z.direction, label: `FVG ${i + 1}` }))),
    ...((chartist?.orderBlocks ?? []).slice(-4).map((z, i) => ({ type: "ORDER_BLOCK", high: z.high, low: z.low, direction: z.direction, label: `OB ${i + 1}` }))),
    setup.entry !== null ? { type: "ENTRY", price: setup.entry, label: "ENTRY" } : null,
    setup.stopLoss !== null ? { type: "STOP", price: setup.stopLoss, label: "SL" } : null,
    setup.takeProfit !== null ? { type: "TARGET", price: setup.takeProfit, label: "TP" } : null,
  ].filter(Boolean);
  const evidence = [
    { source: "PRICE", signal: prev && last ? `1m close ${last.close.toFixed(2)} vs previous ${prev.close.toFixed(2)}` : "Price candle unavailable", state: last ? "LIVE" : "MISSING" },
    { source: "STRUCTURE", signal: setup.technical.structure, state: setup.smc.marketStructureShift ? "CONFIRMED" : "WATCH" },
    { source: "SMC", signal: setup.smc.liquiditySweep ? `Liquidity sweep: ${setup.smc.sweepDirection}` : "No confirmed liquidity sweep", state: setup.smc.liquiditySweep ? "CONFIRMED" : "WATCH" },
    { source: "ATLAS", signal: orchestration.atlas?.summary ?? "Macro context unavailable", state: orchestration.atlas?.sourceStatus ?? "UNAVAILABLE" },
    { source: "SENTINEL", signal: orchestration.sentinel.reason, state: orchestration.sentinel.approved ? "APPROVED" : "BLOCKED" },
  ];
  return {
    lifecycle,
    session: chartist?.session ?? "OFF_SESSION",
    higherTimeframeBias: chartist?.higherTimeframeBias ?? "NONE",
    confluenceScore: chartist?.confluenceScore ?? 0,
    annotations,
    evidence,
    invalidation: setup.direction === "LONG" && setup.stopLoss !== null ? `Long thesis invalidates below ${setup.stopLoss.toFixed(2)}` : setup.direction === "SHORT" && setup.stopLoss !== null ? `Short thesis invalidates above ${setup.stopLoss.toFixed(2)}` : "No active directional thesis.",
    nextTrigger: setup.direction === "NONE" ? "Wait for liquidity + structure confirmation." : !setup.validation.valid ? "Await remaining validation checks." : orchestration.sentinel.approved ? "Paper execution gate is available; no live execution." : "Resolve Sentinel blockers before paper execution.",
    generatedAt: Date.now(),
  };
}

function requestedSymbol(request: Request): MarketSymbol {
  const value = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
  return SYMBOLS.includes(value as MarketSymbol)
    ? (value as MarketSymbol)
    : "XAUUSD";
}

export async function GET(request: Request) {
  try {
    assertSameOrigin(request);
    const user = requireUser(request);
    const limit = rateLimit(requestKey(request, user.id), 20, 60_000);
    if (!limit.allowed) return NextResponse.json({ ok: false, error: "Dashboard rate limit exceeded.", retryAfterSeconds: limit.retryAfterSeconds }, { status: 429 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    return NextResponse.json({ ok: false, error: message }, { status: message === "UNAUTHENTICATED" ? 401 : message === "CROSS_ORIGIN" ? 403 : 500 });
  }
  const symbol = requestedSymbol(request);

  try {
    const market = await getLiveMarketSnapshot(symbol);
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    const agentOrchestration = buildAgentOrchestration(market, orchestration.setup, orchestration.atlas, orchestration.sentinel);
    const workstation = buildWorkstationIntelligence(market, orchestration);

    const feed = marketFeedStatus(market);
    const setupV26 = orchestration.v26.setup;
    const marketHealthV26 = orchestration.v26.marketHealth;
    const brainV26 = orchestration.v26.brain;
    const riskTelemetryV26 = orchestration.v26.riskTelemetry;
    const signalEventsV26 = orchestration.v26.signalEvents;
    const decisionExplanation = buildDecisionExplanation(orchestration);
    const strategyLab = buildStrategyLabSnapshot(market);
    const paperReconciliation = reconcilePaperState();
    const strategyMemory = db.prepare(
      "SELECT strategy_id AS strategyId, strategy_name AS strategyName, session, regime, trades, wins, win_rate AS winRate, expectancy_r AS expectancyR, profit_factor AS profitFactor, max_drawdown_r AS maxDrawdownR, updated_at AS updatedAt FROM strategy_memory WHERE symbol = ? ORDER BY expectancy_r DESC, trades DESC, updated_at DESC LIMIT 24",
    ).all(market.symbol);

    const researchHistoryRows = db.prepare(
      "SELECT id, timeframe, start_date AS startDate, end_date AS endDate, candles, oos_trades AS oosTrades, research_status AS researchStatus, research_score AS researchScore, target_win_rate AS targetWinRate, target_reached AS targetReached, created_at AS createdAt FROM research_runs WHERE symbol = ? ORDER BY created_at DESC LIMIT 8",
    ).all(market.symbol) as Array<Record<string, unknown>>;
    const researchHistory = researchHistoryRows.map((row) => ({
      ...row,
      targetReached: Number(row.targetReached) === 1,
    }));


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
      agents: agentOrchestration,
      workstation,
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
      strategyLab,
      strategyMemory,
      researchHistory,
      paperReconciliation,
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
