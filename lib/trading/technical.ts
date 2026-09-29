import { Candle, MarketBias, TechnicalAnalysis } from "./types";

function ema(values: number[], period: number): number {
  if (!values.length) return 0;
  const alpha = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i += 1) value = alpha * values[i] + (1 - alpha) * value;
  return value;
}
function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i], p = candles[i - 1];
    ranges.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const sample = ranges.slice(-period);
  return sample.length ? sample.reduce((s, v) => s + v, 0) / sample.length : 0;
}
function rsi(values: number[], period = 14): number {
  if (values.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gains += change; else losses -= change;
  }
  if (losses === 0) return gains > 0 ? 100 : 50;
  return 100 - 100 / (1 + (gains / period) / (losses / period));
}
function macd(values: number[]): { line: number; signal: number; histogram: number } {
  const line = ema(values.slice(-120), 12) - ema(values.slice(-120), 26);
  const lines: number[] = [];
  for (let i = Math.max(26, values.length - 80); i < values.length; i += 1) {
    const w = values.slice(0, i + 1);
    lines.push(ema(w.slice(-120), 12) - ema(w.slice(-120), 26));
  }
  const signal = ema(lines.slice(-20), 9);
  return { line, signal, histogram: line - signal };
}
function bollinger(values: number[], period = 20, multiplier = 2) {
  const sample = values.slice(-period);
  if (!sample.length) return { middle: 0, upper: 0, lower: 0, width: 0 };
  const middle = sample.reduce((s, v) => s + v, 0) / sample.length;
  const deviation = Math.sqrt(sample.reduce((s, v) => s + (v - middle) ** 2, 0) / sample.length);
  const upper = middle + multiplier * deviation, lower = middle - multiplier * deviation;
  return { middle, upper, lower, width: middle ? (upper - lower) / middle : 0 };
}
function adx(candles: Candle[], period = 14): number {
  if (candles.length < period + 2) return 0;
  const tr: number[] = [], plus: number[] = [], minus: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
    const up = c.high - p.high, down = p.low - c.low;
    plus.push(up > down && up > 0 ? up : 0);
    minus.push(down > up && down > 0 ? down : 0);
  }
  const start = Math.max(0, tr.length - period);
  const n = Math.max(1, tr.slice(start).length);
  const trAvg = tr.slice(start).reduce((s, v) => s + v, 0) / n;
  if (!trAvg) return 0;
  const pdi = (plus.slice(start).reduce((s, v) => s + v, 0) / n / trAvg) * 100;
  const mdi = (minus.slice(start).reduce((s, v) => s + v, 0) / n / trAvg) * 100;
  return pdi + mdi ? Math.abs(pdi - mdi) / (pdi + mdi) * 100 : 0;
}
function stochastic(candles: Candle[], period = 14): number {
  const sample = candles.slice(-period);
  if (!sample.length) return 50;
  const high = Math.max(...sample.map(c => c.high)), low = Math.min(...sample.map(c => c.low));
  return high === low ? 50 : ((sample.at(-1)!.close - low) / (high - low)) * 100;
}

export function analyzeTechnicals(candles: Candle[]): TechnicalAnalysis {
  if (candles.length < 60) {
    return { trend: "NEUTRAL", momentum: "NEUTRAL", structure: "INSUFFICIENT DATA", atr: 0, emaFast: 0, emaSlow: 0, trendScore: 0, momentumScore: 0 };
  }
  const closes = candles.map(c => c.close);
  const last = closes.at(-1)!;
  const fast = ema(closes.slice(-120), 9), slow = ema(closes.slice(-120), 21);
  const ema50 = ema(closes.slice(-160), 50), ema200 = ema(closes, Math.min(200, closes.length));
  const first = closes[Math.max(0, closes.length - 20)];
  const change = first ? ((last - first) / first) * 100 : 0;
  const atrValue = atr(candles), rsiValue = rsi(closes), macdValue = macd(closes);
  const bb = bollinger(closes), adxValue = adx(candles), stochasticValue = stochastic(candles);

  let trendScore = 0;
  if (last > fast) trendScore++; if (fast > slow) trendScore++; if (last > ema50) trendScore++; if (ema50 > ema200) trendScore++; if (change > 0.1) trendScore++;
  if (last < fast) trendScore--; if (fast < slow) trendScore--; if (last < ema50) trendScore--; if (ema50 < ema200) trendScore--; if (change < -0.1) trendScore--;

  let momentumScore = 0;
  if (rsiValue >= 52 && rsiValue <= 72) momentumScore++;
  if (rsiValue <= 48 && rsiValue >= 28) momentumScore--;
  if (macdValue.line > macdValue.signal && macdValue.histogram > 0) momentumScore += 2;
  if (macdValue.line < macdValue.signal && macdValue.histogram < 0) momentumScore -= 2;
  if (stochasticValue > 50 && stochasticValue < 85) momentumScore++;
  if (stochasticValue < 50 && stochasticValue > 15) momentumScore--;

  return {
    trend: trendScore >= 3 ? "BULLISH" : trendScore <= -3 ? "BEARISH" : "NEUTRAL",
    momentum: momentumScore >= 2 ? "BULLISH" : momentumScore <= -2 ? "BEARISH" : "NEUTRAL",
    structure: trendScore >= 3 ? "Higher highs / higher lows" : trendScore <= -3 ? "Lower highs / lower lows" : "Range / mixed structure",
    atr: atrValue, emaFast: fast, emaSlow: slow, ema50, ema200, rsi: rsiValue,
    macd: macdValue.line, macdSignal: macdValue.signal, macdHistogram: macdValue.histogram,
    bollingerUpper: bb.upper, bollingerMiddle: bb.middle, bollingerLower: bb.lower, bollingerWidth: bb.width,
    adx: adxValue, stochastic: stochasticValue, trendScore, momentumScore,
  };
}
