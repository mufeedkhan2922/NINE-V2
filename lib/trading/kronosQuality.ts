import type { Candle } from "./types";
import type { KronosForecast } from "./kronosForecast";

export type KronosQualityState = "STRONG" | "MODERATE" | "WEAK" | "UNAVAILABLE";

export interface KronosQuality {
  state: KronosQualityState;
  score: number;
  directionalMovePercent: number | null;
  pathSlopePercent: number | null;
  bandWidthPercent: number | null;
  marketDirection: "LONG" | "SHORT" | "NONE";
  forecastDirection: "LONG" | "SHORT" | "NONE";
  agreement: "ALIGNED" | "CONFLICTING" | "NEUTRAL" | "UNKNOWN";
  horizonCandles: number;
  sampleCount: number;
  notes: string[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function marketDirection(candles: Candle[]): "LONG" | "SHORT" | "NONE" {
  if (candles.length < 12) return "NONE";
  const closes = candles.slice(-12).map((c) => c.close);
  const first = closes[0];
  const last = closes.at(-1) ?? first;
  const move = first > 0 ? ((last - first) / first) * 100 : 0;
  if (move > 0.08) return "LONG";
  if (move < -0.08) return "SHORT";
  return "NONE";
}

export function assessKronosQuality(forecast: KronosForecast, candles: Candle[]): KronosQuality {
  if (forecast.status !== "LIVE" || forecast.currentPrice == null || forecast.medianFinal == null) {
    return {
      state: "UNAVAILABLE",
      score: 0,
      directionalMovePercent: null,
      pathSlopePercent: null,
      bandWidthPercent: forecast.bandWidthPercent,
      marketDirection: marketDirection(candles),
      forecastDirection: "NONE",
      agreement: "UNKNOWN",
      horizonCandles: forecast.horizonCandles,
      sampleCount: forecast.sampleCount,
      notes: ["Kronos forecast is unavailable; no quality score is assigned."],
    };
  }

  const directionalMovePercent = forecast.currentPrice > 0
    ? ((forecast.medianFinal - forecast.currentPrice) / forecast.currentPrice) * 100
    : null;
  const firstPath = forecast.medianPath[0] ?? forecast.currentPrice;
  const pathSlopePercent = firstPath && firstPath > 0
    ? ((forecast.medianFinal - firstPath) / firstPath) * 100
    : directionalMovePercent;
  const md = marketDirection(candles);
  const fd = forecast.expectedDirection;
  const agreement = fd === "NONE" || md === "NONE"
    ? "NEUTRAL"
    : fd === md
      ? "ALIGNED"
      : "CONFLICTING";

  let score = 35;
  if (forecast.sampleCount >= 20) score += 15;
  else if (forecast.sampleCount >= 10) score += 8;
  if (forecast.contextCandles >= 120) score += 10;
  else if (forecast.contextCandles >= 60) score += 5;
  if (forecast.uncertainty === "LOW") score += 20;
  else if (forecast.uncertainty === "MEDIUM") score += 10;
  else if (forecast.uncertainty === "HIGH") score -= 5;
  if (agreement === "ALIGNED") score += 15;
  if (agreement === "CONFLICTING") score -= 20;
  if (forecast.latencyMs != null && forecast.latencyMs < 15_000) score += 5;

  const notes = [
    "Quality score measures forecast integrity/confluence, not future trading accuracy.",
    forecast.calibrationState === "CALIBRATED"
      ? "Forecast calibration metadata is available."
      : "Forecast remains zero-shot and uncalibrated.",
  ];
  if (agreement === "ALIGNED") notes.push("Forecast direction agrees with the recent 12-candle market direction.");
  if (agreement === "CONFLICTING") notes.push("Forecast direction conflicts with the recent 12-candle market direction.");
  if (forecast.uncertainty === "HIGH") notes.push("Wide forecast band reduces evidence quality.");

  const finalScore = clamp(score);
  const state: KronosQualityState =
    finalScore >= 75 ? "STRONG" : finalScore >= 55 ? "MODERATE" : "WEAK";

  return {
    state,
    score: finalScore,
    directionalMovePercent,
    pathSlopePercent,
    bandWidthPercent: forecast.bandWidthPercent,
    marketDirection: md,
    forecastDirection: fd,
    agreement,
    horizonCandles: forecast.horizonCandles,
    sampleCount: forecast.sampleCount,
    notes,
  };
}
