import { runBacktest } from "../lib/trading/backtest";
import { Candle } from "../lib/trading/types";
import * as assert from "./assert";
import { auditOosValidationWindow, auditWalkForwardFolds, auditMultipleTesting, auditParameterFreeOosEvaluation, bootstrapMeanInterval, buildReproducibilityHash, fingerprintCandles, auditResearchIntegrity } from "../lib/trading/statisticalValidation";
import { db } from "../lib/trading/db";
function candles(count = 220): Candle[] { return Array.from({ length: count }, (_, i) => { const close = 2300 + Math.sin(i / 8) * 5 + i * 0.25; return { time: i * 60000, open: close - 0.1, high: close + 1.1, low: close - 1.1, close }; }); }
export function runBacktestTest() {
  const data = candles();
  const result = runBacktest(data, 10000, 0.5);
  assert.equal(result.initialBalance, 10000, "initial balance"); assert.equal(result.totalTrades, result.wins + result.losses, "trade counts"); assert.ok(Number.isFinite(result.maxDrawdown), "drawdown should be finite"); assert.equal(result.finalBalance, result.initialBalance + result.netPnl, "final balance should reconcile"); assert.ok(result.warnings.length >= 3, "research warnings should be present"); assert.equal(result.config.rewardRisk, "DYNAMIC_BY_STRATEGY", "strategy RR should be dynamic"); assert.equal(result.config.higherTimeframes, "15m+1h", "HTF confirmation should be enabled"); assert.equal(result.config.maxTradesPerSessionDay, 2, "session trade cap");

  const split = data[150]!.time;
  const audit = auditOosValidationWindow(data, {
    trainEndTime: split - 60000,
    oosStartTime: split,
    oosEndTime: data[210]!.time,
  });
  assert.ok(audit.valid, "OOS validation window should be valid");

  const learningTables = [
    "loss_memory",
    "causal_failure_memory",
    "counterfactual_results",
    "counterfactual_learning_memory",
    "rejection_quality_memory",
    "decision_outcome_memory",
    "mistake_patterns",
    "rejection_governance_memory",
  ];
  const beforeCounts = new Map(
    learningTables.map((table) => [
      table,
      Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count),
    ]),
  );

  const oos = runBacktest(data, 10000, 0.5, undefined, true, {
    validationMode: "OOS_ISOLATED",
    validationWindow: {
      trainEndTime: split - 60000,
      oosStartTime: split,
      oosEndTime: data[210]!.time,
    },
  });
  for (const table of learningTables) {
    const after = Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
    assert.equal(after, beforeCounts.get(table), `OOS evaluation must not mutate ${table}`);
  }
  assert.equal(oos.config.validationMode, "OOS_ISOLATED", "OOS isolation mode");
  assert.equal(oos.config.persistentLearningEnabled, false, "OOS mode must disable persistent learning");
  assert.equal(oos.config.closedLoopLearningEnabled, false, "OOS mode must disable closed-loop learning");
  assert.equal(oos.config.validationTrainEndTime, split - 60000, "OOS config must preserve train cutoff");
  assert.equal(oos.config.validationOosStartTime, split, "OOS config must preserve OOS start");
  assert.equal(oos.config.validationOosEndTime, data[210]!.time, "OOS config must preserve OOS end");
  assert.ok(oos.trades.every((trade) => trade.entryTime >= split), "OOS trades must not precede the split");

  const invalidOrder = auditOosValidationWindow(data, { trainEndTime: split, oosStartTime: split - 60000 });
  assert.equal(invalidOrder.valid, false, "OOS audit must reject overlapping train/OOS windows");

  const invalidChronology = auditOosValidationWindow([data[0]!, data[1]!, data[1]!], {
    trainEndTime: data[0]!.time,
    oosStartTime: data[1]!.time,
  });
  assert.equal(invalidChronology.valid, false, "OOS audit must reject non-chronological candles");

  const missingTrain = auditOosValidationWindow(data, {
    trainEndTime: -1,
    oosStartTime: data[10]!.time,
  });
  assert.equal(missingTrain.valid, false, "OOS audit must reject a missing training segment");

  const walkForward = auditWalkForwardFolds([
    {
      trainStartTime: 0,
      trainEndTime: 9,
      oosStartTime: 10,
      oosEndTime: 19,
    },
    {
      trainStartTime: 10,
      trainEndTime: 19,
      oosStartTime: 20,
      oosEndTime: 29,
    },
  ]);
  assert.ok(walkForward.valid, "walk-forward folds should be chronological");

  const overlappingFolds = auditWalkForwardFolds([
    {
      trainStartTime: 0,
      trainEndTime: 9,
      oosStartTime: 10,
      oosEndTime: 20,
    },
    {
      trainStartTime: 10,
      trainEndTime: 19,
      oosStartTime: 19,
      oosEndTime: 30,
    },
  ]);
  assert.equal(overlappingFolds.valid, false, "walk-forward audit must reject overlapping OOS windows");
  const multiple = auditMultipleTesting(4);
  assert.equal(multiple.valid, true, "multiple-testing audit should accept positive hypothesis count");
  assert.equal(multiple.adjustedAlpha, 0.0125, "Bonferroni alpha should be adjusted");

  const parameterFree = auditParameterFreeOosEvaluation({ oosTuned: false, tunedOnOos: false });
  assert.ok(parameterFree.valid, "parameter-free OOS audit should pass");

  const contaminated = auditParameterFreeOosEvaluation({ tunedOnOos: true });
  assert.equal(contaminated.valid, false, "OOS tuning must be rejected");

  const bootstrap = bootstrapMeanInterval([1, 2, 3, 4, 5], 42, 250);
  assert.equal(bootstrap.samples, 5, "bootstrap sample count");
  assert.ok(bootstrap.lower95 <= bootstrap.estimate && bootstrap.estimate <= bootstrap.upper95, "bootstrap interval must contain estimate");

  const fingerprint = fingerprintCandles(data);
  const provenance = {
    symbol: "XAUUSD", timeframe: "5min", dataStartTime: data[0]!.time, dataEndTime: data.at(-1)!.time,
    dataFingerprint: fingerprint, trainStartTime: data[0]!.time, trainEndTime: data[99]!.time,
    oosStartTime: data[100]!.time, oosEndTime: data.at(-1)!.time, candleCount: data.length,
    trainCandleCount: 100, oosCandleCount: 120, rulesetVersion: "test", codeVersion: "test", learningState: "TRAIN_ONLY" as const,
  };
  const hashA = buildReproducibilityHash(provenance, { risk: 0.5, warmup: 60 });
  const hashB = buildReproducibilityHash(provenance, { warmup: 60, risk: 0.5 });
  assert.equal(hashA, hashB, "reproducibility hash must be key-order independent");

  const integrity = auditResearchIntegrity([
    { trainStartTime: 0, trainEndTime: 8, oosStartTime: 10, oosEndTime: 19, embargoMs: 1 },
    { trainStartTime: 21, trainEndTime: 29, oosStartTime: 31, oosEndTime: 40, embargoMs: 1 },
  ], parameterFree, multiple, hashA);
  assert.ok(integrity.valid, "complete research integrity gate should pass");

  const brokenIntegrity = auditResearchIntegrity([
    { trainStartTime: 0, trainEndTime: 9, oosStartTime: 10, oosEndTime: 19, embargoMs: 1 },
    { trainStartTime: 20, trainEndTime: 30, oosStartTime: 31, oosEndTime: 40, embargoMs: 1 },
  ], parameterFree, multiple, hashA);
  assert.equal(brokenIntegrity.valid, false, "research integrity gate must reject an insufficient purge/embargo");
}

