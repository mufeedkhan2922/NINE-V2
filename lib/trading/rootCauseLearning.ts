import type { BacktestTrade } from "./backtest";
import type { Candle } from "./types";

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
  regime: string;
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

function contextFor(trade: BacktestTrade, candles: Candle[]): TradeContext {
  const entry = candles.findIndex(c => c.time === trade.entryTime);
  const before = entry > 0 ? candles.slice(Math.max(0, entry - 20), entry) : [];
  const ranges = before.map(c => c.high - c.low);
  const avg = ranges.length ? ranges.reduce((a,b)=>a+b,0)/ranges.length : 0;
  const entryCandle = candles[entry];
  const previous = candles[Math.max(0, entry - 3)];
  const move = entryCandle && previous ? Math.abs(entryCandle.close - previous.close) : 0;
  const volatilityRatio = avg > 0 && entryCandle ? (entryCandle.high-entryCandle.low)/avg : 1;
  const momentumProxy = avg > 0 ? move/avg : 0;
  const htfAgreement = before.length >= 12
    ? (trade.side === "LONG" ? entryCandle.close >= previous.close : entryCandle.close <= previous.close)
    : false;
  const entryTimingScore = entry > 2 && entryCandle && previous
    ? Math.min(1, Math.abs(entryCandle.close-entryCandle.open)/Math.max(0.000001, entryCandle.high-entryCandle.low))
    : 0;
  const regime = volatilityRatio >= 1.75 ? "EXPANDING" : momentumProxy >= 1.0 ? (trade.side === "LONG" ? "TRENDING_UP" : "TRENDING_DOWN") : "MIXED";
  return { strategy: strategyOf(trade.entryReason), session: sessionOf(trade.entryTime), side: trade.side, regime, htfAgreement, volatilityRatio, momentumProxy, entryTimingScore };
}

export function investigateRootCause(trade: BacktestTrade, candles: Candle[]): RootCauseFinding | null {
  if (trade.pnl >= 0) return null;
  const context = contextFor(trade, candles);
  const entry = candles.findIndex(c => c.time === trade.entryTime);
  const exit = candles.findIndex(c => c.time === trade.exitTime);
  if (entry < 0 || exit <= entry) return { tradeId: trade.id, context, cause: "UNKNOWN", evidence: ["Insufficient path data"], severity: 0, lesson: "Do not generalize this loss." };

  const risk = Math.max(0.000001, Math.abs(trade.entryPrice-trade.stopLoss));
  let mfe = 0;
  let mae = 0;
  for (const c of candles.slice(entry, Math.min(exit+1, entry+36))) {
    const favorable = trade.side === "LONG" ? (c.high-trade.entryPrice)/risk : (trade.entryPrice-c.low)/risk;
    const adverse = trade.side === "LONG" ? (trade.entryPrice-c.low)/risk : (c.high-trade.entryPrice)/risk;
    mfe = Math.max(mfe, favorable);
    mae = Math.max(mae, adverse);
  }
  const evidence: string[] = [];
  let cause: RootCause = "UNKNOWN";
  if (context.volatilityRatio >= 2.5) { cause="VOLATILITY_SHOCK"; evidence.push("Entry/exit window experienced extreme range expansion."); }
  else if (!context.htfAgreement) { cause="HTF_CONFLICT"; evidence.push("Directional higher-timeframe proxy disagreed with the trade."); }
  else if (mfe >= 1.5) { cause="NEAR_TARGET_REVERSAL"; evidence.push("Trade achieved substantial favorable excursion before reversing."); }
  else if (mfe < 0.25) { cause="NO_FOLLOW_THROUGH"; evidence.push("Trade failed to produce meaningful favorable excursion."); }
  else if (mae >= 0.65 && mfe < 0.5) { cause="IMMEDIATE_ADVERSE_MOVE"; evidence.push("Adverse excursion dominated before meaningful progress."); }
  else if (context.momentumProxy < 0.5) { cause="WEAK_MOMENTUM"; evidence.push("Entry displacement was weak relative to recent range."); }
  else if (context.entryTimingScore < 0.25) { cause="LATE_ENTRY"; evidence.push("Entry candle provided weak directional displacement."); }
  else if (trade.reason === "STOP") { cause="STRUCTURE_INVALIDATION"; evidence.push("Stop was reached before the target."); }

  const lesson = {
    IMMEDIATE_ADVERSE_MOVE: "Require stronger immediate confirmation before repeating this context.",
    NO_FOLLOW_THROUGH: "Require measurable post-entry displacement before allowing this setup context.",
    NEAR_TARGET_REVERSAL: "Review target geometry and continuation confirmation; do not assume every signal deserves the same target.",
    VOLATILITY_SHOCK: "Avoid this setup during comparable volatility shocks unless independently validated.",
    STRUCTURE_INVALIDATION: "Require the structural thesis to remain intact before entry.",
    HTF_CONFLICT: "Do not repeat this setup when higher-timeframe direction conflicts.",
    WEAK_MOMENTUM: "Require stronger momentum/displacement confirmation.",
    LATE_ENTRY: "Avoid entries after the useful displacement has already occurred.",
    UNKNOWN: "Insufficient evidence; do not create a hard rule."
  }[cause];

  return { tradeId: trade.id, context, cause, evidence, severity: cause === "UNKNOWN" ? 0 : Math.min(1, 0.5 + Math.abs(trade.pnl)/Math.max(1, Math.abs(trade.entryPrice-trade.stopLoss)*trade.quantity)), lesson };
}

export function investigateLosses(trades: BacktestTrade[], candles: Candle[]): RootCauseFinding[] {
  return trades.map(t => investigateRootCause(t,candles)).filter((x): x is RootCauseFinding => Boolean(x));
}
