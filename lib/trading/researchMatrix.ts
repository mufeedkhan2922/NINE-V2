import { createHash } from "node:crypto";

export interface ResearchBucket {
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
}

export interface ResearchMatrixCell {
  strategyId: string;
  strategyName: string;
  dimension: "SESSION" | "REGIME";
  context: string;
  trades: number;
  winRate: number;
  expectancyR: number;
  evidenceWeight: number;
  qualified: boolean;
}

export interface StrategyResearchWeight {
  strategyId: string;
  strategyName: string;
  globalExpectancyR: number;
  globalWinRate: number;
  sampleSize: number;
  sessionBest: string | null;
  regimeBest: string | null;
  researchWeight: number;
  qualification: "INSUFFICIENT_DATA" | "WATCH" | "QUALIFIED";
}

export interface StrategyResearchMatrix {
  cells: ResearchMatrixCell[];
  strategyWeights: StrategyResearchWeight[];
  sessionLeaders: Record<string, string | null>;
  regimeLeaders: Record<string, string | null>;
  methodology: string[];
  evidenceHash: string;
  generatedAt: number;
}

type StrategyStatsLike = {
  strategyId: string;
  strategyName: string;
  trades: number;
  winRate: number;
  expectancyR: number;
  sessions: Record<string, ResearchBucket>;
  regimes: Record<string, ResearchBucket>;
};

const MIN_CONTEXT_TRADES = 8;

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function evidenceWeight(trades: number): number {
  return Math.min(1, Math.sqrt(Math.max(0, trades) / 40));
}

function contextScore(bucket: ResearchBucket): number {
  if (bucket.trades < MIN_CONTEXT_TRADES) return 0;
  return finite(bucket.expectancyR) * evidenceWeight(bucket.trades);
}

function qualification(stats: StrategyStatsLike): StrategyResearchWeight["qualification"] {
  if (stats.trades < 20) return "INSUFFICIENT_DATA";
  if (stats.expectancyR <= 0 || stats.winRate < 50) return "WATCH";
  return "QUALIFIED";
}

function bestContext(
  entries: Array<[string, ResearchBucket]>,
): string | null {
  return entries
    .filter(([, bucket]) => bucket.trades >= MIN_CONTEXT_TRADES)
    .sort((a, b) => contextScore(b[1]) - contextScore(a[1]))[0]?.[0] ?? null;
}

/**
 * Builds research-only conditional weights from already validated historical
 * statistics. These weights are descriptive evidence; they never authorize
 * execution and never replace Sentinel.
 */
export function buildStrategyResearchMatrix(
  stats: StrategyStatsLike[],
): StrategyResearchMatrix {
  const cells: ResearchMatrixCell[] = [];
  const strategyWeights: StrategyResearchWeight[] = [];

  for (const stat of stats) {
    for (const [context, bucket] of Object.entries(stat.sessions)) {
      cells.push({
        strategyId: stat.strategyId,
        strategyName: stat.strategyName,
        dimension: "SESSION",
        context,
        trades: bucket.trades,
        winRate: finite(bucket.winRate),
        expectancyR: finite(bucket.expectancyR),
        evidenceWeight: Number(evidenceWeight(bucket.trades).toFixed(4)),
        qualified: bucket.trades >= MIN_CONTEXT_TRADES && bucket.expectancyR > 0,
      });
    }

    for (const [context, bucket] of Object.entries(stat.regimes)) {
      cells.push({
        strategyId: stat.strategyId,
        strategyName: stat.strategyName,
        dimension: "REGIME",
        context,
        trades: bucket.trades,
        winRate: finite(bucket.winRate),
        expectancyR: finite(bucket.expectancyR),
        evidenceWeight: Number(evidenceWeight(bucket.trades).toFixed(4)),
        qualified: bucket.trades >= MIN_CONTEXT_TRADES && bucket.expectancyR > 0,
      });
    }

    const sessionBest = bestContext(Object.entries(stat.sessions));
    const regimeBest = bestContext(Object.entries(stat.regimes));
    const contextValues = [
      sessionBest ? contextScore(stat.sessions[sessionBest]) : 0,
      regimeBest ? contextScore(stat.regimes[regimeBest]) : 0,
    ];
    const conditionalBonus = Math.max(...contextValues, 0);
    const globalEvidence = finite(stat.expectancyR) * evidenceWeight(stat.trades);
    const researchWeight = Math.max(
      -3,
      Math.min(3, Number((globalEvidence * 0.7 + conditionalBonus * 0.3).toFixed(4))),
    );

    strategyWeights.push({
      strategyId: stat.strategyId,
      strategyName: stat.strategyName,
      globalExpectancyR: finite(stat.expectancyR),
      globalWinRate: finite(stat.winRate),
      sampleSize: stat.trades,
      sessionBest,
      regimeBest,
      researchWeight,
      qualification: qualification(stat),
    });
  }

  const sessionLeaders: Record<string, string | null> = {};
  const regimeLeaders: Record<string, string | null> = {};
  const contexts = [...new Set(cells.map((cell) => cell.context))];

  for (const context of contexts) {
    const session = cells
      .filter((cell) => cell.dimension === "SESSION" && cell.context === context && cell.trades >= MIN_CONTEXT_TRADES)
      .sort((a, b) => (b.expectancyR * b.evidenceWeight) - (a.expectancyR * a.evidenceWeight))[0];
    if (session) sessionLeaders[context] = session.strategyId;

    const regime = cells
      .filter((cell) => cell.dimension === "REGIME" && cell.context === context && cell.trades >= MIN_CONTEXT_TRADES)
      .sort((a, b) => (b.expectancyR * b.evidenceWeight) - (a.expectancyR * a.evidenceWeight))[0];
    if (regime) regimeLeaders[context] = regime.strategyId;
  }

  const canonical = JSON.stringify({
    cells: cells.map((cell) => ({
      strategyId: cell.strategyId,
      dimension: cell.dimension,
      context: cell.context,
      trades: cell.trades,
      winRate: cell.winRate,
      expectancyR: cell.expectancyR,
      evidenceWeight: cell.evidenceWeight,
    })),
    strategyWeights,
    sessionLeaders,
    regimeLeaders,
  });

  return {
    cells,
    strategyWeights: strategyWeights.sort((a, b) => b.researchWeight - a.researchWeight),
    sessionLeaders,
    regimeLeaders,
    methodology: [
      "Weights are derived only from validated historical statistics.",
      "Context evidence is shrunk by sample size to reduce small-sample overreaction.",
      "Session and regime evidence are descriptive research signals, not execution permissions.",
      "A strategy is never considered proven from win rate alone; expectancy and sample size remain required.",
      "The evidence hash identifies the exact matrix payload used by downstream research consumers.",
    ],
    evidenceHash: createHash("sha256").update(canonical).digest("hex"),
    generatedAt: Date.now(),
  };
}
