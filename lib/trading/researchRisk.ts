import type { HistoricalTrade } from "./historicalIntelligence";

export interface ResearchRiskProfile {
  trades: number;
  netR: number;
  expectancyR: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownR: number;
  maxConsecutiveLosses: number;
  averageWinR: number;
  averageLossR: number;
  var95R: number;
  cvar95R: number;
  worstTradeR: number;
  bestTradeR: number;
  kellyFraction: number;
  conservativeRiskFraction: number;
  riskOfRuinAtOnePercent: number;
  lossStreakProbability: number;
  riskNotes: string[];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, (sorted.length - 1) * p));
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

function maxDrawdown(rs: number[]): number {
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

function maxLossStreak(rs: number[]): number {
  let current = 0;
  let best = 0;
  for (const r of rs) {
    if (r < 0) {
      current += 1;
      best = Math.max(best, current);
    } else if (r > 0) {
      current = 0;
    }
  }
  return best;
}

function binomialRuinProbability(winRate: number, wins: number, losses: number, bankrollUnits = 100): number {
  if (wins <= 0 || losses <= 0 || bankrollUnits <= 0) return losses > wins ? 100 : 0;
  const edge = winRate - (1 - winRate);
  if (edge <= 0) return 100;
  const qOverP = (1 - winRate) / winRate;
  return Math.min(100, Math.max(0, Math.pow(qOverP, bankrollUnits) * 100));
}

export function buildResearchRiskProfile(trades: HistoricalTrade[]): ResearchRiskProfile {
  const rs = trades.map((trade) => trade.rMultiple).filter(Number.isFinite);
  if (!rs.length) {
    return {
      trades: 0, netR: 0, expectancyR: 0, winRate: 0, profitFactor: 0,
      maxDrawdownR: 0, maxConsecutiveLosses: 0, averageWinR: 0, averageLossR: 0,
      var95R: 0, cvar95R: 0, worstTradeR: 0, bestTradeR: 0, kellyFraction: 0,
      conservativeRiskFraction: 0, riskOfRuinAtOnePercent: 100, lossStreakProbability: 100,
      riskNotes: ["No out-of-sample trades are available for risk estimation."],
    };
  }

  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const winRate = wins.length / rs.length;
  const avgWin = wins.length ? wins.reduce((a, b) => a + b, 0) / wins.length : 0;
  const avgLossAbs = losses.length ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 0;
  const profitFactor = losses.length
    ? wins.reduce((a, b) => a + b, 0) / Math.abs(losses.reduce((a, b) => a + b, 0))
    : wins.length ? Number.POSITIVE_INFINITY : 0;
  const expectancy = rs.reduce((a, b) => a + b, 0) / rs.length;
  const kelly = avgWin > 0 && avgLossAbs > 0
    ? Math.max(0, Math.min(1, winRate - ((1 - winRate) / (avgWin / avgLossAbs))))
    : 0;
  const var95 = percentile(rs, 0.05);
  const tail = rs.filter((r) => r <= var95);
  const cvar95 = tail.length ? tail.reduce((a, b) => a + b, 0) / tail.length : var95;
  const streak = maxLossStreak(rs);
  const streakProbability = losses.length ? Math.pow(1 - winRate, Math.max(1, streak)) * 100 : 0;
  const ruin = binomialRuinProbability(winRate, wins.length, losses.length);

  const notes: string[] = [];
  if (expectancy <= 0) notes.push("Negative or flat OOS expectancy: risk should remain disabled.");
  if (profitFactor > 0 && profitFactor < 1) notes.push("OOS profit factor is below 1.");
  if (streak >= 5) notes.push(`Observed maximum loss streak is ${streak}; size for this tail event rather than average behavior.`);
  if (cvar95 < -2) notes.push(`Worst 5% average trade outcome is ${cvar95.toFixed(2)}R.`);
  if (kelly > 0.25) notes.push("Raw Kelly is aggressive; NINE caps the research-derived fraction at one quarter Kelly.");
  if (!notes.length) notes.push("No critical OOS risk warning was detected; this is research telemetry, not a live risk authorization.");

  return {
    trades: rs.length,
    netR: Number(rs.reduce((a, b) => a + b, 0).toFixed(3)),
    expectancyR: Number(expectancy.toFixed(3)),
    winRate: Number((winRate * 100).toFixed(2)),
    profitFactor: Number.isFinite(profitFactor) ? Number(profitFactor.toFixed(3)) : Number.POSITIVE_INFINITY,
    maxDrawdownR: Number(maxDrawdown(rs).toFixed(3)),
    maxConsecutiveLosses: streak,
    averageWinR: Number(avgWin.toFixed(3)),
    averageLossR: Number((-avgLossAbs).toFixed(3)),
    var95R: Number(var95.toFixed(3)),
    cvar95R: Number(cvar95.toFixed(3)),
    worstTradeR: Math.min(...rs),
    bestTradeR: Math.max(...rs),
    kellyFraction: Number(kelly.toFixed(4)),
    conservativeRiskFraction: Number((kelly * 0.25).toFixed(4)),
    riskOfRuinAtOnePercent: Number(ruin.toFixed(4)),
    lossStreakProbability: Number(streakProbability.toFixed(4)),
    riskNotes: notes,
  };
}
