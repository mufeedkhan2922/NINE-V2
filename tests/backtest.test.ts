import { runBacktest } from "../lib/trading/backtest";
import { Candle } from "../lib/trading/types";
import * as assert from "./assert";
import { auditOosValidationWindow } from "../lib/trading/statisticalValidation";
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

  const oos = runBacktest(data, 10000, 0.5, undefined, true, {
    validationMode: "OOS_ISOLATED",
    validationWindow: {
      trainEndTime: split - 60000,
      oosStartTime: split,
      oosEndTime: data[210]!.time,
    },
  });
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
}

