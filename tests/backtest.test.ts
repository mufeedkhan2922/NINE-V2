import { runBacktest } from "../lib/trading/backtest";
import { Candle } from "../lib/trading/types";
import * as assert from "./assert";
function candles(count = 220): Candle[] { return Array.from({ length: count }, (_, i) => { const close = 2300 + Math.sin(i / 8) * 5 + i * 0.25; return { time: i * 60000, open: close - 0.1, high: close + 1.1, low: close - 1.1, close }; }); }
export function runBacktestTest() { const result = runBacktest(candles(), 10000, 0.5); assert.equal(result.initialBalance, 10000, "initial balance"); assert.equal(result.totalTrades, result.wins + result.losses, "trade counts"); assert.ok(Number.isFinite(result.maxDrawdown), "drawdown should be finite"); }
