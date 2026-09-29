import { db } from "./db";
import type { StrategyFamily } from "./strategyLibrary";

export interface MetaEvidence {
  concept: string;
  weight: number;
  observations: number;
  wins: number;
  losses: number;
  winRateLower95: number;
}

export interface MetaLearningAdjustment {
  adjustment: number;
  uncertainty: number;
  abstain: boolean;
  evidence: MetaEvidence[];
  reason: string;
}

function wilsonLower95(wins: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = wins / n;
  const d = 1 + z * z / n;
  return ((p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / d) * 100;
}

export function deduplicateEvidence(concepts: string[]): string[] {
  const groups: Record<string, string> = {
    trend: "direction",
    "ema-cross": "direction",
    bos: "structure",
    choch: "structure",
    "market-structure": "structure",
    "liquidity-sweep": "liquidity",
    fvg: "location",
    "order-block": "location",
    "premium-discount": "location",
    "momentum-expansion": "momentum",
    atr: "volatility",
    "range-breakout": "breakout",
    "breakout-retest": "breakout",
    "session-filter": "session",
    "mean-reversion": "mean-reversion",
    "rsi-regime": "mean-reversion",
  };
  const seen = new Set<string>();
  return concepts.filter((concept) => {
    const group = groups[concept] ?? concept;
    if (seen.has(group)) return false;
    seen.add(group);
    return true;
  });
}

export function calculateMetaAdjustment(
  evidence: Array<{ concept: string; observations: number; wins: number; losses: number }>,
): MetaLearningAdjustment {
  if (!evidence.length) {
    return { adjustment: 0, uncertainty: 1, abstain: true, evidence: [], reason: "No independent evidence available." };
  }

  const normalized = evidence.map((item) => {
    const n = Math.max(0, item.observations);
    const wins = Math.max(0, Math.min(n, item.wins));
    const lower = wilsonLower95(wins, n);
    const sample = Math.min(1, n / 100);
    const raw = ((lower - 50) / 10) * sample;
    return { concept: item.concept, weight: Math.max(-3, Math.min(3, raw)), observations: n, wins, losses: Math.max(0, item.losses), winRateLower95: Number(lower.toFixed(2)) };
  });

  const total = normalized.reduce((s, x) => s + x.weight, 0);
  const uncertainty = Math.max(0, Math.min(1, 1 - normalized.reduce((s, x) => s + Math.min(1, x.observations / 100), 0) / Math.max(1, normalized.length)));
  return {
    adjustment: Number(Math.max(-6, Math.min(6, total / Math.max(1, normalized.length))).toFixed(2)),
    uncertainty: Number(uncertainty.toFixed(3)),
    abstain: uncertainty >= 0.8 || normalized.every((x) => x.weight <= 0),
    evidence: normalized,
    reason: uncertainty >= 0.8 ? "Evidence sample is too weak for confident arbitration." : "Meta-learning adjusted independent evidence conservatively.",
  };
}

export function arbitrateStrategies(
  candidates: Array<{ strategyId: string; family: StrategyFamily; direction: "LONG" | "SHORT" | "NONE"; score: number; confidence: number; blockers: string[] }>,
): { direction: "LONG" | "SHORT" | "NONE"; score: number; confidence: number; abstain: boolean; reason: string } {
  const viable = candidates.filter((c) => c.direction !== "NONE" && c.blockers.length === 0);
  if (!viable.length) return { direction: "NONE", score: 0, confidence: 0, abstain: true, reason: "No unblocked directional candidates." };
  const long = viable.filter((c) => c.direction === "LONG");
  const short = viable.filter((c) => c.direction === "SHORT");
  const bestLong = Math.max(0, ...long.map((c) => c.score));
  const bestShort = Math.max(0, ...short.map((c) => c.score));
  if (long.length && short.length && Math.abs(bestLong - bestShort) < 8) {
    return { direction: "NONE", score: Math.max(bestLong, bestShort), confidence: 0, abstain: true, reason: "Directional evidence is materially conflicted." };
  }
  const side = bestLong > bestShort ? "LONG" : bestShort > bestLong ? "SHORT" : "NONE";
  const aligned = viable.filter((c) => c.direction === side);
  const confidence = Math.min(99, Math.round(aligned.reduce((s, c) => s + c.confidence, 0) / Math.max(1, aligned.length)));
  return { direction: side, score: Math.max(bestLong, bestShort), confidence, abstain: confidence < 55, reason: confidence < 55 ? "Arbitrated confidence is below execution threshold." : "Strategies arbitrated with directional agreement." };
}

export function metaFamilyKey(family: StrategyFamily, direction: string): string {
  return family + ":" + direction;
}

export function metaWilsonLower(wins: number, observations: number): number {
  return wilsonLower95(wins, observations);
}
