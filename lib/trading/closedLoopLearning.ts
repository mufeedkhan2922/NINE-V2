import type { BacktestTrade } from "./backtest";
import type { Candle } from "./types";
import {
  investigateLosses,
  buildTradeContext,
  contextKey,
  type RootCauseFinding,
  type TradeContext,
} from "./rootCauseLearning";
import { mineRules } from "./adaptiveRules";

export type ClosedLoopStatus =
  | "CANDIDATE"
  | "OOS_VALIDATED"
  | "ACTIVE_BLOCK"
  | "SHADOW"
  | "RELEASED";

export interface ClosedLoopRule {
  id: string;
  contextKey: string;
  cause: string;
  strategy: string;
  session: string;
  side: "LONG" | "SHORT";
  regime: TradeContext["regime"];
  status: ClosedLoopStatus;
  trainObservations: number;
  trainFailures: number;
  trainFailureRate: number;
  oosObservations: number;
  oosFailures: number;
  oosWins: number;
  oosFailureRate: number;
  oosFailureRateLower95: number;
  oosExpectancyR: number;
  counterEvidence: number;
  recentFailureRate: number | null;
  reason: string;
  updatedAt: number;
}

export interface ClosedLoopOptions {
  minimumTrainObservations?: number;
  minimumOosObservations?: number;
  minimumOosFailureLower95?: number;
  requireNegativeOosExpectancy?: boolean;
  recoveryFailureRate?: number;
  recoveryExpectancyR?: number;
  confidenceZ?: number;
}

export interface ClosedLoopGate {
  blocked: boolean;
  ruleId: string | null;
  reason: string;
  status: ClosedLoopStatus | "NONE";
}

export interface ClosedLoopCycle {
  trainStart: number | null;
  trainEnd: number | null;
  oosStart: number | null;
  oosEnd: number | null;
  rules: ClosedLoopRule[];
  activeBlocks: string[];
  shadowRules: string[];
  releasedRules: string[];
  nextAction: "ACTIVATE_VALIDATED_RULES" | "COLLECT_MORE_DATA" | "REVIEW_RECOVERY" | "NO_ACTION";
}

const DEFAULTS: Required<ClosedLoopOptions> = {
  minimumTrainObservations: 20,
  minimumOosObservations: 20,
  minimumOosFailureLower95: 0.55,
  requireNegativeOosExpectancy: true,
  recoveryFailureRate: 0.35,
  recoveryExpectancyR: 0,
  confidenceZ: 1.96,
};

function wilsonLower(successes: number, observations: number, z: number): number {
  if (observations <= 0) return 0;
  const p = successes / observations;
  const denominator = 1 + (z * z) / observations;
  const centre = p + (z * z) / (2 * observations);
  const margin = z * Math.sqrt(
    (p * (1 - p) / observations) +
    (z * z) / (4 * observations * observations),
  );
  return Math.max(0, (centre - margin) / denominator);
}

function tradeR(trade: BacktestTrade): number {
  const risk = Math.abs(trade.entryPrice - trade.stopLoss) * Math.max(0.000001, trade.quantity);
  return trade.pnl / risk;
}

function splitIndex(candles: Candle[], fraction: number): number {
  return Math.max(1, Math.min(candles.length - 1, Math.floor(candles.length * fraction)));
}

export function validateClosedLoopRules(
  trades: BacktestTrade[],
  candles: Candle[],
  input: ClosedLoopOptions = {},
): ClosedLoopCycle {
  const options = { ...DEFAULTS, ...input };
  if (candles.length < 40 || trades.length === 0) {
    return {
      trainStart: candles[0]?.time ?? null,
      trainEnd: candles.at(-1)?.time ?? null,
      oosStart: null,
      oosEnd: candles.at(-1)?.time ?? null,
      rules: [],
      activeBlocks: [],
      shadowRules: [],
      releasedRules: [],
      nextAction: "COLLECT_MORE_DATA",
    };
  }

  const cut = splitIndex(candles, 0.70);
  const trainCandles = candles.slice(0, cut);
  const oosCandles = candles.slice(Math.max(0, cut - 60));
  const splitTime = candles[cut]!.time;
  const trainTrades = trades.filter((trade) => trade.entryTime < splitTime);
  const oosTrades = trades.filter((trade) => trade.entryTime >= splitTime);

  const findings = investigateLosses(trainTrades, trainCandles);
  const mined = mineRules(findings, trainTrades, trainCandles, options.minimumTrainObservations);
  const candidateRules = mined.filter((rule) => rule.status === "VALIDATED");

  const oosFindings = investigateLosses(oosTrades, oosCandles);
  const oosByContext = new Map<string, BacktestTrade[]>();
  const oosFailures = new Map<string, RootCauseFinding[]>();

  for (const trade of oosTrades) {
    const key = contextKey(buildTradeContext(trade, oosCandles));
    const group = oosByContext.get(key) ?? [];
    group.push(trade);
    oosByContext.set(key, group);
  }

  for (const finding of oosFindings) {
    const key = contextKey(finding.context) + "|" + finding.cause;
    const group = oosFailures.get(key) ?? [];
    group.push(finding);
    oosFailures.set(key, group);
  }

  const rules: ClosedLoopRule[] = [];
  for (const rule of candidateRules) {
    const context = {
      strategy: rule.strategy,
      session: rule.session,
      side: rule.side,
      regime: rule.condition as TradeContext["regime"],
      htfAgreement: true,
      volatilityRatio: 1,
      momentumProxy: 1,
      entryTimingScore: 1,
    };
    const key = contextKey(context);
    const denominator = oosByContext.get(key) ?? [];
    const failureGroup = oosFailures.get(key + "|" + rule.cause) ?? [];
    const oosObservations = denominator.length;
    const oosFailuresCount = failureGroup.length;
    const oosWins = denominator.filter((trade) => trade.pnl > 0).length;
    const oosRs = denominator.map(tradeR);
    const oosExpectancyR = oosRs.length
      ? oosRs.reduce((sum, value) => sum + value, 0) / oosRs.length
      : 0;
    const failureRate = oosObservations ? oosFailuresCount / oosObservations : 0;
    const lower95 = wilsonLower(oosFailuresCount, oosObservations, options.confidenceZ);

    const recentCut = oosObservations ? Math.max(1, Math.floor(oosObservations * 0.5)) : 0;
    const recent = denominator.slice(-recentCut);
    const recentIds = new Set(recent.map((trade) => trade.id));
    const recentFailureRate = recent.length
      ? oosFindings.filter((finding) =>
          finding.context.strategy === context.strategy &&
          finding.context.session === context.session &&
          finding.context.side === context.side &&
          finding.context.regime === context.regime &&
          finding.cause === rule.cause &&
          recentIds.has(finding.tradeId),
        ).length / recent.length
      : null;

    const enoughOos = oosObservations >= options.minimumOosObservations;
    const oosValidated = enoughOos &&
      lower95 >= options.minimumOosFailureLower95 &&
      (!options.requireNegativeOosExpectancy || oosExpectancyR < 0);

    let status: ClosedLoopStatus = oosValidated ? "OOS_VALIDATED" : "CANDIDATE";
    let reason = enoughOos
      ? "Independent OOS evidence is not strong enough to activate this learned block."
      : "Independent OOS sample is too small; rule remains inactive.";

    if (oosValidated) {
      status = "ACTIVE_BLOCK";
      reason = "Training rule reproduced independently OOS with sufficient observations, conservative failure-rate evidence, and negative expectancy.";
    }

    if (
      oosValidated &&
      recentFailureRate !== null &&
      recentFailureRate <= options.recoveryFailureRate &&
      oosExpectancyR >= options.recoveryExpectancyR
    ) {
      status = "SHADOW";
      reason = "The historical failure rule reproduced OOS but recent evidence shows recovery; observe without blocking.";
    }

    if (
      status === "SHADOW" &&
      recentFailureRate !== null &&
      recentFailureRate <= options.recoveryFailureRate &&
      oosWins >= Math.ceil(oosObservations * 0.60)
    ) {
      status = "RELEASED";
      reason = "Recent counter-evidence is strong enough to release the old block.";
    }

    rules.push({
      id: rule.id,
      contextKey: key,
      cause: rule.cause,
      strategy: rule.strategy,
      session: rule.session,
      side: rule.side,
      regime: rule.condition as TradeContext["regime"],
      status,
      trainObservations: rule.observations,
      trainFailures: rule.failures,
      trainFailureRate: rule.failureRate,
      oosObservations,
      oosFailures: oosFailuresCount,
      oosWins,
      oosFailureRate: Number(failureRate.toFixed(4)),
      oosFailureRateLower95: Number(lower95.toFixed(4)),
      oosExpectancyR: Number(oosExpectancyR.toFixed(4)),
      counterEvidence: oosWins,
      recentFailureRate: recentFailureRate === null ? null : Number(recentFailureRate.toFixed(4)),
      reason,
      updatedAt: Date.now(),
    });
  }

  const activeBlocks = rules.filter((rule) => rule.status === "ACTIVE_BLOCK").map((rule) => rule.id);
  const shadowRules = rules.filter((rule) => rule.status === "SHADOW").map((rule) => rule.id);
  const releasedRules = rules.filter((rule) => rule.status === "RELEASED").map((rule) => rule.id);

  return {
    trainStart: trainCandles[0]?.time ?? null,
    trainEnd: trainCandles.at(-1)?.time ?? null,
    oosStart: oosTrades[0]?.entryTime ?? candles[cut]?.time ?? null,
    oosEnd: oosTrades.at(-1)?.exitTime ?? candles.at(-1)?.time ?? null,
    rules,
    activeBlocks,
    shadowRules,
    releasedRules,
    nextAction: activeBlocks.length
      ? "ACTIVATE_VALIDATED_RULES"
      : shadowRules.length
        ? "REVIEW_RECOVERY"
        : rules.length
          ? "COLLECT_MORE_DATA"
          : "NO_ACTION",
  };
}

export function evaluateClosedLoopGate(
  context: TradeContext,
  rules: ClosedLoopRule[],
): ClosedLoopGate {
  const active = rules.find((rule) =>
    rule.status === "ACTIVE_BLOCK" &&
    rule.contextKey === contextKey(context),
  );
  if (!active) {
    return {
      blocked: false,
      ruleId: null,
      status: "NONE",
      reason: "No independently validated loss rule matches the current context.",
    };
  }

  return {
    blocked: true,
    ruleId: active.id,
    status: active.status,
    reason: [
      "Closed-loop learning block:",
      active.cause,
      active.strategy,
      active.session,
      active.side,
      active.regime,
      "OOS=" + active.oosObservations +
        ", failures=" + active.oosFailures +
        ", lower95=" + active.oosFailureRateLower95 +
        ", expectancyR=" + active.oosExpectancyR,
    ].join(" | "),
  };
}
