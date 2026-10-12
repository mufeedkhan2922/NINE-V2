import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import { buildAdaptiveLossFilter } from "../lib/trading/adaptiveLossFilter";
import type { BacktestTrade } from "../lib/trading/backtest";
import type { Candle } from "../lib/trading/types";
import { auditResearchIntegrity, auditMultipleTesting, auditParameterFreeOosEvaluation, auditWalkForwardFolds, bootstrapMeanInterval, buildReproducibilityHash, fingerprintCandles, type EmbargoedWalkForwardFoldWindow, type ResearchProvenance } from "../lib/trading/statisticalValidation";

const START = process.env.NINE_WF_START ?? "2026-08-01";
const END = process.env.NINE_WF_END ?? "2026-09-29";
const TRAIN_DAYS = Math.max(7, Number(process.env.NINE_WF_TRAIN_DAYS ?? "14"));
const TEST_DAYS = Math.max(3, Number(process.env.NINE_WF_TEST_DAYS ?? "7"));
const EMBARGO_DAYS = Math.max(1, Number(process.env.NINE_WF_EMBARGO_DAYS ?? "1"));
const STEP_DAYS = Math.max(TEST_DAYS + EMBARGO_DAYS, Number(process.env.NINE_WF_STEP_DAYS ?? String(TEST_DAYS + EMBARGO_DAYS)));
const EMBARGO_MS = EMBARGO_DAYS * 24 * 60 * 60 * 1000;
const INITIAL_BALANCE = Number(process.env.NINE_BACKTEST_INITIAL_BALANCE ?? "10000");
const FIXED_LOT = Number(process.env.NINE_BACKTEST_LOTS ?? "0.01");
const CONTRACT_SIZE_OZ = Number(process.env.NINE_XAUUSD_CONTRACT_SIZE_OZ ?? "100");
const EXPOSURE_OZ = FIXED_LOT * CONTRACT_SIZE_OZ;
const SPREAD_USD_PER_OZ = Number(process.env.NINE_WF_SPREAD_USD_PER_OZ ?? "0");
const SLIPPAGE_USD_PER_SIDE_PER_OZ = Number(process.env.NINE_WF_SLIPPAGE_USD_PER_SIDE_PER_OZ ?? "0");
const COMMISSION_USD_PER_LOT_ROUND_TURN = Number(process.env.NINE_WF_COMMISSION_USD_PER_LOT_ROUND_TURN ?? "0");
const COSTS_CONFIGURED = SPREAD_USD_PER_OZ > 0 || SLIPPAGE_USD_PER_SIDE_PER_OZ > 0 || COMMISSION_USD_PER_LOT_ROUND_TURN > 0;
const WARMUP_CANDLES = 60;
const CHUNK_DAYS = Math.max(5, Math.min(Number(process.env.NINE_BACKTEST_CHUNK_DAYS ?? "10"), 14));

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function pnlForTrade(trade: BacktestTrade): number {
  const move = trade.side === "LONG"
    ? trade.exitPrice - trade.entryPrice
    : trade.entryPrice - trade.exitPrice;
  return move * EXPOSURE_OZ;
}

function estimatedRoundTurnCost(): number {
  return (SPREAD_USD_PER_OZ + 2 * SLIPPAGE_USD_PER_SIDE_PER_OZ) * EXPOSURE_OZ +
    COMMISSION_USD_PER_LOT_ROUND_TURN * FIXED_LOT;
}

function netPnlForTrade(trade: BacktestTrade): number {
  return pnlForTrade(trade) - estimatedRoundTurnCost();
}

function stats(trades: BacktestTrade[], pnlAlreadyNet = false) {
  const pnls = trades.map((trade) => pnlAlreadyNet ? trade.pnl : netPnlForTrade(trade));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0);
  const grossWin = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const net = pnls.reduce((s, p) => s + p, 0);
  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? Number(((wins.length / trades.length) * 100).toFixed(2)) : 0,
    netPnl: Number(net.toFixed(2)),
    profitFactor: grossLoss ? Number((grossWin / grossLoss).toFixed(2)) : wins.length ? null : 0,
    expectancy: trades.length ? Number((net / trades.length).toFixed(2)) : 0,
  };
}

async function fetchHistory(startDate: string, endDate: string): Promise<Candle[]> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const byTime = new Map<number, Candle>();
  let duplicateTimestamps = 0;
  let cursor = start;

  while (cursor < end) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS);
    const boundedEnd = chunkEnd < end ? chunkEnd : end;
    const candles = await fetchProviderHistoricalCandles(
      "XAUUSD",
      "5min",
      iso(cursor),
      iso(boundedEnd),
    );
    for (const candle of candles) {
      if (byTime.has(candle.time)) duplicateTimestamps += 1;
      byTime.set(candle.time, candle);
    }
    cursor = boundedEnd;
  }

  const sorted = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (sorted.length === 0) {
    throw new Error("Historical data quality gate failed: provider returned zero XAUUSD candles.");
  }

  // Reject malformed candles before they enter training or OOS evaluation.
  // Gaps are reported rather than automatically rejected because FX/metal feeds
  // legitimately omit weekends, holidays, and provider maintenance windows.
  for (let index = 0; index < sorted.length; index += 1) {
    const candle = sorted[index]!;
    const values = [candle.time, candle.open, candle.high, candle.low, candle.close];
    if (!values.every(Number.isFinite)) {
      throw new Error(`Historical data quality gate failed: non-finite OHLC/time at candle index ${index}.`);
    }
    if (index > 0 && candle.time <= sorted[index - 1]!.time) {
      throw new Error(`Historical data quality gate failed: non-chronological candles at index ${index}.`);
    }
    if (candle.high < Math.max(candle.open, candle.close, candle.low) ||
        candle.low > Math.min(candle.open, candle.close, candle.high) ||
        candle.high < candle.low) {
      throw new Error(`Historical data quality gate failed: inconsistent OHLC at candle index ${index}.`);
    }
  }

  const expectedFiveMinuteMs = 5 * 60 * 1000;
  const gaps = sorted.slice(1).filter((candle, index) =>
    candle.time - sorted[index]!.time > expectedFiveMinuteMs,
  ).length;
  console.log(JSON.stringify({
    dataQuality: {
      status: "VALID",
      candles: sorted.length,
      duplicateTimestampsDeduplicated: duplicateTimestamps,
      gapsOverFiveMinutes: gaps,
      firstCandle: new Date(sorted[0]!.time).toISOString(),
      lastCandle: new Date(sorted.at(-1)!.time).toISOString(),
    },
  }));

  return sorted;
}

function runWalkForward(candles: Candle[]) {
  const first = new Date(`${START}T00:00:00Z`);
  const end = new Date(`${END}T00:00:00Z`);
  const folds: Array<Record<string, unknown>> = [];
  let cursor = first;

  while (addDays(cursor, TRAIN_DAYS + TEST_DAYS) <= end) {
    const trainStart = new Date(cursor);
    const testStart = addDays(cursor, TRAIN_DAYS);
    const testEnd = addDays(testStart, TEST_DAYS);

    const testStartMs = testStart.getTime();
    const purgedTrainEndMs = testStartMs - EMBARGO_MS;
    const testEndMs = testEnd.getTime();
    const testStartIndex = candles.findIndex((c) => c.time >= testStartMs);
    const testEndIndex = candles.findIndex((c) => c.time >= testEndMs);
    const purgedTrainEndIndex = candles.findIndex((c) => c.time >= purgedTrainEndMs);
    if (testStartIndex < WARMUP_CANDLES || purgedTrainEndIndex <= 0 || testEndIndex <= testStartIndex) break;

    // Purge the embargo interval from both training and OOS warmup context.
    // This prevents candles inside the embargo gap from influencing either side.
    const oosWarmupStartIndex = Math.max(0, purgedTrainEndIndex - WARMUP_CANDLES);
    const oosCandles = candles.slice(oosWarmupStartIndex, testEndIndex);

    const trainStartIndex = Math.max(0, purgedTrainEndIndex - Math.ceil(TRAIN_DAYS * 24 * 12));
    const trainCandles = candles.slice(trainStartIndex, purgedTrainEndIndex);
    const trainResult = runBacktest(trainCandles, INITIAL_BALANCE, 0.5, undefined, false);
    const costAdjustedTrainingTrades = trainResult.trades.map((trade) => ({
      ...trade,
      pnl: netPnlForTrade(trade),
      outcome: netPnlForTrade(trade) > 0 ? "WIN" as const : "LOSS" as const,
    }));
    const adaptiveFilter = buildAdaptiveLossFilter(costAdjustedTrainingTrades, {
      minimumTrades: 20,
      confidenceZ: 1.96,
      requireNegativeExpectancy: true,
    });

    const validationWindow = {
      trainEndTime: testStartMs - 1,
      oosStartTime: testStartMs,
      oosEndTime: testEndMs - 1,
    };
    const baselineResult = runBacktest(
      oosCandles,
      INITIAL_BALANCE,
      0.5,
      undefined,
      false,
      { validationMode: "OOS_ISOLATED", validationWindow },
    );
    const adaptiveResult = runBacktest(
      oosCandles,
      INITIAL_BALANCE,
      0.5,
      adaptiveFilter,
      false,
      { validationMode: "OOS_ISOLATED", validationWindow },
    );
    const baselineTrades = baselineResult.trades.filter(
      (trade) => trade.entryTime >= testStartMs && trade.entryTime < testEndMs,
    );
    const oosTrades = adaptiveResult.trades.filter(
      (trade) => trade.entryTime >= testStartMs && trade.entryTime < testEndMs,
    );

    folds.push({
      fold: folds.length + 1,
      trainStart: iso(trainStart),
      trainEnd: iso(new Date(purgedTrainEndMs)),
      testStart: iso(testStart),
      testEnd: iso(testEnd),
      trainCandles: trainCandles.length,
      trainTrades: trainResult.trades.length,
      trainStartTime: trainCandles[0]?.time ?? 0,
      trainEndTime: trainCandles.at(-1)?.time ?? 0,
      oosStartTime: testStartMs,
      oosEndTime: testEndMs - 1,
      testCandles: Math.max(0, testEndIndex - testStartIndex),
      provenance: {
        trainStartTime: trainCandles[0]?.time ?? 0,
        trainEndTime: trainCandles.at(-1)?.time ?? 0,
        trainCandleCount: trainCandles.length,
        trainDataFingerprint: fingerprintCandles(trainCandles),
        oosStartTime: testStartMs,
        oosEndTime: testEndMs - 1,
        oosCandleCount: Math.max(0, testEndIndex - testStartIndex),
        oosDataFingerprint: fingerprintCandles(candles.slice(testStartIndex, testEndIndex)),
        learningState: "TRAIN_ONLY",
      },
      baselineOos: stats(baselineTrades),
      oos: stats(oosTrades),
      adaptiveBlockedSetupFamilies: adaptiveFilter.blockedKeys,
      adaptiveGroups: adaptiveFilter.groups,
      baselineTrades: baselineTrades.map((trade) => ({
        id: trade.id,
        side: trade.side,
        entryTime: new Date(trade.entryTime).toISOString(),
        exitTime: new Date(trade.exitTime).toISOString(),
        grossPnl: Number(pnlForTrade(trade).toFixed(2)),
        estimatedRoundTurnCost: Number(estimatedRoundTurnCost().toFixed(2)),
        pnl: Number(netPnlForTrade(trade).toFixed(2)),
        entryReason: trade.entryReason,
        exitReason: trade.exitReason,
      })),
      oosTrades: oosTrades.map((trade) => ({
        id: trade.id,
        side: trade.side,
        entryTime: new Date(trade.entryTime).toISOString(),
        exitTime: new Date(trade.exitTime).toISOString(),
        entryPrice: trade.entryPrice,
        exitPrice: trade.exitPrice,
        grossPnl: Number(pnlForTrade(trade).toFixed(2)),
        estimatedRoundTurnCost: Number(estimatedRoundTurnCost().toFixed(2)),
        pnl: Number(netPnlForTrade(trade).toFixed(2)),
        entryReason: trade.entryReason,
        exitReason: trade.exitReason,
      })),
    });

    cursor = addDays(cursor, STEP_DAYS);
  }

  const foldWindows: EmbargoedWalkForwardFoldWindow[] = folds.map((fold) => ({
    trainStartTime: Number(fold.trainStartTime),
    trainEndTime: Number(fold.trainEndTime),
    oosStartTime: Number(fold.oosStartTime),
    oosEndTime: Number(fold.oosEndTime),
    embargoMs: EMBARGO_MS,
  }));
  const audit = auditWalkForwardFolds(foldWindows);
  if (!audit.valid) {
    throw new Error("Walk-forward contamination audit failed: " + audit.reason);
  }

  return { folds, foldWindows };
}

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing.");
  if (!(INITIAL_BALANCE > 0) || !(FIXED_LOT > 0) || !(CONTRACT_SIZE_OZ > 0) ||
      ![SPREAD_USD_PER_OZ, SLIPPAGE_USD_PER_SIDE_PER_OZ, COMMISSION_USD_PER_LOT_ROUND_TURN].every(Number.isFinite) ||
      SPREAD_USD_PER_OZ < 0 || SLIPPAGE_USD_PER_SIDE_PER_OZ < 0 || COMMISSION_USD_PER_LOT_ROUND_TURN < 0) {
    throw new Error("Invalid walk-forward configuration: balance/lot/contract size must be positive and cost inputs must be finite and non-negative.");
  }

  if (!Number.isFinite(new Date(`${START}T00:00:00Z`).getTime()) ||
      !Number.isFinite(new Date(`${END}T00:00:00Z`).getTime()) ||
      new Date(`${START}T00:00:00Z`).getTime() >= new Date(`${END}T00:00:00Z`).getTime()) {
    throw new Error("Invalid walk-forward date range: START must be a valid date before END.");
  }

  const candles = await fetchHistory(START, END);
  if (candles.length < WARMUP_CANDLES + 2) {
    throw new Error(`Historical data quality gate failed: only ${candles.length} candles available; need more than ${WARMUP_CANDLES + 1}.`);
  }
  const { folds, foldWindows } = runWalkForward(candles);
  if (folds.length === 0) {
    throw new Error("Research gate failed: no valid walk-forward folds were produced. Expand the date range or reduce the fold window.");
  }
  const allBaselineTrades = folds.flatMap((fold) => {
    const items = Array.isArray(fold.baselineTrades) ? fold.baselineTrades : [];
    return items as Array<{ pnl: number }>;
  });
  const allOosTrades = folds.flatMap((fold) => {
    const items = Array.isArray(fold.oosTrades) ? fold.oosTrades : [];
    return items as Array<{ pnl: number }>;
  });
  const aggregateBaseline = stats(
    allBaselineTrades.map((trade, index) => ({
      id: `WF-${index}`,
      index,
      side: "LONG",
      entryTime: 0,
      exitTime: 0,
      entryPrice: 0,
      exitPrice: trade.pnl / EXPOSURE_OZ,
      stopLoss: 0,
      takeProfit: 0,
      quantity: EXPOSURE_OZ,
      pnl: trade.pnl,
      outcome: trade.pnl > 0 ? "WIN" : "LOSS",
      reason: "END",
      entryReason: "",
      exitReason: "",
    } as BacktestTrade)),
    true,
  );


  const aggregateAdaptive = stats(
    allOosTrades.map((trade, index) => ({
      id: `WF-${index}`,
      index,
      side: "LONG",
      entryTime: 0,
      exitTime: 0,
      entryPrice: 0,
      exitPrice: trade.pnl / EXPOSURE_OZ,
      stopLoss: 0,
      takeProfit: 0,
      quantity: EXPOSURE_OZ,
      pnl: trade.pnl,
      outcome: trade.pnl > 0 ? "WIN" : "LOSS",
      reason: "END",
      entryReason: "",
      exitReason: "",
    } as BacktestTrade)),
    true,
  );

  const positiveFolds = folds.filter((fold) => Number((fold.oos as Record<string, unknown>).netPnl ?? 0) > 0).length;
  const baselinePositiveFolds = folds.filter((fold) => Number((fold.baselineOos as Record<string, unknown>).netPnl ?? 0) > 0).length;
  const profitableFoldRate = folds.length ? Number(((positiveFolds / folds.length) * 100).toFixed(2)) : 0;
  const dataFingerprint = fingerprintCandles(candles);
  const codeVersion = process.env.GITHUB_SHA ?? "local";
  const rulesetVersion = "NINE-0.5.44";
  const parameterAudit = auditParameterFreeOosEvaluation({ oosTuned: false, tunedOnOos: false, selectedByOos: false, optimizeOos: false, oosOptimization: false, trainDays: TRAIN_DAYS, testDays: TEST_DAYS, embargoDays: EMBARGO_DAYS });
  const multipleTesting = auditMultipleTesting(Math.max(1, folds.length));
  const oosPnl = allOosTrades.map((trade) => Number(trade.pnl));
  const pnlBootstrap = bootstrapMeanInterval(oosPnl, Number.parseInt(dataFingerprint, 16) || 1);
  const provenance: ResearchProvenance = {
    symbol: "XAUUSD", timeframe: "5min", dataStartTime: candles[0]?.time ?? 0, dataEndTime: candles.at(-1)?.time ?? 0,
    dataFingerprint, trainStartTime: foldWindows[0]?.trainStartTime ?? 0, trainEndTime: foldWindows.at(-1)?.trainEndTime ?? 0,
    oosStartTime: foldWindows[0]?.oosStartTime ?? 0, oosEndTime: foldWindows.at(-1)?.oosEndTime ?? 0,
    candleCount: candles.length,
    trainCandleCount: folds.reduce((sum, fold) => sum + Number(fold.trainCandles ?? 0), 0),
    oosCandleCount: folds.reduce((sum, fold) => sum + Number(fold.testCandles ?? 0), 0),
    rulesetVersion, codeVersion, learningState: "TRAIN_ONLY",
  };
  const reproducibilityHash = buildReproducibilityHash(provenance, { trainDays: TRAIN_DAYS, testDays: TEST_DAYS, stepDays: STEP_DAYS, embargoDays: EMBARGO_DAYS, warmupCandles: WARMUP_CANDLES, fixedLot: FIXED_LOT, contractSizeOz: CONTRACT_SIZE_OZ });
  const integrity = auditResearchIntegrity(foldWindows, parameterAudit, multipleTesting, reproducibilityHash);
  if (!integrity.valid) throw new Error("Final research integrity gate failed: " + integrity.reasons.join(" | "));

  const result = {
    instrument: "XAUUSD",
    timeframe: "5min",
    period: { start: START, end: END },
    configuration: {
      trainDays: TRAIN_DAYS,
      testDays: TEST_DAYS,
      stepDays: STEP_DAYS,
      embargoDays: EMBARGO_DAYS,
      fixedLot: FIXED_LOT,
      contractSizeOzPerLot: CONTRACT_SIZE_OZ,
      effectiveExposureOz: EXPOSURE_OZ,
      estimatedExecutionCosts: {
        spreadUsdPerOz: SPREAD_USD_PER_OZ,
        slippageUsdPerSidePerOz: SLIPPAGE_USD_PER_SIDE_PER_OZ,
        commissionUsdPerLotRoundTurn: COMMISSION_USD_PER_LOT_ROUND_TURN,
        estimatedRoundTurnCostUsd: Number(estimatedRoundTurnCost().toFixed(4)),
        configured: COSTS_CONFIGURED,
      },
      warmupCandles: WARMUP_CANDLES,
    },
    dataPoints: candles.length,
    provenance,
    reproducibilityHash,
    parameterAudit,
    multipleTesting,
    statisticalSignificance: { metric: "mean_OOS_PnL_per_trade", bootstrap: pnlBootstrap },
    validationAudit: {
      status: "VALIDATED",
      method: "chronological_purged_embargoed_oos_folds",
      folds: folds.length,
    },
    folds,
    aggregateBaselineOos: aggregateBaseline,
    aggregateAdaptiveOos: aggregateAdaptive,
    profitableFoldRate,
    baselineProfitableFoldRate: folds.length ? Number(((baselinePositiveFolds / folds.length) * 100).toFixed(2)) : 0,
    warnings: [
      "This walk-forward report does not tune parameters on the OOS windows.",
      "Each OOS fold receives only the immediately preceding 60 candles as indicator warmup.",
      "Adaptive loss filtering is trained only on each fold's prior training window and applied to the later OOS window.",
      "Each baseline and adaptive OOS evaluation runs in OOS_ISOLATED mode, which disables persistent learning and enforces the OOS entry/exit boundary.",
      "Training data is purged before each OOS window and sequential folds are separated by an embargo.",
      "The final research integrity gate must pass before this result is considered promotable.",
      "A setup is blocked only when its historical sample is large enough and its 95% Wilson upper win-rate bound remains below its break-even win rate with negative expectancy.",
      "Insufficient samples remain neutral; NINE does not delete setups merely because of a small losing sample.",
      COSTS_CONFIGURED
        ? "Net P&L deducts configured spread, two-sided slippage, and round-turn commission values; any cost input left at zero is assumed zero, and financing/swap is not modeled."
        : "WARNING: execution-cost inputs are all zero. P&L is gross of spread, commission, slippage, and financing and must not be interpreted as executable net performance.",
      "Historical simulation is not predictive of future performance.",
      "Data-quality gate rejects malformed/non-chronological OHLC candles and fails closed on empty or insufficient history; five-minute gaps are counted because session/holiday gaps may be legitimate.",
    ],
  };

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-walkforward.json", JSON.stringify(result, null, 2));

  const lines = [
    "# NINE XAUUSD Walk-Forward Validation",
    "",
    `Period: ${START} to ${END}`,
    `5m candles: ${candles.length}`,
    `Train: ${TRAIN_DAYS} days | OOS test: ${TEST_DAYS} days | Step: ${STEP_DAYS} days`,
    `Execution costs per round turn: ${estimatedRoundTurnCost().toFixed(2)} USD at ${FIXED_LOT} lots`,
    COSTS_CONFIGURED ? "P&L is net of configured execution costs; swap/financing is excluded." : "WARNING: all execution costs are zero; results are gross and not executable net performance.",
    "",
    "## Aggregate OOS",
    "",
    `- Folds: ${folds.length}`,
    `- Profitable folds: ${positiveFolds}/${folds.length} (${profitableFoldRate}%)`,
    `- Baseline OOS trades: ${aggregateBaseline.trades}`,
    `- Baseline OOS win rate: ${aggregateBaseline.winRate}%`,
    `- Baseline OOS net P&L: ${aggregateBaseline.netPnl.toFixed(2)}`,
    `- Baseline OOS profit factor: ${aggregateBaseline.profitFactor ?? "—"}`,
    `- Adaptive OOS trades: ${aggregateAdaptive.trades}`,
    `- Adaptive OOS win rate: ${aggregateAdaptive.winRate}%`,
    `- Adaptive OOS net P&L: ${aggregateAdaptive.netPnl.toFixed(2)}`,
    `- Adaptive OOS profit factor: ${aggregateAdaptive.profitFactor ?? "—"}`,
    `- Adaptive OOS expectancy/trade: ${aggregateAdaptive.expectancy.toFixed(2)}`,
    "",
    "## Fold Results",
    "",
    "| Fold | Train | OOS | Baseline P&L | Adaptive P&L | Baseline PF | Adaptive PF |",
    "|---:|:---|:---|---:|---:|---:|---:|",
    ...folds.map((fold) => {
      const oos = fold.oos as Record<string, number | null>;
      const baseline = fold.baselineOos as Record<string, number | null>;
      return `| ${fold.fold} | ${fold.trainStart} → ${fold.trainEnd} | ${fold.testStart} → ${fold.testEnd} | ${Number(baseline.netPnl ?? 0).toFixed(2)} | ${Number(oos.netPnl ?? 0).toFixed(2)} | ${baseline.profitFactor ?? "—"} | ${oos.profitFactor ?? "—"} |`;
    }),
    "",
    "## Methodology Warnings",
    "",
    ...result.warnings.map((warning) => `- ${warning}`),
  ];

  fs.writeFileSync("artifacts/xauusd-walkforward.md", lines.join("\n"));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
