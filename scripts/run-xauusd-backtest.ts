import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import type { BacktestTrade } from "../lib/trading/backtest";

const START = process.env.NINE_BACKTEST_START ?? "2026-08-01";
const END = process.env.NINE_BACKTEST_END ?? "2026-09-29";
const CHUNK_DAYS = Math.max(5, Math.min(Number(process.env.NINE_BACKTEST_CHUNK_DAYS ?? "10"), 14));
const TIMEFRAME = "5min" as const; // NINE XAUUSD research run
const INITIAL_BALANCE = Number(process.env.NINE_BACKTEST_INITIAL_BALANCE ?? "10000");
const FIXED_LOT = Number(process.env.NINE_BACKTEST_LOTS ?? "0.01");
const CONTRACT_SIZE_OZ = Number(process.env.NINE_XAUUSD_CONTRACT_SIZE_OZ ?? "100");
const OUNCE_SIZE = FIXED_LOT * CONTRACT_SIZE_OZ;

function fixedPnl(trade: BacktestTrade): number {
  const move = trade.side === "LONG"
    ? trade.exitPrice - trade.entryPrice
    : trade.entryPrice - trade.exitPrice;
  return move * OUNCE_SIZE;
}

function fixedRisk(trade: BacktestTrade): number {
  const move = trade.side === "LONG"
    ? trade.entryPrice - trade.stopLoss
    : trade.stopLoss - trade.entryPrice;
  return Math.abs(move) * OUNCE_SIZE;
}

function money(value: number): number {
  return Number(value.toFixed(2));
}
function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function fetchChunkedHistoricalCandles(startDate: string, endDate: string): Promise<ReturnType<typeof fetchProviderHistoricalCandles> extends Promise<infer T> ? T : never> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const chunks = [];
  let cursor = start;

  while (cursor < end) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS);
    const boundedEnd = chunkEnd < end ? chunkEnd : end;
    chunks.push(await fetchProviderHistoricalCandles("XAUUSD", TIMEFRAME, isoDate(cursor), isoDate(boundedEnd)));
    cursor = boundedEnd;
  }

  const byTime = new Map<number, (typeof chunks)[number][number]>();
  for (const chunk of chunks) {
    for (const candle of chunk) byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time) as never;
}

function maxDrawdownFromPnl(initial: number, pnls: number[]): number {
  let balance = initial;
  let peak = initial;
  let maxDd = 0;
  for (const pnl of pnls) {
    balance += pnl;
    peak = Math.max(peak, balance);
    maxDd = Math.max(maxDd, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
  }
  return maxDd;
}

function deterministicShuffle<T>(input: T[], seed: number): T[] {
  const output = [...input];
  let state = seed >>> 0;
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = output.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [output[i], output[j]] = [output[j]!, output[i]!];
  }
  return output;
}

function monteCarlo(trades: Array<{ pnl: number }>, initial: number, simulations = 2000) {
  if (trades.length < 5) {
    return { simulations: 0, medianMaxDrawdownPercent: null, p95MaxDrawdownPercent: null };
  }
  const pnls = trades.map((trade) => trade.pnl);
  const drawdowns: number[] = [];
  for (let i = 0; i < simulations; i += 1) {
    drawdowns.push(maxDrawdownFromPnl(initial, deterministicShuffle(pnls, 0x9e3779b9 + i)));
  }
  drawdowns.sort((a, b) => a - b);
  const percentile = (p: number) => drawdowns[Math.min(drawdowns.length - 1, Math.floor((drawdowns.length - 1) * p))] ?? 0;
  return {
    simulations,
    medianMaxDrawdownPercent: money(percentile(0.5)),
    p95MaxDrawdownPercent: money(percentile(0.95)),
  };
}

function strategyBreakdown(trades: Array<{ pnl: number; entryReason: string }>) {
  const groups = new Map<string, { trades: number; wins: number; pnl: number }>();
  for (const trade of trades) {
    const strategy = trade.entryReason.split("; ")[1] ?? "unknown";
    const existing = groups.get(strategy) ?? { trades: 0, wins: 0, pnl: 0 };
    existing.trades += 1;
    if (trade.pnl > 0) existing.wins += 1;
    existing.pnl += trade.pnl;
    groups.set(strategy, existing);
  }
  return [...groups.entries()]
    .map(([strategy, stats]) => ({
      strategy,
      trades: stats.trades,
      wins: stats.wins,
      winRate: money(stats.trades ? (stats.wins / stats.trades) * 100 : 0),
      pnl: money(stats.pnl),
    }))
    .sort((a, b) => b.pnl - a.pnl);
}

function chronologicalBlocks(
  candles: Parameters<typeof runBacktest>[0],
  blockCount = 4,
) {
  const results = [];
  const blockSize = Math.max(1, Math.floor(candles.length / blockCount));
  for (let block = 0; block < blockCount; block += 1) {
    const startIndex = block * blockSize;
    const endIndex = block === blockCount - 1 ? candles.length : Math.min(candles.length, (block + 1) * blockSize);
    const warmupStart = Math.max(0, startIndex - 120);
    const sample = candles.slice(warmupStart, endIndex);
    if (sample.length < 61) continue;
    const result = runBacktest(sample, INITIAL_BALANCE, 0.5);
    const inBlock = result.trades.filter((trade) => trade.entryTime >= candles[startIndex]!.time);
    const pnls = inBlock.map(fixedPnl);
    const wins = pnls.filter((pnl) => pnl > 0).length;
    const losses = pnls.filter((pnl) => pnl < 0);
    const grossWin = pnls.filter((pnl) => pnl > 0).reduce((sum, pnl) => sum + pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0));
    results.push({
      block: block + 1,
      start: new Date(candles[startIndex]!.time).toISOString(),
      end: new Date(candles[endIndex - 1]!.time).toISOString(),
      trades: pnls.length,
      wins,
      losses: losses.length,
      winRate: money(pnls.length ? (wins / pnls.length) * 100 : 0),
      netPnl: money(pnls.reduce((sum, pnl) => sum + pnl, 0)),
      profitFactor: grossLoss ? money(grossWin / grossLoss) : (wins ? null : 0),
      maxDrawdownPercent: money(maxDrawdownFromPnl(INITIAL_BALANCE, pnls)),
    });
  }
  return results;
}

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) {
    throw new Error("TWELVE_DATA_API_KEY is missing from the workflow environment.");
  }
  if (!(INITIAL_BALANCE > 0) || !(FIXED_LOT > 0) || !(CONTRACT_SIZE_OZ > 0)) {
    throw new Error("Invalid backtest configuration.");
  }

  const candles = await fetchChunkedHistoricalCandles(START, END);
  const base = runBacktest(candles, INITIAL_BALANCE, 0.5);

  let balance = INITIAL_BALANCE;
  let peak = INITIAL_BALANCE;
  let maxDrawdown = 0;

  const trades = base.trades.map((trade, index) => {
    const pnl = fixedPnl(trade);
    balance += pnl;
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);

    return {
      trade: index + 1,
      id: trade.id,
      side: trade.side,
      entryTime: new Date(trade.entryTime).toISOString(),
      exitTime: new Date(trade.exitTime).toISOString(),
      entryPrice: money(trade.entryPrice),
      exitPrice: money(trade.exitPrice),
      stopLoss: money(trade.stopLoss),
      takeProfit: money(trade.takeProfit),
      pnl: money(pnl),
      riskUsd: money(fixedRisk(trade)),
      rMultiple: fixedRisk(trade) > 0 ? money(pnl / fixedRisk(trade)) : 0,
      outcome: pnl >= 0 ? "WIN" : "LOSS",
      reason: trade.reason,
      entryReason: trade.entryReason,
      exitReason: trade.exitReason,
    };
  });

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = balance - INITIAL_BALANCE;

  const result = {
    instrument: "XAUUSD",
    timeframe: TIMEFRAME,
    start: START,
    end: END,
    dataPoints: candles.length,
    fixedLot: FIXED_LOT,
    contractSizeOzPerLot: CONTRACT_SIZE_OZ,
    effectiveExposureOz: OUNCE_SIZE,
    initialBalance: INITIAL_BALANCE,
    finalBalance: money(balance),
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? money((wins.length / trades.length) * 100) : 0,
    netPnl: money(netPnl),
    profitFactor: grossLoss ? money(grossWin / grossLoss) : (wins.length ? null : 0),
    averageWin: wins.length ? money(grossWin / wins.length) : 0,
    averageLoss: losses.length ? money(-grossLoss / losses.length) : 0,
    expectancyPerTrade: trades.length ? money(netPnl / trades.length) : 0,
    maxDrawdownPercent: money(maxDrawdown),
    returnPercent: money((netPnl / INITIAL_BALANCE) * 100),
    strategyBreakdown: strategyBreakdown(trades),
    chronologicalBlocks: chronologicalBlocks(candles),
    monteCarlo: monteCarlo(trades, INITIAL_BALANCE),
    strategyConfig: base.config,
    warnings: [
      ...base.warnings,
      "Fixed-lot P&L is calculated at the requested 0.01 lot using the configured 100 oz per 1.00 lot XAUUSD contract assumption.",
      "No spread, commission, swap/financing or slippage is added unless present in the source prices.",
      "This is a historical simulation, not a live execution record or a guarantee of future performance.",
    ],
    trades,
  };

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-backtest-0.01lot.json", JSON.stringify(result, null, 2));

  const lines = [
    "# NINE XAUUSD Backtest — 0.01 Lot",
    "",
    `Period: ${START} to ${END}`,
    `Timeframe: ${TIMEFRAME}`,
    `Data points: ${candles.length}`,
    `Initial balance: $${INITIAL_BALANCE.toFixed(2)}`,
    `Fixed size: ${FIXED_LOT} lot (${OUNCE_SIZE} oz effective exposure)`,
    "",
    "## Summary",
    "",
    `- Trades: ${trades.length}`,
    `- Wins: ${wins.length}`,
    `- Losses: ${losses.length}`,
    `- Win rate: ${result.winRate}%`,
    `- Net P&L: $${result.netPnl.toFixed(2)}`,
    `- Final balance: $${result.finalBalance.toFixed(2)}`,
    `- Profit factor: ${result.profitFactor ?? "—"}`,
    `- Expectancy/trade: $${result.expectancyPerTrade.toFixed(2)}`,
    `- Return: ${result.returnPercent}%`,
    `- Max drawdown: ${result.maxDrawdownPercent}%`,
    `- Monte Carlo median max DD: ${result.monteCarlo.medianMaxDrawdownPercent ?? "—"}%`,
    `- Monte Carlo p95 max DD: ${result.monteCarlo.p95MaxDrawdownPercent ?? "—"}%`,
    "",
    "## Strategy Attribution",
    "",
    "| Strategy | Trades | Wins | Win rate | P&L |",
    "|:---|---:|---:|---:|---:|",
    ...result.strategyBreakdown.map((row) => `| ${row.strategy} | ${row.trades} | ${row.wins} | ${row.winRate}% | ${row.pnl.toFixed(2)} |`),
    "",
    "## Chronological Robustness Blocks",
    "",
    "| Block | Trades | Win rate | P&L | PF | Max DD |",
    "|---:|---:|---:|---:|---:|---:|",
    ...result.chronologicalBlocks.map((row) => `| ${row.block} | ${row.trades} | ${row.winRate}% | ${row.netPnl.toFixed(2)} | ${row.profitFactor ?? "—"} | ${row.maxDrawdownPercent}% |`),
    "",
    "## Trades",
    "",
    "| # | Side | Entry | Exit | SL | TP | P&L | R | Result |",
    "|---:|:---:|---:|---:|---:|---:|---:|---:|:---:|",
    ...trades.map((t) => `| ${t.trade} | ${t.side} | ${t.entryPrice} | ${t.exitPrice} | ${t.stopLoss} | ${t.takeProfit} | $${t.pnl.toFixed(2)} | ${t.rMultiple}R | ${t.outcome} |`),
    "",
    "## Warnings",
    "",
    ...result.warnings.map((warning) => `- ${warning}`),
  ];
  fs.writeFileSync("artifacts/xauusd-backtest-0.01lot.md", lines.join("\n"));

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
