import { analyzeSMC, analyzeChartist } from "../lib/trading/smc";
import { Candle } from "../lib/trading/types";
import * as assert from "./assert";
function candles(): Candle[] { const result: Candle[] = []; for (let i = 0; i < 60; i += 1) { const base = 2300 + Math.sin(i / 4) * 4 + i * 0.03; result.push({ time: i * 60000, open: base, high: base + 1, low: base - 1, close: base + 0.2 }); } result[59] = { ...result[59], high: 2305, low: 2290, close: 2299 }; return result; }
export function runSmcTest() { const result = analyzeSMC(candles()); assert.ok(result.chartist, "chartist data should exist"); assert.ok(["ASIA", "LONDON", "NEW_YORK", "OFF_SESSION"].includes(result.chartist!.session), "session should be known"); const chartist = analyzeChartist(candles()); assert.ok(Array.isArray(chartist.fairValueGaps), "FVG list should exist"); assert.ok(Array.isArray(chartist.orderBlocks), "OB list should exist"); }
