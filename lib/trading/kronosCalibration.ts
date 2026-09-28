import type { KronosForecast } from "./kronosForecast";

export type KronosCalibrationState = "NOT_CALIBRATED" | "PROVISIONAL" | "CALIBRATED";

export interface KronosCalibrationObservation {
  generatedAt: number;
  horizonCandles: number;
  forecastDirection: "LONG" | "SHORT" | "NONE";
  currentPrice: number;
  medianFinal: number;
  lowFinal: number;
  highFinal: number;
  realizedPrice: number;
}

export interface KronosCalibrationReport {
  state: KronosCalibrationState;
  sampleCount: number;
  horizonCandles: number;
  directionalAccuracy: number | null;
  meanAbsoluteErrorPercent: number | null;
  medianAbsoluteErrorPercent: number | null;
  intervalCoveragePercent: number | null;
  directionalCoveragePercent: number | null;
  biasPercent: number | null;
  confidenceScore: number;
  methodology: string[];
  warnings: string[];
  generatedAt: number;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function realizedDirection(current: number, realized: number, deadbandPct = 0.05): "LONG" | "SHORT" | "NONE" {
  if (!(current > 0)) return "NONE";
  const move = ((realized - current) / current) * 100;
  if (move > deadbandPct) return "LONG";
  if (move < -deadbandPct) return "SHORT";
  return "NONE";
}

export function buildKronosCalibrationReport(
  observations: KronosCalibrationObservation[],
  minimumSamples = 100,
): KronosCalibrationReport {
  const valid = observations.filter((item) =>
    Number.isFinite(item.currentPrice) &&
    item.currentPrice > 0 &&
    Number.isFinite(item.medianFinal) &&
    Number.isFinite(item.lowFinal) &&
    Number.isFinite(item.highFinal) &&
    Number.isFinite(item.realizedPrice) &&
    item.lowFinal <= item.highFinal,
  );

  if (!valid.length) {
    return {
      state: "NOT_CALIBRATED",
      sampleCount: 0,
      horizonCandles: 0,
      directionalAccuracy: null,
      meanAbsoluteErrorPercent: null,
      medianAbsoluteErrorPercent: null,
      intervalCoveragePercent: null,
      directionalCoveragePercent: null,
      biasPercent: null,
      confidenceScore: 0,
      methodology: [
        "Calibration requires completed historical Kronos forecasts paired with realized XAUUSD prices at the same horizon.",
        "No forecast is treated as calibrated from zero-shot output alone.",
      ],
      warnings: ["No valid historical forecast observations are available."],
      generatedAt: Date.now(),
    };
  }

  const horizonCounts = new Map<number, number>();
  for (const item of valid) horizonCounts.set(item.horizonCandles, (horizonCounts.get(item.horizonCandles) ?? 0) + 1);
  const horizonCandles = [...horizonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? valid[0].horizonCandles;

  const errors = valid.map((item) => Math.abs((item.medianFinal - item.realizedPrice) / item.currentPrice) * 100);
  const biases = valid.map((item) => ((item.medianFinal - item.realizedPrice) / item.currentPrice) * 100);
  const intervalHits = valid.filter((item) => item.realizedPrice >= item.lowFinal && item.realizedPrice <= item.highFinal);
  const directionalPairs = valid.filter((item) => item.forecastDirection !== "NONE");
  const directionalHits = directionalPairs.filter((item) =>
    item.forecastDirection === realizedDirection(item.currentPrice, item.realizedPrice),
  );
  const directionalCoverage = directionalPairs.length ? (directionalHits.length / directionalPairs.length) * 100 : null;
  const coverage = (intervalHits.length / valid.length) * 100;

  const accuracy = directionalPairs.length ? directionalHits.length / directionalPairs.length * 100 : null;
  const mae = errors.reduce((sum, value) => sum + value, 0) / errors.length;
  const medianError = percentile(errors, 0.5);
  const bias = biases.reduce((sum, value) => sum + value, 0) / biases.length;

  const enoughSamples = valid.length >= minimumSamples;
  const accuracyOk = accuracy !== null && accuracy >= 55;
  const coverageOk = coverage >= 70;
  const errorOk = mae <= 0.5;
  const state: KronosCalibrationState =
    enoughSamples && accuracyOk && coverageOk && errorOk ? "CALIBRATED" :
    valid.length >= Math.max(25, Math.floor(minimumSamples / 4)) ? "PROVISIONAL" :
    "NOT_CALIBRATED";

  const confidenceScore = Math.max(0, Math.min(100, Math.round(
    Math.min(40, (valid.length / minimumSamples) * 40) +
    (accuracy === null ? 0 : Math.min(25, Math.max(0, accuracy - 50))) +
    Math.min(20, coverage / 5) +
    Math.max(0, Math.min(15, 15 - mae * 10)),
  )));

  const warnings: string[] = [];
  if (!enoughSamples) warnings.push(`Calibration needs at least ${minimumSamples} valid observations; current sample is ${valid.length}.`);
  if (accuracy !== null && accuracy < 55) warnings.push("Directional accuracy is below the calibration gate.");
  if (coverage < 70) warnings.push("Forecast interval coverage is below the calibration gate.");
  if (mae > 0.5) warnings.push("Median-path absolute error is above the calibration gate.");
  warnings.push("Calibration metrics describe historical forecast behavior; they do not guarantee future trading performance.");

  return {
    state,
    sampleCount: valid.length,
    horizonCandles,
    directionalAccuracy: accuracy === null ? null : round(accuracy),
    meanAbsoluteErrorPercent: round(mae),
    medianAbsoluteErrorPercent: round(medianError),
    intervalCoveragePercent: round(coverage),
    directionalCoveragePercent: directionalCoverage === null ? null : round(directionalCoverage),
    biasPercent: round(bias),
    confidenceScore,
    methodology: [
      "Only completed forecast/realized-price pairs are evaluated.",
      "Forecast direction is scored against realized direction at the same horizon.",
      "Median endpoint error is measured as absolute percentage error from the forecast origin price.",
      "Low/high interval coverage measures how often the realized endpoint fell inside the sampled forecast band.",
      "Calibration is horizon-specific; mixed horizons are summarized by the most common horizon but should be stored separately for production use.",
    ],
    warnings,
    generatedAt: Date.now(),
  };
}

export function observationFromForecast(
  forecast: KronosForecast,
  realizedPrice: number,
): KronosCalibrationObservation | null {
  if (
    forecast.status !== "LIVE" ||
    forecast.currentPrice == null ||
    forecast.medianFinal == null ||
    forecast.lowFinal == null ||
    forecast.highFinal == null ||
    !Number.isFinite(realizedPrice)
  ) return null;

  return {
    generatedAt: forecast.generatedAt,
    horizonCandles: forecast.horizonCandles,
    forecastDirection: forecast.expectedDirection,
    currentPrice: forecast.currentPrice,
    medianFinal: forecast.medianFinal,
    lowFinal: forecast.lowFinal,
    highFinal: forecast.highFinal,
    realizedPrice,
  };
}
