import type { StrategyCandidate, StrategyConsensus } from "./strategyEngine";

export type AutonomousDecisionStatus = "TRADE" | "WATCH" | "BLOCK";

export interface AutonomousDecision {
  status: AutonomousDecisionStatus;
  direction: "LONG" | "SHORT" | "NONE";
  score: number;
  confidence: number;
  uncertainty: number;
  evidenceCount: number;
  alignedStrategies: number;
  conflictGap: number;
  reason: string;
  blockers: string[];
}

export interface AutonomousDecisionInput {
  candidates: StrategyCandidate[];
  consensus?: Pick<StrategyConsensus, "direction" | "score" | "confidence" | "alignedStrategies">;
  minScore?: number;
  minConfidence?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function viable(candidates: StrategyCandidate[]): StrategyCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.direction !== "NONE" &&
      candidate.blockers.length === 0 &&
      Number.isFinite(candidate.score) &&
      Number.isFinite(candidate.confidence),
  );
}

export function evaluateAutonomousDecision(input: AutonomousDecisionInput): AutonomousDecision {
  const minScore = input.minScore ?? 60;
  const minConfidence = input.minConfidence ?? 65;
  const candidates = viable(input.candidates);

  if (!candidates.length) {
    return {
      status: "BLOCK",
      direction: "NONE",
      score: 0,
      confidence: 0,
      uncertainty: 1,
      evidenceCount: 0,
      alignedStrategies: 0,
      conflictGap: 0,
      reason: "No unblocked directional evidence is available.",
      blockers: ["No viable strategy candidate."],
    };
  }

  const long = candidates.filter((candidate) => candidate.direction === "LONG");
  const short = candidates.filter((candidate) => candidate.direction === "SHORT");
  const bestLong = Math.max(0, ...long.map((candidate) => candidate.score));
  const bestShort = Math.max(0, ...short.map((candidate) => candidate.score));
  const conflictGap = Math.abs(bestLong - bestShort);
  const hasConflict = long.length > 0 && short.length > 0;
  const direction = bestLong > bestShort ? "LONG" : bestShort > bestLong ? "SHORT" : "NONE";
  const aligned = direction === "LONG" ? long : direction === "SHORT" ? short : [];
  const score = Math.round(
    aligned.length
      ? aligned.reduce((sum, candidate) => sum + candidate.score, 0) / aligned.length
      : 0,
  );
  const confidence = Math.round(
    aligned.length
      ? aligned.reduce((sum, candidate) => sum + candidate.confidence, 0) / aligned.length
      : 0,
  );

  const familyCount = new Set(aligned.map((candidate) => candidate.family)).size;
  const evidenceCount = new Set(aligned.flatMap((candidate) => candidate.matchedConcepts)).size;
  const disagreementPenalty = hasConflict
    ? Math.min(0.35, Math.max(0.08, (12 - conflictGap) / 30))
    : 0;
  const lowBreadthPenalty = familyCount <= 1 ? 0.12 : 0;
  const lowEvidencePenalty = evidenceCount < 2 ? 0.15 : evidenceCount < 3 ? 0.07 : 0;
  const uncertainty = Number(
    clamp(
      1 - confidence / 100 + disagreementPenalty + lowBreadthPenalty + lowEvidencePenalty,
      0,
      1,
    ).toFixed(3),
  );

  if (direction === "NONE") {
    return {
      status: "WATCH",
      direction: "NONE",
      score,
      confidence,
      uncertainty,
      evidenceCount,
      alignedStrategies: 0,
      conflictGap,
      reason: "The combined evidence does not establish a directional edge.",
      blockers: ["No directional consensus."],
    };
  }

  if (hasConflict && conflictGap < 12) {
    return {
      status: "WATCH",
      direction: "NONE",
      score,
      confidence,
      uncertainty,
      evidenceCount,
      alignedStrategies: aligned.length,
      conflictGap,
      reason: "Opposing strategy evidence is too close; abstaining prevents forced selection.",
      blockers: ["Material directional conflict."],
    };
  }

  if (score < minScore || confidence < minConfidence) {
    return {
      status: "WATCH",
      direction: "NONE",
      score,
      confidence,
      uncertainty,
      evidenceCount,
      alignedStrategies: aligned.length,
      conflictGap,
      reason: "Evidence strength or confidence is below the autonomous decision threshold.",
      blockers: [
        ...(score < minScore ? ["Score below " + minScore + "."] : []),
        ...(confidence < minConfidence ? ["Confidence below " + minConfidence + "."] : []),
      ],
    };
  }

  if (uncertainty >= 0.45) {
    return {
      status: "WATCH",
      direction: "NONE",
      score,
      confidence,
      uncertainty,
      evidenceCount,
      alignedStrategies: aligned.length,
      conflictGap,
      reason: "Residual uncertainty is too high for autonomous selection.",
      blockers: ["Uncertainty threshold exceeded."],
    };
  }

  return {
    status: "TRADE",
    direction,
    score,
    confidence,
    uncertainty,
    evidenceCount,
    alignedStrategies: aligned.length,
    conflictGap,
    reason: "Independent evidence is aligned and clears score, confidence, conflict and uncertainty gates.",
    blockers: [],
  };
}
