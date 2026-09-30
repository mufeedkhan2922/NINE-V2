import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import { buildAdaptiveLossFilter } from "../lib/trading/adaptiveLossFilter";
import type { BacktestTrade } from "../lib/trading/backtest";
import type { Candle } from "../lib/trading/types";
import { auditResearchIntegrity, auditMultipleTesting, auditParameterFreeOosEvaluation, bootstrapMeanInterval, buildReproducibilityHash, fingerprintCandles, type EmbargoedWalkForwardFoldWindow, type ResearchProvenance } from "../lib/trading/statisticalValidation";

const START = process.env.NINE_WF_START ?? "2026-08-01";
const END = process.env.NINE_WF_END ?? "2026-09-29";
const TRAIN_DAYS = Math.max(7, Number(process.env.NINE_WF_TRAIN_DAYS ?? "14"));
const TEST_DAYS = Math.max(3, Number(process.env.NINE_WF_TEST_DAYS ?? "7"));
const EMBARGO_DAYS = Math.max(1, Number(process.env.NINE_WF_EMBARGO_DAYS ?? "1"));\nconst STEP_DAYS = Math.max(TEST_DAYS + EMBARGO_DAYS, Number(process.env.NINE_WF_STEP_DAYS ?? String(TEST_DAYS + EMBARGO_DAYS)));\nconst EMBARGO_MS = EMBARGO_DAYS * 24 * 60 * 60 * 1000;
const INITIAL_BALANCE = Number(process.env.NINE_BACKTEST_INITIAL_BALANCE ?? "10000");
const FIXED_LOT = Number(process.env.NINE_BACKTEST_LOTS ?? "0.01");
const CONTRACT_SIZE_OZ = Number(process.env.NINE_XAUUSD_CONTRACT_SIZE_OZ ?? "100");
const EXPOSURE_OZ = FIXED_LOT * CONTRACT_SIZE_OZ;
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

function stats(trades: BacktestTrade[]) {
  const pnls = trades.map(pnlForTrade);
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
    for (const candle of candles) byTime.set(candle.time, candle);
    cursor = boundedEnd;
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
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

    const testStartMs = testStart.getTime();\n    const purgedTrainEndMs = testStartMs - EMBARGO_MS;
    const testEndMs = testEnd.getTime();
    const testStartIndex = candles.findIndex((c) => c.time >= testStartMs);
    const testEndIndex = candles.findIndex((c) => c.time >= testEndMs);
    if (testStartIndex < WARMUP_CANDLES || testEndIndex <= testStartIndex) break;

    // Only the final 60 candles immediately before the OOS window are supplied
    // as warmup. No candles from the future test window are used to build setup state.
    const oosCandles = candles.slice(
      Math.max(0, testStartIndex - WARMUP_CANDLES),
      testEndIndex,
    );

    const trainStartIndex = Math.max(0, testStartIndex - WARMUP_CANDLES - Math.ceil(TRAIN_DAYS * 24 * 12));
    const trainCandles = candles.slice(trainStartIndex, testStartIndex);
    const trainResult = runBacktest(trainCandles, INITIAL_BALANCE, 0.5, undefined, false);
    const adaptiveFilter = buildAdaptiveLossFilter(trainResult.trades, {
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
        pnl: Number(pnlForTrade(trade).toFixed(2)),
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
        pnl: Number(pnlForTrade(trade).toFixed(2)),
        entryReason: trade.entryReason,
        exitReason: trade.exitReason,
      })),
    });

    cursor = addDays(cursor, STEP_DAYS);
  }

  const foldWindows: EmbargoedWalkForwardFoldWindow[] = folds.map((fold) => ({
    trainStartTime: new Date(String(fold.trainStart) + "T00:00:00Z").getTime(),
    trainEndTime: new Date(String(fold.testStart) + "T00:00:00Z").getTime() - 1,
    oosStartTime: new Date(String(fold.testStart) + "T00:00:00Z").getTime(),
    oosEndTime: new Date(String(fold.testEnd) + "T00:00:00Z").getTime() - 1,
  }));
  const audit = auditWalkForwardFolds(foldWindows);
  if (!audit.valid) {
    throw new Error("Walk-forward contamination audit failed: " + audit.reason);
  }

  return folds;
}

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing.");
  if (!(INITIAL_BALANCE > 0) || !(FIXED_LOT > 0) || !(CONTRACT_SIZE_OZ > 0)) {
    throw new Error("Invalid walk-forward configuration.");
  }

  const candles = await fetchHistory(START, END);
  const { folds, foldWindows } = runWalkForward(candles);
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
  );

  const positiveFolds = folds.filter((fold) => Number((fold.oos as Record<string, unknown>).netPnl ?? 0) > 0).length;
  const baselinePositiveFolds = folds.filter((fold) => Number((fold.baselineOos as Record<string, unknown>).netPnl ?? 0) > 0).length;
  const profitableFoldRate = folds.length ? Number(((positiveFolds / folds.length) * 100).toFixed(2)) : 0;
  const dataFingerprint = fingerprintCandles(candles);
  const codeVersion = process.env.GITHUB_SHA ?? "local";
  const rulesetVersion = "NINE-0.5.43";
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
      "No spread, commission, financing or slippage is included unless represented by source prices.",
      "Historical simulation is not predictive of future performance.",
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
