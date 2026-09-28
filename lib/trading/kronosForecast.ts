import type { Candle, MarketSnapshot, Timeframe } from "./types";

export type KronosForecastStatus = "LIVE" | "UNAVAILABLE" | "ERROR";

export interface KronosForecast {
  version: "1.0.0";
  symbol: "XAUUSD";
  timeframe: Timeframe;
  status: KronosForecastStatus;
  model: string;
  contextCandles: number;
  horizonCandles: number;
  sampleCount: number;
  currentPrice: number | null;
  medianFinal: number | null;
  lowFinal: number | null;
  highFinal: number | null;
  expectedDirection: "LONG" | "SHORT" | "NONE";
  uncertainty: "LOW" | "MEDIUM" | "HIGH" | "UNKNOWN";
  bandWidthPercent: number | null;
  timestamps: number[];
  lowPath: number[];
  medianPath: number[];
  highPath: number[];
  latencyMs: number | null;
  endpoint: string | null;
  generatedAt: number;
  calibrationState: "NOT_CALIBRATED" | "CALIBRATED";
  decisionWeight: 0;
  warnings: string[];
}

interface KronosServiceResponse {
  ok: boolean;
  model?: string;
  contextCandles?: number;
  horizonCandles?: number;
  sampleCount?: number;
  currentPrice?: number;
  timestamps?: number[];
  lowPath?: number[];
  medianPath?: number[];
  highPath?: number[];
  latencyMs?: number;
  warnings?: string[];
  error?: string;
}

const globalCache = globalThis as typeof globalThis & {
  __nineKronosForecastCache?: Map<string, { forecast: KronosForecast; expiresAt: number }>;
  __nineKronosForecastInflight?: Map<string, Promise<KronosForecast>>;
};

const cache = globalCache.__nineKronosForecastCache ?? new Map<string, { forecast: KronosForecast; expiresAt: number }>();
globalCache.__nineKronosForecastCache = cache;
const inflight = globalCache.__nineKronosForecastInflight ?? new Map<string, Promise<KronosForecast>>();
globalCache.__nineKronosForecastInflight = inflight;

function timeframeForKronos(market: MarketSnapshot, requested: Timeframe): { timeframe: Timeframe; candles: Candle[] } {
  const preferred = market.timeframes?.[requested]?.candles;
  if (preferred?.length) return { timeframe: requested, candles: preferred };
  if (requested !== "5min" && market.timeframes?.["5min"]?.candles?.length) {
    return { timeframe: "5min", candles: market.timeframes["5min"].candles };
  }
  return { timeframe: "1min", candles: market.timeframes?.["1min"]?.candles ?? market.candles };
}

export function buildUnavailableKronosForecast(timeframe: Timeframe, status: KronosForecastStatus = "UNAVAILABLE", warnings: string[] = []): KronosForecast {
  return {
    version: "1.0.0", symbol: "XAUUSD", timeframe, status,
    model: process.env.NINE_KRONOS_MODEL ?? "Kronos-small",
    contextCandles: 0,
    horizonCandles: Number(process.env.NINE_KRONOS_HORIZON ?? 12),
    sampleCount: Number(process.env.NINE_KRONOS_SAMPLES ?? 20),
    currentPrice: null, medianFinal: null, lowFinal: null, highFinal: null,
    expectedDirection: "NONE", uncertainty: "UNKNOWN", bandWidthPercent: null,
    timestamps: [], lowPath: [], medianPath: [], highPath: [],
    latencyMs: null, endpoint: process.env.NINE_KRONOS_ENDPOINT ?? null,
    generatedAt: Date.now(), calibrationState: "NOT_CALIBRATED", decisionWeight: 0, warnings,
  };
}

function validateResponse(payload: KronosServiceResponse, requestedTimeframe: Timeframe): KronosForecast {
  if (!payload.ok) return buildUnavailableKronosForecast(requestedTimeframe, "ERROR", [payload.error ?? "Kronos service returned an unsuccessful response."]);

  const timestamps = Array.isArray(payload.timestamps) ? payload.timestamps.map(Number) : [];
  const lowPath = Array.isArray(payload.lowPath) ? payload.lowPath.map(Number) : [];
  const medianPath = Array.isArray(payload.medianPath) ? payload.medianPath.map(Number) : [];
  const highPath = Array.isArray(payload.highPath) ? payload.highPath.map(Number) : [];

  if (!medianPath.length || lowPath.length !== medianPath.length || highPath.length !== medianPath.length) {
    return buildUnavailableKronosForecast(requestedTimeframe, "ERROR", ["Kronos response did not contain aligned forecast paths."]);
  }
  if (timestamps.length !== medianPath.length || medianPath.some((value) => !Number.isFinite(value))) {
    return buildUnavailableKronosForecast(requestedTimeframe, "ERROR", ["Kronos response contained invalid forecast values."]);
  }

  const currentPrice = Number(payload.currentPrice);
  const medianFinal = medianPath.at(-1) ?? null;
  const lowFinal = lowPath.at(-1) ?? null;
  const highFinal = highPath.at(-1) ?? null;
  const bandWidthPercent = Number.isFinite(currentPrice) && currentPrice > 0 && lowFinal !== null && highFinal !== null
    ? ((highFinal - lowFinal) / currentPrice) * 100
    : null;
  const movePercent = Number.isFinite(currentPrice) && currentPrice > 0 && medianFinal !== null
    ? ((medianFinal - currentPrice) / currentPrice) * 100
    : 0;
  const deadband = Number(process.env.NINE_KRONOS_DIRECTION_DEADBAND_PCT ?? 0.05);
  const expectedDirection: KronosForecast["expectedDirection"] = movePercent > deadband ? "LONG" : movePercent < -deadband ? "SHORT" : "NONE";
  const uncertainty: KronosForecast["uncertainty"] =
    bandWidthPercent === null ? "UNKNOWN" : bandWidthPercent < 0.25 ? "LOW" : bandWidthPercent < 0.75 ? "MEDIUM" : "HIGH";

  return {
    version: "1.0.0", symbol: "XAUUSD", timeframe: requestedTimeframe, status: "LIVE",
    model: payload.model ?? process.env.NINE_KRONOS_MODEL ?? "Kronos-small",
    contextCandles: Number(payload.contextCandles ?? 0),
    horizonCandles: Number(payload.horizonCandles ?? medianPath.length),
    sampleCount: Number(payload.sampleCount ?? 0),
    currentPrice: Number.isFinite(currentPrice) ? currentPrice : null,
    medianFinal, lowFinal, highFinal, expectedDirection, uncertainty, bandWidthPercent,
    timestamps, lowPath, medianPath, highPath,
    latencyMs: Number.isFinite(Number(payload.latencyMs)) ? Number(payload.latencyMs) : null,
    endpoint: process.env.NINE_KRONOS_ENDPOINT ?? null, generatedAt: Date.now(),
    calibrationState: "NOT_CALIBRATED", decisionWeight: 0,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.map(String) : [],
  };
}

async function fetchKronos(market: MarketSnapshot, requestedTimeframe: Timeframe): Promise<KronosForecast> {
  const endpoint = process.env.NINE_KRONOS_ENDPOINT?.trim();
  if (!endpoint) return buildUnavailableKronosForecast(requestedTimeframe, "UNAVAILABLE", [
    "Kronos forecasting service is not configured. Set NINE_KRONOS_ENDPOINT to enable zero-shot XAUUSD forecasting.",
  ]);
  if (market.symbol !== "XAUUSD") return buildUnavailableKronosForecast(requestedTimeframe, "UNAVAILABLE", ["Kronos integration is intentionally XAUUSD-only."]);

  const selected = timeframeForKronos(market, requestedTimeframe);
  const maxContext = process.env.NINE_KRONOS_MODEL === "Kronos-mini" ? 2048 : 512;
  const candles = selected.candles.slice(-maxContext);
  if (candles.length < 60) return buildUnavailableKronosForecast(selected.timeframe, "UNAVAILABLE", [
    `Insufficient ${selected.timeframe} candles for Kronos: ${candles.length}; at least 60 are required.`,
  ]);

  const horizon = Math.max(1, Math.min(Number(process.env.NINE_KRONOS_HORIZON ?? 12), 120));
  const samples = Math.max(1, Math.min(Number(process.env.NINE_KRONOS_SAMPLES ?? 20), 100));
  const timeoutMs = Math.max(5_000, Math.min(Number(process.env.NINE_KRONOS_TIMEOUT_MS ?? 90_000), 180_000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol: "XAUUSD", timeframe: selected.timeframe,
        model: process.env.NINE_KRONOS_MODEL ?? "Kronos-small",
        horizon, sampleCount: samples,
        temperature: Number(process.env.NINE_KRONOS_TEMPERATURE ?? 1.0),
        topP: Number(process.env.NINE_KRONOS_TOP_P ?? 0.9),
        candles: candles.map((c) => ({ timestamp: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume ?? 0 })),
      }),
      signal: controller.signal, cache: "no-store",
    });
    if (!response.ok) return buildUnavailableKronosForecast(selected.timeframe, "ERROR", [`Kronos service HTTP ${response.status}.`]);
    return validateResponse((await response.json()) as KronosServiceResponse, selected.timeframe);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Kronos service error.";
    return buildUnavailableKronosForecast(selected.timeframe, "ERROR", [`Kronos service unavailable: ${message}`]);
  } finally {
    clearTimeout(timer);
  }
}

export async function getKronosForecast(market: MarketSnapshot, timeframe: Timeframe = "5min"): Promise<KronosForecast> {
  const selected = timeframeForKronos(market, timeframe);
  const key = `XAUUSD:${selected.timeframe}:${market.timestamp}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.forecast;
  if (inflight.has(key)) {
    return buildUnavailableKronosForecast(selected.timeframe, "UNAVAILABLE", [
      "Kronos inference is running in the background; the next NINE refresh will consume the completed forecast.",
    ]);
  }

  const request = fetchKronos(market, selected.timeframe);
  inflight.set(key, request);
  void request
    .then((forecast) => {
      cache.set(key, {
        forecast,
        expiresAt: Date.now() + Math.max(2_500, Number(process.env.NINE_KRONOS_CACHE_MS ?? 15_000)),
      });
    })
    .catch(() => {
      // fetchKronos converts inference failures into a structured ERROR forecast.
    })
    .finally(() => {
      inflight.delete(key);
    });

  return buildUnavailableKronosForecast(selected.timeframe, "UNAVAILABLE", [
    "Kronos inference started asynchronously; forecast evidence will appear after the sidecar completes.",
  ]);
}
