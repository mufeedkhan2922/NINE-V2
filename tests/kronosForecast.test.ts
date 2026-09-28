import { buildUnavailableKronosForecast } from "../lib/trading/kronosForecast";
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
}
