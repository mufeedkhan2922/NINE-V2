import { Candle, MarketBias, TechnicalAnalysis } from "./types";

function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const alpha = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i += 1) value = alpha * values[i] + (1 - alpha) * value;
  return value;
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const ranges: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    ranges.push(Math.max(current.high - current.low, Math.abs(current.high - previous.close), Math.abs(current.low - previous.close)));
  }
  const sample = ranges.slice(-period);
  return sample.length ? sample.reduce((sum, value) => sum + value, 0) / sample.length : 0;
}

export function analyzeTechnicals(candles: Candle[]): TechnicalAnalysis {
  if (candles.length < 30) {
    return { trend: "NEUTRAL", momentum: "NEUTRAL", structure: "INSUFFICIENT DATA", atr: 0, emaFast: 0, emaSlow: 0 };
  }

  const closes = candles.map((candle) => candle.close);
  const fast = ema(closes.slice(-60), 9);
  const slow = ema(closes.slice(-60), 21);
  const last = closes[closes.length - 1];
  const first = closes[Math.max(0, closes.length - 20)];
  const change = first !== 0 ? ((last - first) / first) * 100 : 0;

  let trend: MarketBias = "NEUTRAL";
  if (last > fast && fast > slow && change > 0.1) trend = "BULLISH";
  if (last < fast && fast < slow && change < -0.1) trend = "BEARISH";

  const momentum = change > 0.08 ? "BULLISH" : change < -0.08 ? "BEARISH" : "NEUTRAL";

  return {
    trend,
    momentum,
    structure: trend === "BULLISH" ? "Higher highs / higher lows" : trend === "BEARISH" ? "Lower highs / lower lows" : "Range / mixed structure",
    atr: atr(candles),
    emaFast: fast,
    emaSlow: slow,
  };
}
