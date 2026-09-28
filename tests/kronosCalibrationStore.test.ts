import {
  getKronosCalibrationSnapshot,
  recordKronosForecast,
  resolveKronosForecasts,
} from "../lib/trading/kronosCalibrationStore";
import type { KronosForecast } from "../lib/trading/kronosForecast";

export function runKronosCalibrationStoreTest(): void {
  const origin = Math.floor(Date.now() / 60_000) * 60_000;
  const forecast: KronosForecast = {
    version: "1.0.0",
    symbol: "XAUUSD",
    timeframe: "1min",
    status: "LIVE",
    model: "Kronos-small",
    contextCandles: 120,
    horizonCandles: 1,
    sampleCount: 20,
    currentPrice: 2500,
    medianFinal: 2501,
    lowFinal: 2499,
    highFinal: 2503,
    expectedDirection: "LONG",
    uncertainty: "MEDIUM",
    bandWidthPercent: 0.16,
    timestamps: [origin + 60_000],
    lowPath: [2499],
    medianPath: [2501],
    highPath: [2503],
    latencyMs: 10,
    endpoint: "test",
    generatedAt: Date.now(),
    calibrationState: "NOT_CALIBRATED",
    decisionWeight: 0,
    warnings: [],
    stale: false,
    staleSeconds: 0,
  };

  recordKronosForecast(forecast, origin);
  resolveKronosForecasts("1min", [
    { time: origin, open: 2500, high: 2501, low: 2499, close: 2500 },
    { time: origin + 60_000, open: 2500, high: 2502, low: 2499, close: 2502 },
  ], forecast.model);

  const snapshot = getKronosCalibrationSnapshot("1min", forecast.model, 1);
  if (snapshot.resolvedCount < 1) {
    throw new Error("Kronos calibration ledger did not resolve a completed forecast.");
  }
  if (snapshot.report.sampleCount < 1) {
    throw new Error("Kronos calibration report did not include the resolved observation.");
  }
}
