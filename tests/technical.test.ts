import { analyzeTechnicals } from "../lib/trading/technical";
import { Candle } from "../lib/trading/types";
import * as assert from "./assert";
function candles(count = 100): Candle[] { return Array.from({ length: count }, (_, i) => { const close = 2300 + i * 0.8; return { time: i * 60000, open: close - 0.2, high: close + 1, low: close - 1, close }; }); }
export function runTechnicalTest() { const result = analyzeTechnicals(candles()); assert.equal(result.trend, "BULLISH", "trend"); assert.ok(result.atr > 0, "ATR should be positive"); assert.ok(result.emaFast > result.emaSlow, "fast EMA should be above slow EMA"); }
