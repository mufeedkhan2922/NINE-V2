import { Candle, ChartistAnalysis, SMCAnalysis, SMCZone, TradeDirection } from "./types";

const SWING_LENGTH = 3;
const LIQUIDITY_LOOKBACK = 20;

function isSwingHigh(candles: Candle[], index: number): boolean {
  const c = candles[index];
  if (!c) return false;
  for (let i = 1; i <= SWING_LENGTH; i += 1) {
    if (!candles[index - i] || !candles[index + i]) return false;
    if (c.high <= candles[index - i].high || c.high <= candles[index + i].high) return false;
  }
  return true;
}
function isSwingLow(candles: Candle[], index: number): boolean {
  const c = candles[index];
  if (!c) return false;
  for (let i = 1; i <= SWING_LENGTH; i += 1) {
    if (!candles[index - i] || !candles[index + i]) return false;
    if (c.low >= candles[index - i].low || c.low >= candles[index + i].low) return false;
  }
  return true;
}
function swingHighs(candles: Candle[]): number[] {
  const values: number[] = [];
  for (let i = SWING_LENGTH; i < candles.length - SWING_LENGTH; i += 1) if (isSwingHigh(candles, i)) values.push(candles[i].high);
  return values;
}
function swingLows(candles: Candle[]): number[] {
  const values: number[] = [];
  for (let i = SWING_LENGTH; i < candles.length - SWING_LENGTH; i += 1) if (isSwingLow(candles, i)) values.push(candles[i].low);
  return values;
}
function currentSession(timestamp: number): ChartistAnalysis["session"] {
  const hour = new Date(timestamp).getUTCHours();
  if (hour >= 0 && hour < 7) return "ASIA";
  if (hour >= 7 && hour < 12) return "LONDON";
  if (hour >= 12 && hour < 21) return "NEW_YORK";
  return "OFF_SESSION";
}
function sessionRange(candles: Candle[], session: ChartistAnalysis["session"]): { high: number | null; low: number | null } {
  if (session === "OFF_SESSION") return { high: null, low: null };
  const eligible = candles.filter((c) => currentSession(c.time) === session).slice(-120);
  if (!eligible.length) return { high: null, low: null };
  return { high: Math.max(...eligible.map((c) => c.high)), low: Math.min(...eligible.map((c) => c.low)) };
}
function liquidityLevels(candles: Candle[]): { high: number | null; low: number | null } {
  const window = candles.slice(-LIQUIDITY_LOOKBACK - 1, -1);
  if (!window.length) return { high: null, low: null };
  return { high: Math.max(...window.map((c) => c.high)), low: Math.min(...window.map((c) => c.low)) };
}
function detectSweep(candles: Candle[]): { detected: boolean; direction: TradeDirection } {
  const levels = liquidityLevels(candles);
  const current = candles.at(-1);
  if (!current || levels.high === null || levels.low === null) return { detected: false, direction: "NONE" };
  if (current.high > levels.high && current.close < levels.high) return { detected: true, direction: "SHORT" };
  if (current.low < levels.low && current.close > levels.low) return { detected: true, direction: "LONG" };
  return { detected: false, direction: "NONE" };
}
function detectFVGs(candles: Candle[]): SMCZone[] {
  const zones: SMCZone[] = [];
  for (let i = Math.max(2, candles.length - 20); i < candles.length; i += 1) {
    const a = candles[i - 2], c = candles[i];
    if (!a || !c) continue;
    if (a.high < c.low) zones.push({ high: c.low, low: a.high, direction: "LONG", createdAt: c.time });
    if (a.low > c.high) zones.push({ high: a.low, low: c.high, direction: "SHORT", createdAt: c.time });
  }
  return zones.slice(-5);
}
function detectOrderBlocks(candles: Candle[]): SMCZone[] {
  const zones: SMCZone[] = [];
  for (let i = Math.max(5, candles.length - 30); i < candles.length - 2; i += 1) {
    const c = candles[i], next = candles[i + 1];
    const body = Math.abs(c.close - c.open);
    const avg = candles.slice(Math.max(0, i - 5), i).reduce((s, x) => s + Math.abs(x.close - x.open), 0) / Math.max(1, Math.min(5, i));
    if (body < avg * 0.8) continue;
    const impulse = next.close - next.open;
    if (c.close < c.open && impulse > 0 && next.close > c.high) zones.push({ high: c.high, low: c.low, direction: "LONG", createdAt: c.time });
    if (c.close > c.open && impulse < 0 && next.close < c.low) zones.push({ high: c.high, low: c.low, direction: "SHORT", createdAt: c.time });
  }
  return zones.slice(-5);
}
function structureShift(candles: Candle[]): { mss: TradeDirection; choch: TradeDirection } {
  const highs = swingHighs(candles.slice(0, -1));
  const lows = swingLows(candles.slice(0, -1));
  const current = candles.at(-1);
  if (!current) return { mss: "NONE", choch: "NONE" };
  const lastHigh = highs.at(-1) ?? null;
  const lastLow = lows.at(-1) ?? null;
  const priorHigh = highs.at(-2) ?? null;
  const priorLow = lows.at(-2) ?? null;
  const bullishBreak = lastHigh !== null && current.close > lastHigh;
  const bearishBreak = lastLow !== null && current.close < lastLow;
  let priorTrend: TradeDirection = "NONE";
  if (priorHigh !== null && priorLow !== null && lastHigh !== null && lastLow !== null) {
    priorTrend = lastHigh > priorHigh && lastLow > priorLow ? "LONG" : lastHigh < priorHigh && lastLow < priorLow ? "SHORT" : "NONE";
  }
  if (bullishBreak) return { mss: priorTrend === "SHORT" ? "LONG" : "LONG", choch: priorTrend === "SHORT" ? "LONG" : "NONE" };
  if (bearishBreak) return { mss: "SHORT", choch: priorTrend === "LONG" ? "SHORT" : "NONE" };
  return { mss: "NONE", choch: "NONE" };
}
function premiumDiscount(candles: Candle[]): SMCAnalysis["premiumDiscount"] {
  const recent = candles.slice(-30);
  if (!recent.length) return "EQUILIBRIUM";
  const high = Math.max(...recent.map((c) => c.high)), low = Math.min(...recent.map((c) => c.low)), mid = (high + low) / 2;
  const threshold = Math.max((high - low) * 0.05, 0.000001);
  const price = recent.at(-1)!.close;
  return price > mid + threshold ? "PREMIUM" : price < mid - threshold ? "DISCOUNT" : "EQUILIBRIUM";
}

export function analyzeChartist(candles: Candle[]): ChartistAnalysis {
  const levels = liquidityLevels(candles);
  const session = currentSession(candles.at(-1)?.time ?? Date.now());
  const range = sessionRange(candles, session);
  const structure = structureShift(candles);
  return { liquidityHigh: levels.high, liquidityLow: levels.low, fairValueGaps: detectFVGs(candles), orderBlocks: detectOrderBlocks(candles), mssDirection: structure.mss, chochDirection: structure.choch, session, sessionHigh: range.high, sessionLow: range.low };
}

export function analyzeSMC(candles: Candle[]): SMCAnalysis {
  if (candles.length < 30) return { liquiditySweep: false, marketStructureShift: false, fairValueGap: false, orderBlock: false, premiumDiscount: "EQUILIBRIUM", sweepDirection: "NONE", structureDirection: "NONE", chartist: analyzeChartist(candles) };
  const sweep = detectSweep(candles);
  const chartist = analyzeChartist(candles);
  const structureDirection = chartist.mssDirection !== "NONE" ? chartist.mssDirection : chartist.chochDirection;
  return {
    liquiditySweep: sweep.detected,
    marketStructureShift: chartist.mssDirection !== "NONE",
    fairValueGap: chartist.fairValueGaps.length > 0,
    orderBlock: chartist.orderBlocks.length > 0,
    premiumDiscount: premiumDiscount(candles),
    sweepDirection: sweep.direction,
    structureDirection,
    chartist,
  };
}
