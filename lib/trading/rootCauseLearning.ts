import type { BacktestTrade } from "./backtest";
import type { Candle } from "./types";
import { analyzeTechnicals } from "./technical";

export type RootCause =
  | "IMMEDIATE_ADVERSE_MOVE"
  | "NO_FOLLOW_THROUGH"
  | "NEAR_TARGET_REVERSAL"
  | "VOLATILITY_SHOCK"
  | "STRUCTURE_INVALIDATION"
  | "HTF_CONFLICT"
  | "WEAK_MOMENTUM"
  | "LATE_ENTRY"
  | "UNKNOWN";

export interface TradeContext {
  strategy: string;
  session: string;
  side: "LONG" | "SHORT";
  regime: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "EXPANDING" | "TRANSITION" | "UNKNOWN";
  htfAgreement: boolean;
  volatilityRatio: number;
  momentumProxy: number;
  entryTimingScore: number;
}

export interface RootCauseFinding {
  tradeId: string;
  context: TradeContext;
  cause: RootCause;
  evidence: string[];
  severity: number;
  lesson: string;
}

function sessionOf(time: number): string {
  const h = new Date(time).getUTCHours();
  if (h < 7) return "ASIA";
  if (h < 12) return "LONDON";
  if (h < 21) return "NEW_YORK";
  return "OFF";
}

function strategyOf(reason: string): string {
  return reason.split(";")[1]?.trim().replace(/^(LONG|SHORT)\s+/i, "") ?? "UNKNOWN_SETUP";
}

function aggregateBefore(candles: Candle[], beforeTime: number, bucketMinutes: number): Candle[] {
  const bucketMs = bucketMinutes * 60 * 1000;
  const map = new Map<number, Candle>();
  for (const candle of candles) {
    if (candle.time >= beforeTime) break;
    const bucket = Math.floor(candle.time / bucketMs) * bucketMs;
    const existing = map.get(bucket);
    if (!existing) {
      map.set(bucket, { ...candle });
    } else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      if (candle.volume !== undefined) existing.volume = (existing.volume ?? 0) + candle.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export function buildTradeContext(trade: BacktestTrade, candles: Candle[]): TradeContext {
  const entry = candles.findIndex((c) => c.time === trade.entryTime);
  const before = entry > 0 ? candles.slice(Math.max(0, entry - 40), entry) : [];
  const ranges = before.map((c) => c.high - c.low);
  const avgRange = ranges.length ? ranges.reduce((a, b) => a + b, 0) / ranges.length : 0;
  const entryCandle = candles[entry];
  const previous = candles[Math.max(0, entry - 3)];
  const move = entryCandle && previous ? Math.abs(entryCandle.close - previous.close) : 0;
  const volatilityRatio = avgRange > 0 && entryCandle ? (entryCandle.high - entryCandle.low) / avgRange : 1;
  const momentumProxy = avgRange > 0 ? move / avgRange : 0;

  const tf15 = aggregateBefore(candles, trade.entryTime, 15);
  const tf60 = aggregateBefore(candles, trade.entryTime, 60);
  const a15 = tf15.length >= 30 ? analyzeTechnicals(tf15) : null;
  const a60 = tf60.length >= 30 ? analyzeTechnicals(tf60) : null;
  const bullish15 = a15?.trend === "BULLISH" && (a15.momentum === "BULLISH" || (a15.macdHistogram ?? 0) > 0);
  const bearish15 = a15?.trend === "BEARISH" && (a15.momentum === "BEARISH" || (a15.macdHistogram ?? 0) < 0);
  const bullish60 = a60?.trend === "BULLISH" && (a60.momentum === "BULLISH" || (a60.macdHistogram ?? 0) > 0);
  const bearish60 = a60?.trend === "BEARISH" && (a60.momentum === "BEARISH" || (a60.macdHistogram ?? 0) < 0);
  const htfAgreement = trade.side === "LONG"
    ? Boolean(bullish15 && bullish60)
    : Boolean(bearish15 && bearish60);

  const entryTimingScore = entryCandle
    ? Math.min(1, Math.abs(entryCandle.close - entryCandle.open) / Math.max(0.000001, entryCandle.high - entryCandle.low))
    : 0;

  let regime: TradeContext["regime"] = "UNKNOWN";
  if (volatilityRatio >= 1.75) regime = "EXPANDING";
  else if (a15?.trend === "BULLISH" && (a15.momentum === "BULLISH" || (a15.macdHistogram ?? 0) > 0)) regime = "TRENDING_UP";
  else if (a15?.trend === "BEARISH" && (a15.momentum === "BEARISH" || (a15.macdHistogram ?? 0) < 0)) regime = "TRENDING_DOWN";
  else if (a15?.trend === "NEUTRAL") regime = "RANGING";
  else regime = "TRANSITION";

  return {
    strategy: strategyOf(trade.entryReason),
    session: sessionOf(trade.entryTime),
    side: trade.side,
    regime,
    htfAgreement,
    volatilityRatio,
    momentumProxy,
    entryTimingScore,
  };
}

export function contextKey(context: TradeContext): string {
  return [context.strategy, context.session, context.side, context.regime].join("|");
}

export function investigateRootCause(trade: BacktestTrade, candles: Candle[]): RootCauseFinding | null {
  if (trade.pnl >= 0) return null;

  const context = buildTradeContext(trade, candles);
  const entry = candles.findIndex((c) => c.time === trade.entryTime);
  const exit = candles.findIndex((c) => c.time === trade.exitTime);
  if (entry < 0 || exit <= entry) {
    return {
      tradeId: trade.id,
      context,
      cause: "UNKNOWN",
      evidence: ["Insufficient path data"],
      severity: 0,
      lesson: "Do not generalize this loss.",
    };
  }

  const risk = Math.max(0.000001, Math.abs(trade.entryPrice - trade.stopLoss));
  let mfe = 0;
  let mae = 0;
  for (const candle of candles.slice(entry, Math.min(exit + 1, entry + 36))) {
    const favorable = trade.side === "LONG"
      ? (candle.high - trade.entryPrice) / risk
      : (trade.entryPrice - candle.low) / risk;
    const adverse = trade.side === "LONG"
      ? (trade.entryPrice - candle.low) / risk
      : (candle.high - trade.entryPrice) / risk;
    mfe = Math.max(mfe, favorable);
    mae = Math.max(mae, adverse);
  }

  const evidence: string[] = [];
  let cause: RootCause = "UNKNOWN";
  if (context.volatilityRatio >= 2.5) {
    cause = "VOLATILITY_SHOCK";
    evidence.push("Entry window showed extreme range expansion versus its causal lookback.");
  } else if (!context.htfAgreement) {
    cause = "HTF_CONFLICT";
    evidence.push("Causal 15m/1h technical context disagreed with the trade direction.");
  } else if (mfe >= 1.5) {
    cause = "NEAR_TARGET_REVERSAL";
    evidence.push("Trade reached substantial favorable excursion before reversing.");
  } else if (mfe < 0.25) {
    cause = "NO_FOLLOW_THROUGH";
    evidence.push("Trade produced little favorable excursion after entry.");
  } else if (mae >= 0.65 && mfe < 0.5) {
    cause = "IMMEDIATE_ADVERSE_MOVE";
    evidence.push("Adverse excursion dominated before meaningful progress.");
  } else if (context.momentumProxy < 0.5) {
    cause = "WEAK_MOMENTUM";
    evidence.push("Entry displacement was weak relative to the causal recent range.");
  } else if (context.entryTimingScore < 0.25) {
    cause = "LATE_ENTRY";
    evidence.push("Entry candle contained limited directional displacement.");
  } else if (trade.reason === "STOP") {
    cause = "STRUCTURE_INVALIDATION";
    evidence.push("The stop was reached before the target.");
  }

  const lesson: Record<RootCause, string> = {
    IMMEDIATE_ADVERSE_MOVE: "Require stronger immediate confirmation before repeating this context.",
    NO_FOLLOW_THROUGH: "Require measurable post-entry displacement before repeating this context.",
    NEAR_TARGET_REVERSAL: "Review target geometry and continuation confirmation.",
    VOLATILITY_SHOCK: "Avoid comparable volatility shocks unless independently validated.",
    STRUCTURE_INVALIDATION: "Require the structural thesis to remain intact before entry.",
    HTF_CONFLICT: "Do not repeat this context when causal higher-timeframe direction conflicts.",
    WEAK_MOMENTUM: "Require stronger momentum/displacement confirmation.",
    LATE_ENTRY: "Avoid entries after useful displacement has already occurred.",
    UNKNOWN: "Insufficient evidence; do not create a hard rule.",
  }[cause];

  const riskDollars = Math.max(1, Math.abs(trade.entryPrice - trade.stopLoss) * trade.quantity);
  const severity = cause === "UNKNOWN" ? 0 : Math.min(1, 0.5 + Math.abs(trade.pnl) / riskDollars);
  return { tradeId: trade.id, context, cause, evidence, severity, lesson };
}

export function investigateLosses(trades: BacktestTrade[], candles: Candle[]): RootCauseFinding[] {
  return trades
    .map((trade) => investigateRootCause(trade, candles))
    .filter((finding): finding is RootCauseFinding => Boolean(finding));
}
