import { buildStrategyResearchMatrix } from "../lib/trading/researchMatrix";
import * as assert from "./assert";

export function runResearchMatrixTest(): void {
  const result = buildStrategyResearchMatrix([
    {
      strategyId: "s1",
      strategyName: "Test Strategy",
      trades: 80,
      winRate: 62.5,
      expectancyR: 0.42,
      sessions: {
        ASIA: { trades: 20, wins: 13, winRate: 65, expectancyR: 0.5 },
        LONDON: { trades: 30, wins: 18, winRate: 60, expectancyR: 0.4 },
      },
      regimes: {
        TRENDING_UP: { trades: 40, wins: 28, winRate: 70, expectancyR: 0.6 },
        RANGING: { trades: 4, wins: 3, winRate: 75, expectancyR: 0.9 },
      },
    },
  ]);

  assert.equal(result.strategyWeights.length, 1, "one strategy should produce one research weight");
  assert.equal(result.strategyWeights[0].qualification, "QUALIFIED", "positive sufficiently sampled evidence should qualify for research");
  assert.equal(result.strategyWeights[0].sessionBest, "ASIA", "best session should use expectancy with sample weighting");
  assert.equal(result.strategyWeights[0].regimeBest, "TRENDING_UP", "undersampled regime must not win the selection");
  assert.ok(result.cells.length === 4, "all session and regime cells should be preserved");
  assert.ok(result.evidenceHash.length === 64, "evidence hash must be a SHA-256 digest");
  assert.ok(result.strategyWeights[0].researchWeight > 0, "positive evidence should produce positive research weight");
}
