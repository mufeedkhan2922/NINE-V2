import { evaluateStrategyBook, type StrategyConsensus } from "./strategyEngine";
import { buildAdaptiveLearningSnapshot, type AdaptiveLearningSnapshot } from "./adaptiveLearning";
import { buildAgentOrchestration, type AgentOrchestration } from "./agentOrchestrator";
import { buildXAUDecisionEngine, type XAUDecisionEngine, type XAUSetupTracking } from "./xauDecisionEngine";
import type { MarketSnapshot, NINEOrchestration, PaperAccount } from "./types";
import { buildPaperTelemetry, type PaperTelemetry } from "./paperTelemetry";
import { buildV55RegimeEngine, type V55RegimeEngine } from "./regimeEngine";
import { buildUnavailableKronosForecast, type KronosForecast } from "./kronosForecast";
import { assessKronosQuality, type KronosQuality } from "./kronosQuality";

export type V5Action = "PAPER_READY" | "WATCHING" | "BLOCKED";

export interface V5Evidence {
  source: "MARKET" | "STRATEGY" | "LEARNING" | "CHARTIST" | "ATLAS" | "SENTINEL" | "PAPER" | "KRONOS";
  strength: "HIGH" | "MEDIUM" | "LOW";
  statement: string;
}

export interface V5Intelligence {
  version: "5.7.0";
  symbol: "XAUUSD";
  action: V5Action;
  direction: "LONG" | "SHORT" | "NONE";
  confidence: number;
  regime: V55RegimeEngine["regime"];
  regimeEngine: V55RegimeEngine;
  strategyConsensus: StrategyConsensus;
  recommendedStrategyId: string | null;
  kronos: KronosForecast;
  kronosQuality: KronosQuality;
  learning: AdaptiveLearningSnapshot;
  agents: AgentOrchestration;
  decisionEngine: XAUDecisionEngine;
  telemetry: PaperTelemetry;
  evidence: V5Evidence[];
  blockers: string[];
  warnings: string[];
  executionAuthority: "SENTINEL_ONLY";
  executionMode: "PAPER";
  generatedAt: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(99, Math.round(value)));
}

function buildEvidence(
  market: MarketSnapshot,
  orchestration: NINEOrchestration,
  consensus: StrategyConsensus,
  learning: AdaptiveLearningSnapshot,
  telemetry: PaperTelemetry,
  kronos: KronosForecast,
  kronosQuality: KronosQuality,
): V5Evidence[] {
  const evidence: V5Evidence[] = [
    {
      source: "MARKET",
      strength: market.tradingAllowed && market.marketState?.dataState === "LIVE" ? "HIGH" : "LOW",
      statement: `XAUUSD market feed is ${market.marketState?.dataState ?? "UNKNOWN"} with ${market.marketState?.tradingPermission ?? "BLOCKED"} trading permission.`,
    },
    {
      source: "STRATEGY",
      strength: consensus.alignedStrategies >= 2 ? "HIGH" : consensus.alignedStrategies === 1 ? "MEDIUM" : "LOW",
      statement: `${consensus.activeStrategies} active strategies; ${consensus.alignedStrategies} aligned toward ${consensus.direction}.`,
    },
    {
      source: "LEARNING",
      strength: learning.robust ? "HIGH" : learning.totalEvaluatedSignals > 0 ? "MEDIUM" : "LOW",
      statement: learning.bestStrategyName
        ? `Historical walk-forward model currently identifies ${learning.bestStrategyName} as the strongest measured strategy; this does not guarantee future performance.`
        : "Insufficient walk-forward evidence to identify a strongest strategy.",
    },
    {
      source: "CHARTIST",
      strength: orchestration.setup.smc.marketStructureShift ? "HIGH" : "MEDIUM",
      statement: `${orchestration.setup.technical.structure}; sweep=${orchestration.setup.smc.liquiditySweep ? orchestration.setup.smc.sweepDirection : "NONE"}, MSS=${orchestration.setup.smc.marketStructureShift ? orchestration.setup.smc.structureDirection : "NONE"}.`,
    },
    {
      source: "ATLAS",
      strength: orchestration.atlas?.sourceStatus === "LIVE" ? "MEDIUM" : "LOW",
      statement: orchestration.atlas?.summary ?? "Macro context unavailable.",
    },
    {
      source: "SENTINEL",
      strength: "HIGH",
      statement: orchestration.sentinel.approved
        ? "Sentinel approved the current paper execution gate."
        : `Sentinel blocked execution: ${orchestration.sentinel.reason}`,
    },
    {
      source: "PAPER",
      strength: telemetry.closedTrades >= 20 ? "HIGH" : "MEDIUM",
      statement: `Paper account: ${telemetry.closedTrades} closed trades, ${telemetry.winRate.toFixed(1)}% win rate, net P&L ${telemetry.netPnl.toFixed(2)}.`,
    },
    {
      source: "KRONOS",
      strength: kronos.status === "LIVE" ? "MEDIUM" : "LOW",
      statement: kronos.status === "LIVE"
        ? `Kronos ${kronos.model} produced ${kronos.sampleCount} sampled XAUUSD paths; median endpoint is ${kronos.medianFinal?.toFixed(2) ?? "—"} with a ${kronos.uncertainty.toLowerCase()} forecast band. Quality=${kronosQuality.score}/100 (${kronosQuality.agreement.toLowerCase()}). It is not calibrated for execution.`
        : kronos.warnings[0] ?? "Kronos forecast unavailable.",
    },
  ];
  return evidence;
}

export function buildV5Intelligence(
  market: MarketSnapshot,
  orchestration: NINEOrchestration,
  account: PaperAccount,
  tracking: XAUSetupTracking,
  kronos?: KronosForecast,
): V5Intelligence {
  const effectiveKronos = kronos ?? buildUnavailableKronosForecast("5min");
  const kronosCandles = market.timeframes?.[effectiveKronos.timeframe]?.candles ?? market.candles;
  const kronosQuality = assessKronosQuality(effectiveKronos, kronosCandles);
  const strategyConsensus = evaluateStrategyBook(market, { useMemory: true });
  const regimeEngine = buildV55RegimeEngine(market, strategyConsensus);
  const learning = buildAdaptiveLearningSnapshot(market, {
    warmupCandles: 100,
    evaluationHorizon: 12,
    rewardRisk: 2,
    minimumScore: 65,
    minimumTrades: 20,
    targetWinRate: 90,
  });
  const agents = buildAgentOrchestration(
    market,
    orchestration.setup,
    orchestration.atlas,
    orchestration.sentinel,
  );
  const decisionEngine = buildXAUDecisionEngine(
    market,
    orchestration.setup,
    orchestration.atlas,
    orchestration.sentinel,
    account,
    tracking,
  );
  const telemetry = buildPaperTelemetry(account);

  const blockers = [
    ...orchestration.setup.validation.blockers,
    ...orchestration.sentinel.checks.filter((check) => check.startsWith("BLOCK:")),
    ...agents.blockers,
  ].filter(Boolean).slice(0, 12);

  const warnings = [
    ...orchestration.setup.validation.warnings,
    ...(market.marketState?.warnings ?? []),
    ...(market.crossTimeframeValidation?.warnings ?? []),
    ...learning.methodology.filter((item) => /insufficient|target|not guaranteed/i.test(item)),
    ...regimeEngine.warnings,
    ...effectiveKronos.warnings,
    ...kronosQuality.notes.filter((item) => /conflict|zero-shot|uncalibrated|wide forecast/i.test(item)),
  ].slice(0, 12);

  const action: V5Action =
    orchestration.sentinel.approved &&
    orchestration.setup.validation.valid &&
    strategyConsensus.direction !== "NONE" &&
    strategyConsensus.alignedStrategies >= 1
      ? "PAPER_READY"
      : orchestration.setup.direction === "NONE"
        ? "WATCHING"
        : "BLOCKED";

  const confidence = clamp(
    orchestration.setup.confidence * 0.45 +
      strategyConsensus.confidence * 0.35 +
      (learning.robust ? 10 : learning.totalEvaluatedSignals > 0 ? 5 : 0) +
      (orchestration.sentinel.approved ? 10 : 0) +
      (regimeEngine.topSetup ? regimeEngine.topSetup.finalScore * 0.05 : 0),
  );

  return {
    version: "5.7.0",
    symbol: "XAUUSD",
    action,
    direction: action === "WATCHING" ? "NONE" : orchestration.setup.direction,
    confidence,
    regime: regimeEngine.regime,
    regimeEngine,
    strategyConsensus,
    recommendedStrategyId: regimeEngine.topSetup?.strategyId ?? null,
    kronos: effectiveKronos,
    kronosQuality,
    learning,
    agents,
    decisionEngine,
    telemetry,
    evidence: buildEvidence(market, orchestration, strategyConsensus, learning, telemetry, effectiveKronos),
    blockers,
    warnings,
    executionAuthority: "SENTINEL_ONLY",
    executionMode: "PAPER",
    generatedAt: Date.now(),
  };
}
