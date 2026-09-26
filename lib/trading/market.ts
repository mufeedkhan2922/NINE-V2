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
import { fetchProviderCandles, fetchProviderQuote } from "./provider";

const globalCache = globalThis as typeof globalThis & { __nineTimeframeCache?: Map<string, { data: TimeframeData; expiresAt: number }> };
const cache = globalCache.__nineTimeframeCache ?? new Map<string, { data: TimeframeData; expiresAt: number }>();
globalCache.__nineTimeframeCache = cache;

function ttl(timeframe: Timeframe): number {
  return ({ "1min": 30_000, "5min": 45_000, "15min": 90_000, "1h": 180_000, "4h": 300_000, "1day": 900_000 })[timeframe];
}

function outputSize(timeframe: Timeframe): number {
  return timeframe === "1day" ? 40 : 120;
}

function buildTimeframe(timeframe: Timeframe, candles: Candle[]): TimeframeData {
  const latest = candles.at(-1)!;
  const previous = candles.at(-2) ?? latest;
  const previousClose = previous.close;
  return {
    timeframe,
    candles,
    latestPrice: latest.close,
    previousClose,
    changePercent: previousClose ? ((latest.close - previousClose) / previousClose) * 100 : 0,
    updatedAt: Date.now(),
  };
}

async function getTimeframeData(symbol: MarketSymbol, timeframe: Timeframe): Promise<TimeframeData> {
  const key = `${symbol}:${timeframe}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  const data = buildTimeframe(timeframe, await fetchProviderCandles(symbol, timeframe, outputSize(timeframe)));
  cache.set(key, { data, expiresAt: Date.now() + ttl(timeframe) });
  return data;
}

export async function getLiveMarketSnapshot(symbol: MarketSymbol): Promise<MarketSnapshot> {
  const timeframesList = await Promise.all(
    (["1min", "5min", "15min", "1h", "4h", "1day"] as Timeframe[]).map(async (timeframe) => [timeframe, await getTimeframeData(symbol, timeframe)] as const),
  );
  const timeframes = Object.fromEntries(timeframesList) as Partial<Record<Timeframe, TimeframeData>>;
  const oneMinute = timeframes["1min"]!;
  const daily = timeframes["1day"]!;
  const previousDay = daily.candles.at(-2);
  if (!previousDay) throw new Error("Not enough daily candles to calculate previous-day levels.");

  let quotePrice: number | null = null;
  try {
    quotePrice = (await fetchProviderQuote(symbol)).price;
  } catch {
    quotePrice = null;
  }

  const latestPrice = quotePrice ?? oneMinute.latestPrice;
  const dataQuality: Partial<Record<Timeframe, DataQualityResult>> = {};
  for (const timeframe of ["1min", "5min", "15min", "1h", "4h", "1day"] as Timeframe[]) {
    const candles = timeframes[timeframe]?.candles ?? [];
    dataQuality[timeframe] = validateCandleData(candles, timeframe);
  }

  const crossTimeframeValidation: CrossTimeframeResult = validateCrossTimeframes(timeframes);
  const microstructureValidation = validateMicrostructure(oneMinute.candles);
  const marketState = assessMarketAndDataState(symbol, timeframes, dataQuality, crossTimeframeValidation, microstructureValidation);
  const structuralQualityValid = Object.values(dataQuality).every((item) => item?.valid === true);
  const tradingAllowed = structuralQualityValid && crossTimeframeValidation.valid && microstructureValidation.valid && marketState.tradingPermission === "ALLOWED";

  return {
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
  };
}
