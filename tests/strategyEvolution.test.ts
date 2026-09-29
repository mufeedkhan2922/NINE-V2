import { buildRollingEvolutionEvaluations, buildEvolutionSnapshot, generateStrategyMutations } from "../lib/trading/strategyEvolution";
import * as assert from "./assert";

export function runStrategyEvolutionTest(): void {
  const candles = Array.from({ length: 360 }, (_, i) => {
    const base = 2500 + Math.sin(i / 11) * 8 + i * 0.02;
    return {
      time: i * 300000,
      open: base,
      high: base + 2 + (i % 5) * 0.1,
      low: base - 2 - (i % 3) * 0.1,
      close: base + (i % 2 ? 0.8 : -0.5),
    };
  });
  const mutations = generateStrategyMutations();
  assert.equal(mutations.length, 12 * 5, "every base strategy should receive five mutation hypotheses");

  const windows = buildRollingEvolutionEvaluations(candles);
  assert.ok(windows.length > 0, "rolling walk-forward evaluation should produce windows");

  const snapshot = buildEvolutionSnapshot("XAUUSD", candles, windows, mutations);
  assert.equal(snapshot.records.length, mutations.length, "every mutation must receive an arena record");
  assert.ok(snapshot.records.every((record) => record.robustnessScore >= 0 && record.robustnessScore <= 100), "robustness score must be bounded");
  assert.ok(snapshot.records.every((record) => record.status !== "ACTIVE" || record.trades >= 20), "active promotion requires a meaningful sample");
}
