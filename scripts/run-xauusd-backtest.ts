import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import type { BacktestTrade } from "../lib/trading/backtest";
import type { Candle } from "../lib/trading/types";

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

async function fetchChunkedHistoricalCandles(startDate: string, endDate: string): Promise<Candle[]> {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const chunks: Candle[][] = [];
  let cursor = start;

  while (cursor < end) {
    const chunkEnd = addDays(cursor, CHUNK_DAYS);
    const boundedEnd = chunkEnd < end ? chunkEnd : end;
    chunks.push(await fetchProviderHistoricalCandles("XAUUSD", TIMEFRAME, isoDate(cursor), isoDate(boundedEnd)));
    cursor = boundedEnd;
  }

  const byTime = new Map<number, Candle>();
  for (const chunk of chunks) {
    for (const candle of chunk) byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
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