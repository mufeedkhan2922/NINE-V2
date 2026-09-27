import {
  Candle,
  CrossTimeframeResult,
  DataQualityResult,
  MarketSnapshot,
  MarketSymbol,
  Timeframe,
  TimeframeData,
} from "./types";
import { validateCandleData } from "./dataQuality";
import { validateCrossTimeframes } from "./crossTimeframe";
import { validateMicrostructure } from "./microstructure";
import { assessMarketAndDataState } from "./marketState";
import {
  fetchProviderCandles,
  fetchProviderQuote,
  providerCooldownRemainingSeconds,
  providerHealth,
} from "./provider";

const globalCache = globalThis as typeof globalThis & {
  __nineTimeframeCache?: Map<string, { data: TimeframeData; expiresAt: number }>;
  __nineTimeframeInFlight?: Map<string, Promise<TimeframeData>>;
  __nineSnapshotCache?: Map<MarketSymbol, { data: MarketSnapshot; expiresAt: number }>;
  __nineSnapshotInFlight?: Map<MarketSymbol, Promise<MarketSnapshot>>;
};

const cache = globalCache.__nineTimeframeCache ?? new Map<string, { data: TimeframeData; expiresAt: number }>();
globalCache.__nineTimeframeCache = cache;
const timeframeInFlight = globalCache.__nineTimeframeInFlight ?? new Map<string, Promise<TimeframeData>>();
globalCache.__nineTimeframeInFlight = timeframeInFlight;
const snapshotCache = globalCache.__nineSnapshotCache ?? new Map<MarketSymbol, { data: MarketSnapshot; expiresAt: number }>();
globalCache.__nineSnapshotCache = snapshotCache;
const snapshotInFlight = globalCache.__nineSnapshotInFlight ?? new Map<MarketSymbol, Promise<MarketSnapshot>>();
globalCache.__nineSnapshotInFlight = snapshotInFlight;

function ttl(timeframe: Timeframe): number {
  return ({
    "1min": 30_000,
    "5min": 60_000,
    "15min": 120_000,
    "1h": 300_000,
    "4h": 600_000,
    "1day": 1_800_000,
  })[timeframe];
}

function outputSize(timeframe: Timeframe): number {
  const configured = Number(process.env.NINE_MARKET_OUTPUTSIZE ?? 240);
  return timeframe === "1day" ? Math.max(40, Math.min(configured, 365)) : Math.max(120, Math.min(configured, 5000));
}

function buildTimeframe(timeframe: Timeframe, candles: Candle[], source: "PROVIDER" | "CACHE" = "PROVIDER", providerError?: string): TimeframeData {
  const latest = candles.at(-1);
  if (!latest) throw new Error(`No candles available for ${timeframe}.`);
  const previous = candles.at(-2) ?? latest;
  const previousClose = previous.close;
  return {
    timeframe,
    candles,
    latestPrice: latest.close,
    previousClose,
    changePercent: previousClose ? ((latest.close - previousClose) / previousClose) * 100 : 0,
    updatedAt: Date.now(),
    source,
    providerError,
  };
}

async function getTimeframeData(symbol: MarketSymbol, timeframe: Timeframe): Promise<TimeframeData> {
  const key = `${symbol}:${timeframe}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const existing = timeframeInFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const data = buildTimeframe(
        timeframe,
        await fetchProviderCandles(symbol, timeframe, outputSize(timeframe)),
        "PROVIDER",
      );
      cache.set(key, { data, expiresAt: Date.now() + ttl(timeframe) });
      return data;
    } catch (error) {
      if (cached?.data.candles.length) {
        const message = error instanceof Error ? error.message : "Provider error.";
        const cooldown = providerCooldownRemainingSeconds() * 1000;
        const staleHold = Math.max(10_000, cooldown);
        const stale = { ...cached.data, source: "CACHE" as const, providerError: message };
        cache.set(key, { data: stale, expiresAt: Date.now() + staleHold });
        return stale;
      }
      throw error;
    }
  })().finally(() => timeframeInFlight.delete(key));

  timeframeInFlight.set(key, request);
  return request;
}

export async function getBacktestCandles(symbol: MarketSymbol, timeframe: Timeframe = "1min"): Promise<{ candles: Candle[]; source: "CACHE" | "PROVIDER" }> {
  const key = `${symbol}:${timeframe}`;
  const cached = cache.get(key);
  const minimum = Math.max(40, Number(process.env.NINE_BACKTEST_MIN_CANDLES ?? 120));
  const desired = Math.max(minimum, Math.min(Number(process.env.NINE_BACKTEST_OUTPUTSIZE ?? 500), 5000));

  // A validated live dataset is sufficient to run the replay locally. Do not spend
  // another provider request merely to increase the candle count when the provider
  // is rate-limited.
  if (cached?.data.candles.length && cached.data.candles.length >= minimum) {
    if (cached.data.candles.length >= desired || providerCooldownRemainingSeconds() > 0) {
      return { candles: cached.data.candles, source: "CACHE" };
    }
  }

  try {
    const candles = await fetchProviderCandles(symbol, timeframe, desired);
    cache.set(key, { data: buildTimeframe(timeframe, candles), expiresAt: Date.now() + ttl(timeframe) });
    return { candles, source: "PROVIDER" };
  } catch (error) {
    if (cached?.data.candles.length && cached.data.candles.length >= minimum) {
      return { candles: cached.data.candles, source: "CACHE" };
    }
    throw error;
  }
}

async function buildLiveMarketSnapshot(symbol: MarketSymbol): Promise<MarketSnapshot> {
  const requested: Timeframe[] = ["1min", "5min", "15min", "1h", "4h", "1day"];
  const settled = await Promise.all(requested.map(async (timeframe) => {
    try { return { timeframe, data: await getTimeframeData(symbol, timeframe) } as const; }
    catch (error) { return { timeframe, error: error instanceof Error ? error.message : "Unknown provider error." } as const; }
  }));

  const timeframes = Object.fromEntries(settled.filter((item) => "data" in item).map((item) => [item.timeframe, item.data])) as Partial<Record<Timeframe, TimeframeData>>;
  const providerErrors = Object.fromEntries(
    settled
      .filter((item) => "error" in item)
      .map((item) => [item.timeframe, item.error]),
  ) as Partial<Record<Timeframe, string>>;
  const providerWarnings: Partial<Record<Timeframe, string>> = {};
  for (const item of settled) {
    if ("data" in item && item.data.providerError) {
      providerWarnings[item.timeframe] = item.data.providerError;
    }
  }
  const oneMinute = timeframes["1min"];
  const daily = timeframes["1day"];
  if (!oneMinute || !daily || !daily.candles.at(-2)) {
    throw new Error(Object.values(providerErrors)[0] ?? `Validated market history is unavailable for ${symbol}.`);
  }
  const previousDay = daily.candles.at(-2)!;

  let quotePrice: number | null = null;
  const useQuoteEndpoint = process.env.NINE_MARKET_USE_QUOTE === "true";
  if (useQuoteEndpoint) {
    try { quotePrice = (await fetchProviderQuote(symbol)).price; } catch { quotePrice = null; }
  }

  const latestPrice = quotePrice ?? oneMinute.latestPrice;
  const dataQuality: Partial<Record<Timeframe, DataQualityResult>> = {};
  for (const timeframe of requested) {
    const candles = timeframes[timeframe]?.candles ?? [];
    if (candles.length) dataQuality[timeframe] = validateCandleData(candles, timeframe);
  }
  const crossTimeframeValidation: CrossTimeframeResult = validateCrossTimeframes(timeframes);
  const microstructureValidation = validateMicrostructure(oneMinute.candles);
  const marketState = assessMarketAndDataState(symbol, timeframes, dataQuality, crossTimeframeValidation, microstructureValidation);
  const requiredQuality = requested.filter((tf) => tf !== "1day").every((tf) => dataQuality[tf]?.valid === true);
  const structuralQualityValid = requiredQuality && dataQuality["1day"]?.valid === true;
  const provider = providerHealth();
  const tradingAllowed = structuralQualityValid && !provider.rateLimited && Object.keys(providerErrors).length === 0 && crossTimeframeValidation.valid && microstructureValidation.valid && marketState.tradingPermission === "ALLOWED";

  const snapshot: MarketSnapshot = {
    symbol,
    price: latestPrice,
    previousClose: previousDay.close,
    changePercent: previousDay.close ? ((latestPrice - previousDay.close) / previousDay.close) * 100 : 0,
    candles: oneMinute.candles,
    timestamp: Date.now(),
    timeframes,
    previousDayHigh: previousDay.high,
    previousDayLow: previousDay.low,
    previousDayClose: previousDay.close,
    dataQuality,
    crossTimeframeValidation,
    microstructureValidation,
    marketState,
    tradingAllowed,
    priceSource: quotePrice !== null ? "QUOTE" : "CANDLE",
    providerErrors,
    providerWarnings,
  };
  return snapshot;
}

export async function getLiveMarketSnapshot(symbol: MarketSymbol): Promise<MarketSnapshot> {
  const snapshotTtl = Math.max(10_000, Math.min(Number(process.env.NINE_SNAPSHOT_CACHE_MS ?? 15_000), 60_000));
  const cachedSnapshot = snapshotCache.get(symbol);
  if (cachedSnapshot && cachedSnapshot.expiresAt > Date.now()) return cachedSnapshot.data;

  const existing = snapshotInFlight.get(symbol);
  if (existing) return existing;

  const request = buildLiveMarketSnapshot(symbol)
    .then((snapshot) => {
      snapshotCache.set(symbol, { data: snapshot, expiresAt: Date.now() + snapshotTtl });
      return snapshot;
    })
    .finally(() => snapshotInFlight.delete(symbol));

  snapshotInFlight.set(symbol, request);
  return request;
}
