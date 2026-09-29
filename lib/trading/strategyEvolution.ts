import { db } from "./db";
import { NINE_STRATEGIES, type StrategyDefinition } from "./strategyLibrary";
import type { Candle, MarketSnapshot, TradeDirection } from "./types";

export type EvolutionStatus = "CANDIDATE" | "SHADOW" | "ACTIVE" | "RETIRED";

export interface StrategyMutation {
  id: string;
  baseStrategyId: string;
  name: string;
  kind: "STRICT_CONFIRMATION" | "COST_AWARE" | "REGIME_FILTER" | "TIMING_FILTER" | "RISK_FILTER";
  scoreBias: number;
  minimumScoreDelta: number;
  description: string;
}

export interface EvolutionWindowResult {
  strategyId: string;
  windowId: string;
  session: string;
  regime: string;
  trades: number;
  wins: number;
  winRate: number;
  winRateLower95: number;
  expectancyR: number;
  profitFactor: number;
  maxDrawdownR: number;
}

export interface StrategyEvolutionRecord {
  variantId: string;
  baseStrategyId: string;
  symbol: string;
  session: string;
  regime: string;
  status: EvolutionStatus;
  windows: EvolutionWindowResult[];
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  winRateLower95: number;
  expectancyR: number;
  profitFactor: number;
  robustnessScore: number;
  consecutiveBadWindows: number;
  mutation: StrategyMutation;
  reason: string;
  updatedAt: number;
}

export interface StrategyEvolutionSnapshot {
  generatedAt: number;
  symbol: MarketSnapshot["symbol"];
  windows: EvolutionWindowResult[];
  mutations: StrategyMutation[];
  records: StrategyEvolutionRecord[];
  activeStrategies: string[];
  shadowStrategies: string[];
  retiredStrategies: string[];
  nextAction: "PROMOTE_SHADOWS" | "COLLECT_MORE_DATA" | "REVIEW_RETIREMENTS" | "NO_ACTION";
}

export interface EvolutionSelectionAdjustment {
  scoreBias: number;
  minimumScoreDelta: number;
  status: EvolutionStatus | "NONE";
  reason: string;
  variantId: string | null;
}

const MUTATION_KINDS: Array<StrategyMutation["kind"]> = [
  "STRICT_CONFIRMATION",
  "COST_AWARE",
  "REGIME_FILTER",
  "TIMING_FILTER",
  "RISK_FILTER",
];

export function generateStrategyMutations(
  strategies: StrategyDefinition[] = NINE_STRATEGIES,
): StrategyMutation[] {
  const mutations: StrategyMutation[] = [];
  for (const strategy of strategies) {
    for (const kind of MUTATION_KINDS) {
      const id = `${strategy.id}::${kind.toLowerCase()}`;
      const definitions: Record<StrategyMutation["kind"], Omit<StrategyMutation, "id" | "baseStrategyId" | "name">> = {
        STRICT_CONFIRMATION: {
          kind,
          scoreBias: 3,
          minimumScoreDelta: 8,
          description: "Require a stronger setup score before the strategy is considered eligible.",
        },
        COST_AWARE: {
          kind,
          scoreBias: 2,
          minimumScoreDelta: 5,
          description: "Prefer setups with enough score headroom to survive spread/slippage assumptions.",
        },
        REGIME_FILTER: {
          kind,
          scoreBias: 4,
          minimumScoreDelta: 10,
          description: "Increase selection preference only when the historical regime/session evidence is supportive.",
        },
        TIMING_FILTER: {
          kind,
          scoreBias: 1,
          minimumScoreDelta: 4,
          description: "Prefer cleaner active-session timing and avoid weak timing contexts.",
        },
        RISK_FILTER: {
          kind,
          scoreBias: 0,
          minimumScoreDelta: 12,
          description: "Require additional statistical edge before a strategy can influence selection.",
        },
      };
      mutations.push({
        id,
        baseStrategyId: strategy.id,
        name: `${strategy.name} / ${kind.replace(/_/g, " ")}`,
        ...definitions[kind],
      });
    }
  }
  return mutations;
}

function wilsonLower(wins: number, observations: number, z = 1.96): number {
  if (observations <= 0) return 0;
  const p = wins / observations;
  const denominator = 1 + (z * z) / observations;
  const centre = p + (z * z) / (2 * observations);
  const margin = z * Math.sqrt((p * (1 - p) / observations) + (z * z) / (4 * observations * observations));
  return Math.max(0, (centre - margin) / denominator);
}

function regimeOf(candles: Candle[]): string {
  if (candles.length < 30) return "MIXED";
  const ranges = candles.slice(-20).map((c) => c.high - c.low);
  const prior = candles.slice(-60, -20).map((c) => c.high - c.low);
  const avg = ranges.reduce((a, b) => a + b, 0) / Math.max(1, ranges.length);
  const base = prior.reduce((a, b) => a + b, 0) / Math.max(1, prior.length);
  const delta = candles.at(-1)!.close - candles[Math.max(0, candles.length - 20)].close;
  if (base > 0 && avg > base * 1.35) return "EXPANDING";
  if (delta > 0) return "TRENDING_UP";
  if (delta < 0) return "TRENDING_DOWN";
  return "RANGING";
}

function sessionOf(time: number): string {
  const hour = new Date(time).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF";
}

function maxDrawdownR(rs: number[]): number {
  let equity = 0;
  let peak = 0;
  let dd = 0;
  for (const r of rs) {
    equity += r;
    peak = Math.max(peak, equity);
    dd = Math.max(dd, peak - equity);
  }
  return dd;
}

function scoreRobustness(
  windows: EvolutionWindowResult[],
  trades: number,
  expectancyR: number,
): number {
  if (!windows.length || trades < 20) return 0;
  const positiveWindows = windows.filter((w) => w.expectancyR > 0).length / windows.length;
  const meanLower = windows.reduce((s, w) => s + w.winRateLower95, 0) / windows.length;
  const expectancyStability = Math.max(0, Math.min(1, (positiveWindows * 0.6) + Math.min(0.4, Math.max(0, expectancyR + 0.2))));
  const sampleScore = Math.min(1, trades / 100);
  const confidenceScore = Math.min(1, meanLower);
  return Number((100 * (0.35 * sampleScore + 0.35 * confidenceScore + 0.30 * expectancyStability)).toFixed(2));
}

export function buildEvolutionSnapshot(
  symbol: MarketSnapshot["symbol"],
  candles: Candle[],
  evaluations: EvolutionWindowResult[],
  mutations = generateStrategyMutations(),
): StrategyEvolutionSnapshot {
  const grouped = new Map<string, EvolutionWindowResult[]>();
  for (const evaluation of evaluations) {
    const group = grouped.get(evaluation.strategyId) ?? [];
    group.push(evaluation);
    grouped.set(evaluation.strategyId, group);
  }

  const records: StrategyEvolutionRecord[] = [];
  for (const mutation of mutations) {
    const windows = grouped.get(mutation.baseStrategyId) ?? [];
    const trades = windows.reduce((s, w) => s + w.trades, 0);
    const wins = windows.reduce((s, w) => s + w.wins, 0);
    const losses = Math.max(0, trades - wins);
    const winRate = trades ? wins / trades : 0;
    const lower = wilsonLower(wins, trades);
    const expectancyR = windows.length
      ? windows.reduce((s, w) => s + w.expectancyR * Math.max(1, w.trades), 0) / Math.max(1, trades)
      : 0;
    const profitFactor = windows.length
      ? windows.reduce((s, w) => s + (Number.isFinite(w.profitFactor) ? w.profitFactor : 0), 0) / windows.length
      : 0;
    const robustness = scoreRobustness(windows, trades, expectancyR);
    const badWindows = windows.slice().reverse().findIndex((w) => w.expectancyR >= 0);
    const consecutiveBadWindows = badWindows < 0 ? windows.length : badWindows;

    let status: EvolutionStatus = "CANDIDATE";
    let reason = "Insufficient walk-forward evidence.";
    if (trades >= 20 && windows.length >= 3 && robustness >= 60 && lower >= 0.50 && expectancyR > 0) {
      status = "ACTIVE";
      reason = "Repeated walk-forward windows remain positive with conservative win-rate evidence and positive expectancy.";
    } else if (trades >= 10 && windows.length >= 2 && expectancyR > 0) {
      status = "SHADOW";
      reason = "Promising evidence exists, but the sample or robustness threshold is not sufficient for active selection.";
    }
    if (consecutiveBadWindows >= 3 && trades >= 30) {
      status = "RETIRED";
      reason = "Three or more consecutive completed walk-forward windows have negative expectancy; strategy is retired from dynamic selection pending re-validation.";
    }

    records.push({
      variantId: mutation.id,
      baseStrategyId: mutation.baseStrategyId,
      symbol,
      session: "ALL",
      regime: "ALL",
      status,
      windows,
      trades,
      wins,
      losses,
      winRate: Number((winRate * 100).toFixed(2)),
      winRateLower95: Number((lower * 100).toFixed(2)),
      expectancyR: Number(expectancyR.toFixed(4)),
      profitFactor: Number(profitFactor.toFixed(3)),
      robustnessScore: robustness,
      consecutiveBadWindows,
      mutation,
      reason,
      updatedAt: Date.now(),
    });
  }

  const activeStrategies = [...new Set(records.filter((r) => r.status === "ACTIVE").map((r) => r.baseStrategyId))];
  const shadowStrategies = [...new Set(records.filter((r) => r.status === "SHADOW").map((r) => r.baseStrategyId))];
  const retiredStrategies = [...new Set(records.filter((r) => r.status === "RETIRED").map((r) => r.baseStrategyId))];

  return {
    generatedAt: Date.now(),
    symbol,
    windows: evaluations,
    mutations,
    records,
    activeStrategies,
    shadowStrategies,
    retiredStrategies,
    nextAction: activeStrategies.length
      ? "PROMOTE_SHADOWS"
      : shadowStrategies.length
        ? "COLLECT_MORE_DATA"
        : retiredStrategies.length
          ? "REVIEW_RETIREMENTS"
          : "NO_ACTION",
  };
}

export function persistStrategyEvolution(snapshot: StrategyEvolutionSnapshot): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO strategy_evolution (
      variant_id,base_strategy_id,symbol,session,regime,status,windows_json,
      trades,wins,losses,win_rate,win_rate_lower_95,expectancy_r,profit_factor,
      robustness_score,consecutive_bad_windows,mutation_json,reason,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const now = Date.now();
  for (const record of snapshot.records) {
    stmt.run(
      record.variantId,
      record.baseStrategyId,
      record.symbol,
      record.session,
      record.regime,
      record.status,
      JSON.stringify(record.windows),
      record.trades,
      record.wins,
      record.losses,
      record.winRate,
      record.winRateLower95,
      record.expectancyR,
      record.profitFactor,
      record.robustnessScore,
      record.consecutiveBadWindows,
      JSON.stringify(record.mutation),
      record.reason,
      now,
    );
  }
}

export function getStrategyEvolutionAdjustment(
  market: MarketSnapshot,
  strategyId: string,
  session: string,
  regime: string,
): EvolutionSelectionAdjustment {
  try {
    const rows = db.prepare(
      `SELECT variant_id,status,robustness_score,expectancy_r,win_rate_lower_95,
        consecutive_bad_windows,mutation_json,reason
       FROM strategy_evolution
       WHERE symbol=? AND base_strategy_id=?
         AND (session=? OR session='ALL')
         AND (regime=? OR regime='ALL')
       ORDER BY updated_at DESC`,
    ).all(market.symbol, strategyId, session, regime) as Array<{
      variant_id: string; status: EvolutionStatus; robustness_score: number;
      expectancy_r: number; win_rate_lower_95: number; consecutive_bad_windows: number;
      mutation_json: string; reason: string;
    }>;
    if (!rows.length) return { scoreBias: 0, minimumScoreDelta: 0, status: "NONE", reason: "No persisted evolution evidence.", variantId: null };

    const active = rows.find((row) => row.status === "ACTIVE");
    const shadow = rows.find((row) => row.status === "SHADOW");
    const retired = rows.find((row) => row.status === "RETIRED");
    const selected = active ?? shadow ?? retired;
    if (!selected) return { scoreBias: 0, minimumScoreDelta: 0, status: "NONE", reason: "No selectable evolution record.", variantId: null };

    const mutation = JSON.parse(selected.mutation_json) as StrategyMutation;
    if (selected.status === "RETIRED") {
      return {
        scoreBias: -12,
        minimumScoreDelta: 15,
        status: "RETIRED",
        reason: selected.reason,
        variantId: selected.variant_id,
      };
    }
    if (selected.status === "SHADOW") {
      return {
        scoreBias: Math.min(4, mutation.scoreBias),
        minimumScoreDelta: Math.max(4, mutation.minimumScoreDelta),
        status: "SHADOW",
        reason: selected.reason,
        variantId: selected.variant_id,
      };
    }
    const confidence = Math.max(0, Math.min(1, Number(selected.win_rate_lower_95) / 100));
    return {
      scoreBias: Number((mutation.scoreBias + Math.min(6, Number(selected.expectancy_r) * 4) + confidence * 3).toFixed(2)),
      minimumScoreDelta: mutation.minimumScoreDelta,
      status: "ACTIVE",
      reason: selected.reason,
      variantId: selected.variant_id,
    };
  } catch {
    return { scoreBias: 0, minimumScoreDelta: 0, status: "NONE", reason: "Evolution memory unavailable; neutral selection.", variantId: null };
  }
}

export function evaluateEvolutionWindow(
  strategyId: string,
  candles: Candle[],
  windowId: string,
): EvolutionWindowResult {
  // This is deliberately a strategy-agnostic proxy evaluation. It measures whether
  // directional movement after the window signal is favorable, while the live
  // strategy engine remains the only source of executable setup logic.
  const returns: number[] = [];
  const scoped = candles.slice(-Math.min(120, candles.length));
  for (let i = 30; i < scoped.length - 3; i += 3) {
    const bar = scoped[i];
    const next = scoped[i + 1];
    if (!bar || !next) continue;
    const direction: TradeDirection =
      strategyId.includes("reversal") || strategyId.includes("sweep") || strategyId.includes("rsi")
        ? (bar.close < bar.open ? "LONG" : "SHORT")
        : (bar.close >= bar.open ? "LONG" : "SHORT");
    const range = Math.max(0.000001, bar.high - bar.low);
    const r = direction === "LONG" ? (next.close - bar.close) / range : (bar.close - next.close) / range;
    if (Number.isFinite(r)) returns.push(Math.max(-1, Math.min(2, r)));
  }
  const wins = returns.filter((r) => r > 0).length;
  const losses = returns.filter((r) => r <= 0).length;
  const grossWin = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(returns.filter((r) => r < 0).reduce((s, r) => s + r, 0));
  return {
    strategyId,
    windowId,
    session: sessionOf(scoped.at(-1)?.time ?? Date.now()),
    regime: regimeOf(scoped),
    trades: returns.length,
    wins,
    winRate: returns.length ? Number((wins / returns.length * 100).toFixed(2)) : 0,
    winRateLower95: Number((wilsonLower(wins, returns.length) * 100).toFixed(2)),
    expectancyR: returns.length ? Number((returns.reduce((s, r) => s + r, 0) / returns.length).toFixed(4)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossWin / grossLoss).toFixed(3)) : grossWin > 0 ? Number.POSITIVE_INFINITY : 0,
    maxDrawdownR: Number(maxDrawdownR(returns).toFixed(4)),
  };
}

export function buildRollingEvolutionEvaluations(
  candles: Candle[],
  strategyIds: string[] = NINE_STRATEGIES.map((s) => s.id),
): EvolutionWindowResult[] {
  const windows: EvolutionWindowResult[] = [];
  const size = Math.max(80, Math.floor(candles.length / 4));
  const step = Math.max(40, Math.floor(size / 2));
  let index = size;
  let windowNo = 0;
  while (index <= candles.length) {
    const validation = candles.slice(Math.max(0, index - size), index);
    for (const strategyId of strategyIds) {
      windows.push(evaluateEvolutionWindow(strategyId, validation, `WF-${windowNo}`));
    }
    index += step;
    windowNo += 1;
  }
  return windows;
}
