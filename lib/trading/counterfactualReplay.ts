import { createHash } from "node:crypto";
import { db, transaction } from "./db";
import { evaluateRejectedTrade, type CounterfactualResult } from "./counterfactual";
import type { BacktestTrade } from "./backtest";
import type { Candle } from "./types";

export interface RejectedSetupInput {
  id?: string;
  entryTime: number;
  side: "LONG" | "SHORT";
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  rejectionReason?: string;
}

export interface RejectionQualityDecision {
  status: "NEUTRAL" | "VALIDATED" | "COSTLY";
  observations: number;
  winRateLower95: number;
  expectancyR: number;
  reason: string;
}

export interface CounterfactualPreventionDecision {
  status: "ALLOW" | "WATCH" | "PENALIZE";
  adjustment: number;
  observations: number;
  expectancyR: number;
  reason: string;
}

export interface ReplayInsight {
  tradeId: string;
  session: string;
  regime: string;
  side: "LONG" | "SHORT";
  outcome: CounterfactualResult["hypotheticalOutcome"];
  hypotheticalPnl: number;
  maxFavorableR: number;
  maxAdverseR: number;
  lesson: "REJECTION_VALIDATED" | "REJECTION_COSTLY" | "UNRESOLVED";
}

function sessionOf(time: number): string {
  const h = new Date(time).getUTCHours();
  return h < 7 ? "ASIA" : h < 12 ? "LONDON" : h < 21 ? "NEW_YORK" : "OFF";
}

function regimeOf(candles: Candle[]): string {
  if (candles.length < 60) return "MIXED";
  const recent = candles.slice(-20);
  const prior = candles.slice(-60, -20);
  const avg = recent.reduce((s, c) => s + c.high - c.low, 0) / Math.max(1, recent.length);
  const base = prior.reduce((s, c) => s + c.high - c.low, 0) / Math.max(1, prior.length);
  const displacement = recent.at(-1)!.close - recent[0].open;
  if (base > 0 && avg > base * 1.35) return "EXPANDING";
  if (displacement > avg * 4) return "TRENDING_UP";
  if (displacement < -avg * 4) return "TRENDING_DOWN";
  return "RANGING";
}

function normalizeBlocker(reason?: string): string {
  const raw = (reason ?? "UNKNOWN_REJECTION").trim();
  return raw.split(":")[0]?.trim().toUpperCase().replace(/\s+/g, "_") || "UNKNOWN_REJECTION";
}

function wilsonLower(wins: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = wins / n;
  const d = 1 + z * z / n;
  return (p + z*z/(2*n) - z*Math.sqrt((p*(1-p)+z*z/(4*n))/n)) / d;
}

function persistRejectionQuality(
  symbol: string,
  blocker: string,
  session: string,
  regime: string,
  side: "LONG" | "SHORT",
  result: CounterfactualResult,
): void {
  const outcome = result.hypotheticalOutcome;
  if (outcome === "UNRESOLVED" || outcome === "AMBIGUOUS") return;
  const id = createHash("sha256").update(["rejection", symbol, blocker, session, regime, side, outcome].join("|")).digest("hex").slice(0, 24);
  transaction(() => {
    const old = db.prepare(
      "SELECT observations,wins,losses,expectancy_r FROM rejection_quality_memory WHERE id=?",
    ).get(id) as any;
    const isWin = outcome === "WOULD_HAVE_WON";
    const isLoss = outcome === "WOULD_HAVE_LOST";
    if (!old) {
      db.prepare(
        "INSERT INTO rejection_quality_memory (id,symbol,blocker,session,regime,side,outcome,observations,wins,losses,expectancy_r,win_rate_lower_95,status,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id, symbol, blocker, session, regime, side, outcome, 1,
        isWin ? 1 : 0, isLoss ? 1 : 0, result.hypotheticalPnl,
        wilsonLower(isWin ? 1 : 0, 1), "OBSERVE", "REJECTION_QUALITY_AUDIT", Date.now(),
      );
      return;
    }
    const previousN = Number(old.observations);
    const n = previousN + 1;
    const wins = Number(old.wins) + (isWin ? 1 : 0);
    const losses = Number(old.losses) + (isLoss ? 1 : 0);
    const expectancy = (Number(old.expectancy_r) * previousN + result.hypotheticalPnl) / n;
    const lower = wilsonLower(wins, n);
    const status =
      n >= 20 && lower < 0.45 && expectancy < 0
        ? "VALIDATED"
        : n >= 20 && lower > 0.55 && expectancy > 0
          ? "COSTLY"
          : "OBSERVE";
    db.prepare(
      "UPDATE rejection_quality_memory SET observations=?,wins=?,losses=?,expectancy_r=?,win_rate_lower_95=?,status=?,updated_at=? WHERE id=?",
    ).run(n, wins, losses, expectancy, lower, status, Date.now(), id);
  });
}

function persistInsight(symbol: string, session: string, regime: string, side: "LONG"|"SHORT", result: CounterfactualResult, rejectionReason?: string): void {
  persistRejectionQuality(symbol, normalizeBlocker(rejectionReason), session, regime, side, result);
  const outcome = result.hypotheticalOutcome;
  if (outcome === "AMBIGUOUS") return;
  const id = createHash("sha256").update([symbol, session, regime, side, outcome].join("|")).digest("hex").slice(0,24);
  transaction(() => {
    const old = db.prepare("SELECT observations,wins,losses,expectancy_r FROM counterfactual_learning_memory WHERE id=?").get(id) as any;
    const isWin = outcome === "WOULD_HAVE_WON";
    const isLoss = outcome === "WOULD_HAVE_LOST";
    if (!old) {
      const n = 1;
      db.prepare("INSERT INTO counterfactual_learning_memory (id,symbol,session,regime,side,outcome,observations,wins,losses,expectancy_r,win_rate_lower_95,status,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(id,symbol,session,regime,side,outcome,n,isWin?1:0,isLoss?1:0,result.hypotheticalPnl,wilsonLower(isWin?1:0,n),"OBSERVE","COUNTERFACTUAL_REPLAY",Date.now());
      return;
    }
    const n = Number(old.observations)+1;
    const wins = Number(old.wins)+(isWin?1:0);
    const losses = Number(old.losses)+(isLoss?1:0);
    const expectancy = (Number(old.expectancy_r)*Number(old.observations)+result.hypotheticalPnl)/n;
    const lower = wilsonLower(wins,n);
    const status = n >= 20 && losses > 0 && lower < 0.45 && expectancy < 0 ? "VALIDATED" : "OBSERVE";
    db.prepare("UPDATE counterfactual_learning_memory SET observations=?,wins=?,losses=?,expectancy_r=?,win_rate_lower_95=?,status=?,updated_at=? WHERE id=?")
      .run(n,wins,losses,expectancy,lower,status,Date.now(),id);
  });
}

export function replayRejectedSetup(
  setup: RejectedSetupInput,
  candles: Candle[],
  horizon = 36,
  symbol = "XAUUSD",
): ReplayInsight {
  const result = evaluateRejectedTrade(
    setup.entryTime,
    setup.side,
    setup.entryPrice,
    setup.stopLoss,
    setup.takeProfit,
    candles,
    horizon,
  );
  const session = sessionOf(setup.entryTime);
  const entryIndex = candles.findIndex((candle) => candle.time >= setup.entryTime);
  const decisionCandles = entryIndex > 0 ? candles.slice(0, entryIndex) : candles.slice(0, Math.max(0, entryIndex));
  const regime = regimeOf(decisionCandles);
  persistInsight(symbol, session, regime, setup.side, result, setup.rejectionReason);
  return {
    tradeId: result.tradeId,
    session,
    regime,
    side: setup.side,
    outcome: result.hypotheticalOutcome,
    hypotheticalPnl: result.hypotheticalPnl,
    maxFavorableR: result.maxFavorableR,
    maxAdverseR: result.maxAdverseR,
    lesson: result.hypotheticalOutcome === "WOULD_HAVE_LOST"
      ? "REJECTION_VALIDATED"
      : result.hypotheticalOutcome === "WOULD_HAVE_WON"
        ? "REJECTION_COSTLY"
        : "UNRESOLVED",
  };
}

export function replayRejectedTrade(trade: BacktestTrade, candles: Candle[], horizon = 36, symbol = "XAUUSD"): ReplayInsight {
  const result = evaluateRejectedTrade(
    trade.entryTime,
    trade.side,
    trade.entryPrice,
    trade.stopLoss,
    trade.takeProfit,
    candles,
    horizon,
  );
  const session = sessionOf(trade.entryTime);
  const regime = regimeOf(candles);
  persistInsight(symbol, session, regime, trade.side, result);
  return {
    tradeId: result.tradeId,
    session,
    regime,
    side: trade.side,
    outcome: result.hypotheticalOutcome,
    hypotheticalPnl: result.hypotheticalPnl,
    maxFavorableR: result.maxFavorableR,
    maxAdverseR: result.maxAdverseR,
    lesson: result.hypotheticalOutcome === "WOULD_HAVE_LOST"
      ? "REJECTION_VALIDATED"
      : result.hypotheticalOutcome === "WOULD_HAVE_WON"
        ? "REJECTION_COSTLY"
        : "UNRESOLVED",
  };
}

export function replayRejectedTrades(trades: BacktestTrade[], candles: Candle[], symbol = "XAUUSD"): ReplayInsight[] {
  return trades.map((trade) => replayRejectedTrade(trade, candles, 36, symbol));
}

export function counterfactualReplaySummary(symbol = "XAUUSD") {
  return db.prepare(
    `SELECT session,regime,side,outcome,observations,wins,losses,
            ROUND(expectancy_r,4) AS expectancyR,
            ROUND(win_rate_lower_95,4) AS winRateLower95,status
     FROM counterfactual_learning_memory
     WHERE symbol=?
     ORDER BY observations DESC, updated_at DESC`,
  ).all(symbol) as Array<Record<string, unknown>>;
}


export function getCounterfactualPreventionDecision(
  symbol: string,
  session: string,
  regime: string,
  side: "LONG" | "SHORT",
): CounterfactualPreventionDecision {
  const exact = db.prepare(
    `SELECT observations, expectancy_r AS expectancyR
     FROM counterfactual_learning_memory
     WHERE symbol=? AND session=? AND regime=? AND side=? AND outcome='WOULD_HAVE_LOST' AND status='VALIDATED'
     ORDER BY observations DESC LIMIT 1`,
  ).get(symbol, session, regime, side) as any;

  if (!exact) {
    return {
      status: "ALLOW",
      adjustment: 0,
      observations: 0,
      expectancyR: 0,
      reason: "No statistically validated counterfactual rejection pattern matches this exact context.",
    };
  }

  return {
    status: "WATCH",
    adjustment: -3,
    observations: Number(exact.observations),
    expectancyR: Number(exact.expectancyR),
    reason: `Validated rejected-setup replay shows this ${side} context historically would have lost; keep the setup under elevated scrutiny.`,
  };
}

export function getRejectionQualityDecision(
  symbol: string,
  blocker: string,
  session: string,
  regime: string,
  side: "LONG" | "SHORT",
): RejectionQualityDecision {
  const row = db.prepare(
    `SELECT observations,win_rate_lower_95 AS winRateLower95,expectancy_r,status
     FROM rejection_quality_memory
     WHERE symbol=? AND blocker=? AND session=? AND regime=? AND side=?
     ORDER BY observations DESC LIMIT 1`,
  ).get(symbol, normalizeBlocker(blocker), session, regime, side) as any;

  if (!row || row.status === "OBSERVE") {
    return {
      status: "NEUTRAL",
      observations: Number(row?.observations ?? 0),
      winRateLower95: Number(row?.winRateLower95 ?? 0),
      expectancyR: Number(row?.expectancy_r ?? 0),
      reason: "Insufficient rejection-quality evidence for this blocker/context.",
    };
  }

  if (row.status === "VALIDATED") {
    return {
      status: "VALIDATED",
      observations: Number(row.observations),
      winRateLower95: Number(row.winRateLower95),
      expectancyR: Number(row.expectancy_r),
      reason: "Historical replay supports the rejection: rejected setups in this blocker/context were statistically more likely to fail.",
    };
  }

  return {
    status: "COSTLY",
    observations: Number(row.observations),
    winRateLower95: Number(row.winRateLower95),
    expectancyR: Number(row.expectancy_r),
    reason: "Historical replay flags this blocker/context as costly: rejected setups were statistically more likely to succeed. This is audit evidence only and does not weaken the blocker automatically.",
  };
}

export function rejectionQualitySummary(symbol = "XAUUSD") {
  return db.prepare(
    `SELECT blocker,session,regime,side,outcome,observations,wins,losses,
            ROUND(expectancy_r,4) AS expectancyR,
            ROUND(win_rate_lower_95,4) AS winRateLower95,status
     FROM rejection_quality_memory
     WHERE symbol=?
     ORDER BY observations DESC,updated_at DESC`,
  ).all(symbol) as Array<Record<string, unknown>>;
}
