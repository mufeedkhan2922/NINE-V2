import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import type { BacktestTrade } from "../lib/trading/backtest";
import type { Candle } from "../lib/trading/types";

const START = process.env.NINE_WF_START ?? "2026-08-01";
const END = process.env.NINE_WF_END ?? "2026-09-29";
const TRAIN_DAYS = Math.max(7, Number(process.env.NINE_WF_TRAIN_DAYS ?? "14"));
const TEST_DAYS = Math.max(3, Number(process.env.NINE_WF_TEST_DAYS ?? "7"));
const STEP_DAYS = Math.max(1, Number(process.env.NINE_WF_STEP_DAYS ?? "7"));
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

    const testStartMs = testStart.getTime();
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

    const result = runBacktest(oosCandles, INITIAL_BALANCE, 0.5);
    const oosTrades = result.trades.filter(
      (trade) => trade.entryTime >= testStartMs && trade.entryTime < testEndMs,
    );
    const trainSlice = candles.filter(
      (c) => c.time >= trainStart.getTime() && c.time < testStartMs,
    );

    folds.push({
      fold: folds.length + 1,
      trainStart: iso(trainStart),
      trainEnd: iso(testStart),
      testStart: iso(testStart),
      testEnd: iso(testEnd),
      trainCandles: trainSlice.length,
      testCandles: Math.max(0, testEndIndex - testStartIndex),
      oos: stats(oosTrades),
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

  return folds;
}

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing.");
  if (!(INITIAL_BALANCE > 0) || !(FIXED_LOT > 0) || !(CONTRACT_SIZE_OZ > 0)) {
    throw new Error("Invalid walk-forward configuration.");
  }

  const candles = await fetchHistory(START, END);
  const folds = runWalkForward(candles);
  const allOosTrades = folds.flatMap((fold) => {
    const items = Array.isArray(fold.oosTrades) ? fold.oosTrades : [];
    return items as Array<{ pnl: number }>;
  });
  const aggregate = stats(
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
  const profitableFoldRate = folds.length ? Number(((positiveFolds / folds.length) * 100).toFixed(2)) : 0;

  const result = {
    instrument: "XAUUSD",
    timeframe: "5min",
    period: { start: START, end: END },
    configuration: {
      trainDays: TRAIN_DAYS,
      testDays: TEST_DAYS,
      stepDays: STEP_DAYS,
      fixedLot: FIXED_LOT,
      contractSizeOzPerLot: CONTRACT_SIZE_OZ,
      effectiveExposureOz: EXPOSURE_OZ,
      warmupCandles: WARMUP_CANDLES,
    },
    dataPoints: candles.length,
    folds,
    aggregateOos: aggregate,
    profitableFoldRate,
    warnings: [
      "This walk-forward report does not tune parameters on the OOS windows.",
      "Each OOS fold receives only the immediately preceding 60 candles as indicator warmup.",
      "The strategy has no parameter-learning step yet; train windows are retained for auditability and future adaptive calibration.",
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
    `- OOS trades: ${aggregate.trades}`,
    `- OOS win rate: ${aggregate.winRate}%`,
    `- OOS net P&L: $${aggregate.netPnl.toFixed(2)}`,
    `- OOS profit factor: ${aggregate.profitFactor ?? "—"}`,
    `- OOS expectancy/trade: $${aggregate.expectancy.toFixed(2)}`,
    "",
    "## Fold Results",
    "",
    "| Fold | Train | OOS | Trades | WR | P&L | PF |",
    "|---:|:---|:---|---:|---:|---:|---:|",
    ...folds.map((fold) => {
      const oos = fold.oos as Record<string, number | null>;
      return `| ${fold.fold} | ${fold.trainStart} → ${fold.trainEnd} | ${fold.testStart} → ${fold.testEnd} | ${oos.trades ?? 0} | ${oos.winRate ?? 0}% | ${Number(oos.netPnl ?? 0).toFixed(2)} | ${oos.profitFactor ?? "—"} |`;
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
