import { buildUnavailableKronosForecast } from "../lib/trading/kronosForecast";
import { assessKronosQuality } from "../lib/trading/kronosQuality";
import { buildKronosCalibrationReport } from "../lib/trading/kronosCalibration";
import * as assert from "./assert";

export function runKronosForecastTest(): void {
  const forecast = buildUnavailableKronosForecast("5min", "UNAVAILABLE", ["test"]);
  assert.equal(forecast.symbol, "XAUUSD", "Kronos symbol");
  assert.equal(forecast.status, "UNAVAILABLE", "Kronos unavailable state");
  assert.equal(forecast.expectedDirection, "NONE", "unavailable direction");
  assert.equal(forecast.uncertainty, "UNKNOWN", "unavailable uncertainty");
  assert.equal(forecast.decisionWeight, 0, "Kronos execution weight is zero before calibration");
  assert.equal(forecast.calibrationState, "NOT_CALIBRATED", "Kronos starts uncalibrated");
  assert.ok(forecast.warnings.includes("test"), "Kronos warning preserved");

  const candles = Array.from({ length: 20 }, (_, i) => ({
    time: 1_700_000_000_000 + i * 300_000,
    open: 2300 + i,
    high: 2302 + i,
    low: 2299 + i,
    close: 2301 + i,
    volume: 1000,
  }));
  const quality = assessKronosQuality(forecast, candles);
  assert.equal(quality.state, "UNAVAILABLE", "unavailable Kronos quality state");
  assert.equal(quality.score, 0, "unavailable Kronos quality score");

  const observations = Array.from({ length: 100 }, (_, i) => ({
    generatedAt: 1_700_000_000_000 + i * 300_000,
    horizonCandles: 12,
    forecastDirection: "LONG" as const,
    currentPrice: 2300,
    medianFinal: 2301,
    lowFinal: 2298,
    highFinal: 2304,
    realizedPrice: 2302,
  }));
  const calibration = buildKronosCalibrationReport(observations);
  assert.equal(calibration.sampleCount, 100, "calibration sample count");
  assert.equal(calibration.directionalAccuracy, 100, "calibration directional accuracy");
  assert.equal(calibration.intervalCoveragePercent, 100, "calibration interval coverage");
  assert.equal(calibration.state, "CALIBRATED", "calibration gate");

}
