import { createHash } from "node:crypto";
import { db, transaction } from "./db";
import type { BacktestTrade } from "./backtest";
import type { Candle } from "./types";

export type LossCause =
  | "IMMEDIATE_ADVERSE_MOVE"
  | "NO_FOLLOW_THROUGH"
  | "NEAR_TARGET_REVERSAL"
  | "VOLATILITY_SHOCK"
  | "STRUCTURE_INVALIDATION"
  | "UNKNOWN";

export interface TradeLesson {
  id: string;
  symbol: string;
  strategy: string;
  session: string;
  side: "LONG" | "SHORT";
  cause: LossCause;
  occurrences: number;
  losses: number;
  wins: number;
  totalR: number;
  lesson: string;
  source: string;
  updatedAt: number;
}

function strategyFromReason(reason: string): string {
  const match = reason.match(/^(?:[^;]+);\s*(?:LONG|SHORT)\s+([^;]+)/i);
  return match?.[1]?.trim() ?? reason.split(";")[1]?.trim() ?? "UNKNOWN_SETUP";
}

function sessionFromTime(time: number): string {
  const hour = new Date(time).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF";
}

function riskDistance(trade: BacktestTrade): number {
  return Math.max(0.000001, Math.abs(trade.entryPrice - trade.stopLoss));
}

function inspectCause(trade: BacktestTrade, candles: Candle[]): LossCause {
  if (trade.pnl >= 0) return "UNKNOWN";
  const entryIndex = candles.findIndex((c) => c.time === trade.entryTime);
  const exitIndex = candles.findIndex((c) => c.time === trade.exitTime);
  if (entryIndex < 0 || exitIndex <= entryIndex) return "UNKNOWN";

  const risk = riskDistance(trade);
  let maxFavorable = 0;
  let maxAdverse = 0;
  let maxRangeRatio = 0;

  const lookback = candles.slice(Math.max(0, entryIndex - 14), entryIndex);
  const atr = lookback.length
    ? lookback.reduce((sum, c) => sum + c.high - c.low, 0) / lookback.length
    : 0;

  for (const candle of candles.slice(entryIndex, Math.min(exitIndex + 1, entryIndex + 24))) {
    const favorable = trade.side === "LONG"
      ? (candle.high - trade.entryPrice) / risk
      : (trade.entryPrice - candle.low) / risk;
    const adverse = trade.side === "LONG"
      ? (trade.entryPrice - candle.low) / risk
      : (candle.high - trade.entryPrice) / risk;
    maxFavorable = Math.max(maxFavorable, favorable);
    maxAdverse = Math.max(maxAdverse, adverse);
    if (atr > 0) maxRangeRatio = Math.max(maxRangeRatio, (candle.high - candle.low) / atr);
  }

  if (maxRangeRatio >= 2.5) return "VOLATILITY_SHOCK";
  if (maxFavorable >= 1.5) return "NEAR_TARGET_REVERSAL";
  if (maxAdverse >= 0.65 && maxFavorable < 0.25) return "IMMEDIATE_ADVERSE_MOVE";
  if (maxFavorable < 0.5) return "NO_FOLLOW_THROUGH";
  if (trade.reason === "STOP") return "STRUCTURE_INVALIDATION";
  return "UNKNOWN";
}

function lessonText(cause: LossCause): string {
  switch (cause) {
    case "IMMEDIATE_ADVERSE_MOVE": return "Setup moved against the entry immediately; require stronger confirmation before repeating the same setup context.";
    case "NO_FOLLOW_THROUGH": return "Setup formed but failed to produce sufficient favorable displacement; require follow-through evidence before repeating.";
    case "NEAR_TARGET_REVERSAL": return "Setup reached meaningful favorable excursion and then reversed; investigate target geometry and exit management before repeating.";
    case "VOLATILITY_SHOCK": return "A volatility expansion overwhelmed the setup geometry; avoid repeating this setup during comparable volatility conditions.";
    case "STRUCTURE_INVALIDATION": return "The structural thesis was invalidated before the target; require the invalidation condition to remain intact.";
    default: return "Cause could not be established confidently; keep the setup under observation.";
  }
}

export function investigateTradeLoss(
  trade: BacktestTrade,
  candles: Candle[],
  symbol = "XAUUSD",
): TradeLesson | null {
  if (trade.pnl >= 0) return null;
  const cause = inspectCause(trade, candles);
  const strategy = strategyFromReason(trade.entryReason);
  const session = sessionFromTime(trade.entryTime);
  const risk = riskDistance(trade);
  const r = trade.pnl / (risk * Math.max(0.000001, trade.quantity));
  return {
    id: createHash("sha256").update([symbol, strategy, session, trade.side, cause].join("|")).digest("hex").slice(0, 24),
    symbol,
    strategy,
    session,
    side: trade.side,
    cause,
    occurrences: 1,
    losses: 1,
    wins: 0,
    totalR: r,
    lesson: lessonText(cause),
    source: "XAUUSD_BACKTEST",
    updatedAt: Date.now(),
  };
}

export function rememberTradeLesson(lesson: TradeLesson): void {
  transaction(() => {
    const existing = db.prepare(
      "SELECT occurrences, losses, wins, total_r, first_seen FROM trade_lessons WHERE symbol=? AND strategy=? AND session=? AND side=? AND cause=?",
    ).get(lesson.symbol, lesson.strategy, lesson.session, lesson.side, lesson.cause) as any;
    if (existing) {
      db.prepare(
        "UPDATE trade_lessons SET occurrences=?, losses=?, wins=?, total_r=?, last_seen=?, lesson=?, source=?, updated_at=? WHERE symbol=? AND strategy=? AND session=? AND side=? AND cause=?",
      ).run(
        Number(existing.occurrences) + 1,
        Number(existing.losses) + lesson.losses,
        Number(existing.wins) + lesson.wins,
        Number(existing.total_r) + lesson.totalR,
        Date.now(),
        lesson.lesson,
        lesson.source,
        Date.now(),
        lesson.symbol, lesson.strategy, lesson.session, lesson.side, lesson.cause,
      );
      return;
    }
    db.prepare(
      "INSERT INTO trade_lessons (id,symbol,strategy,session,side,cause,occurrences,losses,wins,total_r,first_seen,last_seen,lesson,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      lesson.id, lesson.symbol, lesson.strategy, lesson.session, lesson.side, lesson.cause,
      1, lesson.losses, lesson.wins, lesson.totalR, Date.now(), Date.now(),
      lesson.lesson, lesson.source, Date.now(),
    );
  });
}

export function rememberBacktestLosses(trades: BacktestTrade[], candles: Candle[], symbol = "XAUUSD"): TradeLesson[] {
  const lessons: TradeLesson[] = [];
  for (const trade of trades) {
    const lesson = investigateTradeLoss(trade, candles, symbol);
    const strategy = strategyFromReason(trade.entryReason);
    const session = sessionFromTime(trade.entryTime);
    const risk = riskDistance(trade);
    const r = trade.pnl / (risk * Math.max(0.000001, trade.quantity));
    const record = lesson ?? {
      id: createHash("sha256").update([symbol, strategy, session, trade.side, "UNKNOWN"].join("|")).digest("hex").slice(0, 24),
      symbol,
      strategy,
      session,
      side: trade.side,
      cause: "UNKNOWN" as const,
      occurrences: 1,
      losses: 0,
      wins: 1,
      totalR: r,
      lesson: "Successful outcome recorded as counter-evidence; do not block the setup without considering this evidence.",
      source: "XAUUSD_BACKTEST",
      updatedAt: Date.now(),
    };
    if (lesson) lessons.push(lesson);
    rememberTradeLesson(record);
  }
  return lessons;
}

export function getTradeLessons(symbol = "XAUUSD"): TradeLesson[] {
  const rows = db.prepare(
    "SELECT id,symbol,strategy,session,side,cause,occurrences,losses,wins,total_r AS totalR,lesson,source,updated_at AS updatedAt FROM trade_lessons WHERE symbol=? ORDER BY updated_at DESC",
  ).all(symbol) as any[];
  return rows.map((row) => ({ ...row, side: row.side as "LONG" | "SHORT", cause: row.cause as LossCause }));
}

export function getLessonDecision(
  symbol: string,
  strategy: string,
  session: string,
  side: "LONG" | "SHORT",
  minimumOccurrences = 20,
): { blocked: boolean; lessons: TradeLesson[]; reason: string } {
  const lessons = getTradeLessons(symbol).filter(
    (lesson) => lesson.strategy.toUpperCase() === strategy.toUpperCase()
      && lesson.session === session
      && lesson.side === side,
  );
  const observations = lessons.reduce((sum, lesson) => sum + lesson.occurrences, 0);
  const losses = lessons.reduce((sum, lesson) => sum + lesson.losses, 0);
  const totalR = lessons.reduce((sum, lesson) => sum + lesson.totalR, 0);
  const expectancyR = observations ? totalR / observations : 0;
  const winRate = observations ? ((observations - losses) / observations) : 0;
  const z = 1.96;
  const denominator = 1 + (z * z) / Math.max(1, observations);
  const centre = winRate + (z * z) / (2 * Math.max(1, observations));
  const spread = z * Math.sqrt((winRate * (1 - winRate) + (z * z) / (4 * Math.max(1, observations))) / Math.max(1, observations));
  const wilsonUpperWinRate = (centre + spread) / denominator;
  const breakEvenWinRate = 1 / 3;
  const blocked = observations >= minimumOccurrences
    && expectancyR < -0.05
    && wilsonUpperWinRate < breakEvenWinRate;
  return {
    blocked,
    lessons,
    reason: blocked
      ? "NINE remembered a statistically repeated negative lesson for this setup context and will not repeat it until new evidence changes the record."
      : observations < minimumOccurrences
        ? "Not enough remembered outcomes; NINE keeps the setup neutral rather than guessing."
        : "Remembered outcomes do not yet justify blocking this setup context.",
  };
}
