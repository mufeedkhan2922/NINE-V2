import type { Candle } from "./types";
import { analyzeTechnicals } from "./technical";

export type LearningRegime = "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "EXPANDING" | "TRANSITION" | "UNKNOWN";

export interface RegimePolicy {
  regime: LearningRegime;
  allowedFamilies: string[];
  minimumScore: number;
  riskMultiplier: number;
  reason: string;
}

function aggregate(candles: Candle[], bucketMinutes: number): Candle[] {
  const bucketMs = bucketMinutes * 60 * 1000;
  const map = new Map<number, Candle>();
  for (const candle of candles) {
    const bucket = Math.floor(candle.time / bucketMs) * bucketMs;
    const existing = map.get(bucket);
    if (!existing) map.set(bucket, { ...candle });
    else {
      existing.high = Math.max(existing.high, candle.high);
      existing.low = Math.min(existing.low, candle.low);
      existing.close = candle.close;
      if (candle.volume !== undefined) existing.volume = (existing.volume ?? 0) + candle.volume;
    }
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

export function regimeFromCandles(candles: Candle[]): LearningRegime {
  const current = candles.at(-1);
  if (!current) return "UNKNOWN";

  const ranges = candles.slice(-21, -1).map((candle) => candle.high - candle.low);
  const avgRange = ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : 0;
  const expansion = avgRange > 0 ? (current.high - current.low) / avgRange : 1;

  const tf15 = aggregate(candles, 15);
  if (tf15.length < 30) return expansion >= 1.75 ? "EXPANDING" : "UNKNOWN";

  const tech = analyzeTechnicals(tf15);
  if (expansion >= 1.75) return "EXPANDING";

  const bullish = tech.trend === "BULLISH" && (tech.momentum === "BULLISH" || (tech.macdHistogram ?? 0) > 0);
  const bearish = tech.trend === "BEARISH" && (tech.momentum === "BEARISH" || (tech.macdHistogram ?? 0) < 0);

  if (bullish) return "TRENDING_UP";
  if (bearish) return "TRENDING_DOWN";
  if (tech.trend === "NEUTRAL") return "RANGING";
  return "TRANSITION";
}

export function policyForRegime(regime: LearningRegime): RegimePolicy {
  switch (regime) {
    case "TRENDING_UP":
    case "TRENDING_DOWN":
      return {
        regime,
        allowedFamilies: [
          "EMA pullback continuation",
          "breakout continuation",
          "breakout-retest continuation",
          "FVG continuation",
          "order-block retest",
          "volatility expansion momentum",
        ],
        minimumScore: 8,
        riskMultiplier: 1,
        reason: "Trend regime requires continuation evidence.",
      };
    case "RANGING":
      return {
        regime,
        allowedFamilies: [
          "mean-reversion sweep",
          "previous-day-low sweep reversal",
          "previous-day-high sweep reversal",
          "Asia-range sweep reversal",
        ],
        minimumScore: 8,
        riskMultiplier: 0.7,
        reason: "Range regime favors rejection/mean-reversion evidence.",
      };
    case "EXPANDING":
      return {
        regime,
        allowedFamilies: [
          "opening-range breakout",
          "breakout continuation",
          "breakout-retest continuation",
          "volatility expansion momentum",
        ],
        minimumScore: 9,
        riskMultiplier: 0.8,
        reason: "Expansion regime requires confirmed breakout/momentum.",
      };
    case "TRANSITION":
      return {
        regime,
        allowedFamilies: [],
        minimumScore: 10,
        riskMultiplier: 0,
        reason: "Transition is intentionally no-trade until direction stabilizes.",
      };
    default:
      return {
        regime,
        allowedFamilies: [],
        minimumScore: 10,
        riskMultiplier: 0,
        reason: "Unknown regime is not tradeable without evidence.",
      };
  }
}
