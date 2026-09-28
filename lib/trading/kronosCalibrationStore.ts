import { randomUUID } from "node:crypto";

import { db } from "./db";
import {
  buildKronosCalibrationReport,
  type KronosCalibrationObservation,
  type KronosCalibrationReport,
} from "./kronosCalibration";
import type { KronosForecast } from "./kronosForecast";
import type { Candle, Timeframe } from "./types";

export interface KronosCalibrationSnapshot {
  report: KronosCalibrationReport;
  pendingCount: number;
  resolvedCount: number;
  lastResolvedAt: number | null;
  model: string;
  timeframe: Timeframe;
  horizonCandles: number;
}

function tableTime(value: number): number {
  // NINE candle timestamps are normally milliseconds. Accept seconds as well
  // so historical/provider adapters cannot silently shift calibration targets.
  return value > 10_000_000_000 ? value : value * 1000;
}

function timeframeMinutes(timeframe: Timeframe): number {
  switch (timeframe) {
    case "1min": return 1;
    case "5min": return 5;
    case "15min": return 15;
    case "1h": return 60;
    case "4h": return 240;
    case "1day": return 1440;
  }
}

function targetCandleTime(
  originCandleTime: number,
  timeframe: Timeframe,
  horizonCandles: number,
): number {
  return tableTime(originCandleTime) + timeframeMinutes(timeframe) * 60_000 * horizonCandles;
}

function validPrice(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

export function recordKronosForecast(
  forecast: KronosForecast,
  originCandleTime: number,
): void {
  if (
    forecast.status !== "LIVE" ||
    forecast.stale ||
    !validPrice(forecast.currentPrice) ||
    !validPrice(forecast.medianFinal) ||
    !validPrice(forecast.lowFinal) ||
    !validPrice(forecast.highFinal)
  ) return;

  const origin = tableTime(originCandleTime);
  const target = targetCandleTime(
    origin,
    forecast.timeframe,
    forecast.horizonCandles,
  );

  db.prepare(
    `
      INSERT OR IGNORE INTO kronos_calibration_forecasts (
        id,
        symbol,
        timeframe,
        model,
        horizon_candles,
        origin_candle_time,
        target_candle_time,
        generated_at,
        current_price,
        median_final,
        low_final,
        high_final,
        forecast_direction,
        resolved,
        realized_price,
        realized_at,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?)
    `,
  ).run(
    `KRONOS-${randomUUID()}`,
    "XAUUSD",
    forecast.timeframe,
    forecast.model,
    forecast.horizonCandles,
    origin,
    target,
    forecast.generatedAt,
    forecast.currentPrice,
    forecast.medianFinal,
    forecast.lowFinal,
    forecast.highFinal,
    forecast.expectedDirection,
    Date.now(),
  );
}

export function resolveKronosForecasts(
  timeframe: Timeframe,
  candles: Candle[],
  model?: string,
): number {
  const normalized = candles
    .filter((c) => Number.isFinite(c.time) && Number.isFinite(c.close) && c.close > 0)
    .map((c) => ({ ...c, time: tableTime(c.time) }))
    .sort((a, b) => a.time - b.time);

  if (!normalized.length) return 0;

  const rows = db
    .prepare(
      `
        SELECT *
        FROM kronos_calibration_forecasts
        WHERE symbol = ?
          AND timeframe = ?
          AND resolved = 0
          AND (? IS NULL OR model = ?)
        ORDER BY target_candle_time ASC
      `,
    )
    .all("XAUUSD", timeframe, model ?? null, model ?? null) as Array<{
      id: string;
      target_candle_time: number;
    }>;

  let resolved = 0;

  const update = db.prepare(
    `
      UPDATE kronos_calibration_forecasts
      SET resolved = 1, realized_price = ?, realized_at = ?
      WHERE id = ? AND resolved = 0
    `,
  );

  for (const row of rows) {
    const realized = normalized.find((c) => c.time >= Number(row.target_candle_time));
    if (!realized) continue;

    update.run(realized.close, realized.time, row.id);
    resolved += 1;
  }

  return resolved;
}

function loadObservations(
  timeframe: Timeframe,
  model: string,
  horizonCandles: number,
): KronosCalibrationObservation[] {
  const rows = db
    .prepare(
      `
        SELECT
          generated_at,
          horizon_candles,
          forecast_direction,
          current_price,
          median_final,
          low_final,
          high_final,
          realized_price
        FROM kronos_calibration_forecasts
        WHERE symbol = ?
          AND timeframe = ?
          AND model = ?
          AND horizon_candles = ?
          AND resolved = 1
          AND realized_price IS NOT NULL
        ORDER BY generated_at ASC
        LIMIT 5000
      `,
    )
    .all(
      "XAUUSD",
      timeframe,
      model,
      horizonCandles,
    ) as any[];

  return rows.map((row) => ({
    generatedAt: Number(row.generated_at),
    horizonCandles: Number(row.horizon_candles),
    forecastDirection: row.forecast_direction,
    currentPrice: Number(row.current_price),
    medianFinal: Number(row.median_final),
    lowFinal: Number(row.low_final),
    highFinal: Number(row.high_final),
    realizedPrice: Number(row.realized_price),
  }));
}

export function getKronosCalibrationSnapshot(
  timeframe: Timeframe,
  model: string,
  horizonCandles: number,
): KronosCalibrationSnapshot {
  const observations = loadObservations(timeframe, model, horizonCandles);
  const report = buildKronosCalibrationReport(observations);

  const pendingRow = db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM kronos_calibration_forecasts
        WHERE symbol = ? AND timeframe = ? AND model = ?
          AND horizon_candles = ? AND resolved = 0
      `,
    )
    .get("XAUUSD", timeframe, model, horizonCandles) as { count: number };

  const lastRow = db
    .prepare(
      `
        SELECT realized_at
        FROM kronos_calibration_forecasts
        WHERE symbol = ? AND timeframe = ? AND model = ?
          AND horizon_candles = ? AND resolved = 1
        ORDER BY realized_at DESC
        LIMIT 1
      `,
    )
    .get("XAUUSD", timeframe, model, horizonCandles) as
    | { realized_at: number | null }
    | undefined;

  return {
    report,
    pendingCount: Number(pendingRow?.count ?? 0),
    resolvedCount: observations.length,
    lastResolvedAt: lastRow?.realized_at == null ? null : Number(lastRow.realized_at),
    model,
    timeframe,
    horizonCandles,
  };
}
