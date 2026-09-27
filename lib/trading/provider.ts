import { Candle, MarketSymbol, Timeframe } from "./types";

export type ProviderQuote = {
  symbol: MarketSymbol;
  price: number;
  timestamp: number;
};

export type ProviderSnapshot = {
  provider: string;
  symbol: MarketSymbol;
  timeframes: Partial<Record<Timeframe, Candle[]>>;
  quote: ProviderQuote | null;
  fetchedAt: number;
};

export type ProviderHealth = {
  configured: boolean;
  provider: string;
  symbolMappings: Record<MarketSymbol, string>;
  quoteCacheAgeSeconds: number | null;
  lastQuoteAt: number | null;
  lastQuoteError: string | null;
  lastError: string | null;
  lastRequestAt: number | null;
  requestsLastMinute: number;
  requestBudgetPerMinute: number;
  rateLimited: boolean;
  cooldownRemainingSeconds: number;
  apiCreditsUsed: number | null;
  apiCreditsLeft: number | null;
  apiCreditsLimit: number | null;
  lastCreditSampleAt: number | null;
};

const BASE_URL = "https://api.twelvedata.com";
const PROVIDER = "Twelve Data";

const SYMBOLS: Record<MarketSymbol, string> = {
  XAUUSD: process.env.NINE_TWELVE_XAUUSD_SYMBOL ?? "XAU/USD",
  NIFTY: process.env.NINE_TWELVE_NIFTY_SYMBOL ?? "NIFTY:NSE",
  BANKNIFTY: process.env.NINE_TWELVE_BANKNIFTY_SYMBOL ?? "NIFTY BANK:NSE",
};

const TIMEOUT_MS = Math.max(3000, Math.min(Number(process.env.NINE_MARKET_TIMEOUT_MS ?? 7000), 15000));
const QUOTE_CACHE_MS = Math.max(5000, Math.min(Number(process.env.NINE_QUOTE_CACHE_MS ?? 30000), 120000));
const REQUEST_BUDGET_PER_MINUTE = Math.max(2, Math.min(Number(process.env.NINE_PROVIDER_MAX_REQUESTS_PER_MINUTE ?? 7), 60));
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

type ProviderRuntimeState = {
  quoteCache: Map<MarketSymbol, ProviderQuote>;
  quoteInFlight: Map<MarketSymbol, Promise<ProviderQuote>>;
  candleInFlight: Map<string, Promise<Candle[]>>;
  requestTimestamps: number[];
  cooldownUntil: number;
  lastQuoteError: string | null;
  lastError: string | null;
  lastRequestAt: number | null;
  apiCreditsUsed: number | null;
  apiCreditsLeft: number | null;
  apiCreditsLimit: number | null;
  lastCreditSampleAt: number | null;
};

const globalProvider = globalThis as typeof globalThis & {
  __nineProviderState?: ProviderRuntimeState;
};

const state: ProviderRuntimeState = globalProvider.__nineProviderState ?? {
  quoteCache: new Map(),
  quoteInFlight: new Map(),
  candleInFlight: new Map(),
  requestTimestamps: [],
  cooldownUntil: 0,
  lastQuoteError: null,
  lastError: null,
  lastRequestAt: null,
  apiCreditsUsed: null,
  apiCreditsLeft: null,
  apiCreditsLimit: null,
  lastCreditSampleAt: null,
};
globalProvider.__nineProviderState = state;

function assertApiKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!key) throw new Error("TWELVE_DATA_API_KEY is missing.");
  return key;
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

function now(): number {
  return Date.now();
}

function cleanRequestHistory(timestamp = now()): void {
  const cutoff = timestamp - 60_000;
  state.requestTimestamps = state.requestTimestamps.filter((value) => value > cutoff);
}

function cooldownSeconds(timestamp = now()): number {
  return Math.max(0, Math.ceil((state.cooldownUntil - timestamp) / 1000));
}

export function providerCooldownRemainingSeconds(): number {
  return cooldownSeconds();
}

export function isProviderRateLimitedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /HTTP 429|rate limit|too many requests|local provider request budget/i.test(message);
}

function reserveRequest(label: string): void {
  const timestamp = now();
  cleanRequestHistory(timestamp);
  const cooldown = cooldownSeconds(timestamp);
  if (cooldown > 0) {
    throw new Error(`${PROVIDER} request cooldown active for ${cooldown}s. ${label} is temporarily paused.`);
  }

  if (state.apiCreditsLeft !== null && state.apiCreditsLeft <= 0) {
    throw new Error(PROVIDER + " API credit quota exhausted. Retry after the provider minute resets.");
  }

  if (state.requestTimestamps.length >= REQUEST_BUDGET_PER_MINUTE) {
    const oldest = state.requestTimestamps[0] ?? timestamp;
    const retryAfter = Math.max(1, Math.ceil((oldest + 60_000 - timestamp) / 1000));
    throw new Error(`${PROVIDER} local request budget reached. Retry in ${retryAfter}s.`);
  }

  state.requestTimestamps.push(timestamp);
  state.lastRequestAt = timestamp;
}

function recordCreditHeaders(response: Response): void {
  const usedRaw = response.headers.get("api-credits-used");
  const leftRaw = response.headers.get("api-credits-left");
  const used = usedRaw == null ? null : Number(usedRaw);
  const left = leftRaw == null ? null : Number(leftRaw);

  if (used !== null && Number.isFinite(used)) state.apiCreditsUsed = used;
  if (left !== null && Number.isFinite(left)) state.apiCreditsLeft = left;
  if (state.apiCreditsUsed !== null && state.apiCreditsLeft !== null) {
    state.apiCreditsLimit = state.apiCreditsUsed + state.apiCreditsLeft;
  }
  if (used !== null || left !== null) state.lastCreditSampleAt = now();
}

function applyRateLimit(response: Response): never {
  const retryAfterHeader = Number(response.headers.get("retry-after") ?? "");
  const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
    ? Math.min(retryAfterHeader * 1000, 5 * 60_000)
    : DEFAULT_RATE_LIMIT_COOLDOWN_MS;
  state.cooldownUntil = Math.max(state.cooldownUntil, now() + retryAfterMs);
  const seconds = cooldownSeconds();
  const message = `${PROVIDER} HTTP 429: too many requests. Provider cooldown ${seconds}s.`;
  state.lastError = message;
  throw new Error(message);
}

function convertCandle(value: unknown): Candle {
  const row = value as Record<string, unknown>;
  const datetime = String(row.datetime ?? "");
  const parsed = Date.parse(/Z$|[+-]\d\d:\d\d$/.test(datetime) ? datetime : `${datetime} UTC`);
  return {
    time: Number.isFinite(parsed) ? parsed : Number.NaN,
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume == null ? undefined : Number(row.volume),
  };
}

function validateCandle(candle: Candle): boolean {
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high);
}

async function fetchCandlesUncached(symbol: MarketSymbol, timeframe: Timeframe, outputsize: number): Promise<Candle[]> {
  const key = assertApiKey();
  reserveRequest(`${symbol} ${timeframe} history`);
  const url = new URL(`${BASE_URL}/time_series`);
  url.searchParams.set("symbol", SYMBOLS[symbol]);
  url.searchParams.set("interval", timeframe);
  url.searchParams.set("outputsize", String(Math.max(40, Math.min(outputsize, 5000))));
  url.searchParams.set("order", "ASC");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", key);

  try {
    const response = await fetch(url, { cache: "no-store", signal: timeoutSignal() });
    recordCreditHeaders(response);
    if (response.status === 429) applyRateLimit(response);
    if (!response.ok) throw new Error(`${PROVIDER} ${symbol} ${timeframe} HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload?.status === "error") throw new Error(String(payload.message ?? `${PROVIDER} returned an error.`));
    if (!Array.isArray(payload?.values)) throw new Error(`No ${timeframe} candles returned for ${symbol}.`);

    const candles = payload.values.map(convertCandle).filter(validateCandle).sort((a: Candle, b: Candle) => a.time - b.time);
    if (candles.length < Math.min(20, outputsize)) throw new Error(`Insufficient validated ${timeframe} candles for ${symbol}.`);
    state.lastError = null;
    return candles;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "Unknown provider history error.";
    throw error;
  }
}

export async function fetchProviderHistoricalCandles(
  symbol: MarketSymbol,
  timeframe: Timeframe,
  startDate: string,
  endDate: string,
): Promise<Candle[]> {
  const key = assertApiKey();
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error("Historical backtest dates must be valid ISO dates.");
  }
  if (start >= end) {
    throw new Error("Historical backtest startDate must be before endDate.");
  }

  reserveRequest(`${symbol} ${timeframe} historical range`);
  const url = new URL(`${BASE_URL}/time_series`);
  url.searchParams.set("symbol", SYMBOLS[symbol]);
  url.searchParams.set("interval", timeframe);
  url.searchParams.set("start_date", startDate.slice(0, 10));
  url.searchParams.set("end_date", endDate.slice(0, 10));
  url.searchParams.set("order", "ASC");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", key);

  try {
    const response = await fetch(url, { cache: "no-store", signal: timeoutSignal() });
    recordCreditHeaders(response);
    if (response.status === 429) applyRateLimit(response);
    if (!response.ok) throw new Error(`${PROVIDER} historical ${symbol} ${timeframe} HTTP ${response.status}.`);
    const payload = await response.json();
    if (payload?.status === "error") throw new Error(String(payload.message ?? `${PROVIDER} returned an error.`));
    if (!Array.isArray(payload?.values)) throw new Error(`No historical ${timeframe} candles returned for ${symbol}.`);

    const candles = payload.values
      .map(convertCandle)
      .filter(validateCandle)
      .sort((a: Candle, b: Candle) => a.time - b.time);

    if (candles.length < 40) {
      throw new Error(`Insufficient validated historical ${timeframe} candles for ${symbol}: ${candles.length}.`);
    }

    state.lastError = null;
    return candles;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : "Unknown historical provider error.";
    throw error;
  }
}

export async function fetchProviderCandles(symbol: MarketSymbol, timeframe: Timeframe, outputsize: number): Promise<Candle[]> {
  const normalizedSize = Math.max(40, Math.min(outputsize, 5000));
  const requestKey = `${symbol}:${timeframe}:${normalizedSize}`;
  const existing = state.candleInFlight.get(requestKey);
  if (existing) return existing;

  const request = fetchCandlesUncached(symbol, timeframe, normalizedSize)
    .finally(() => state.candleInFlight.delete(requestKey));
  state.candleInFlight.set(requestKey, request);
  return request;
}

async function fetchProviderQuoteUncached(symbol: MarketSymbol): Promise<ProviderQuote> {
  const key = assertApiKey();
  reserveRequest(`${symbol} quote`);
  const url = new URL(`${BASE_URL}/price`);
  url.searchParams.set("symbol", SYMBOLS[symbol]);
  url.searchParams.set("apikey", key);
  try {
    const response = await fetch(url, { cache: "no-store", signal: timeoutSignal() });
    recordCreditHeaders(response);
    if (response.status === 429) applyRateLimit(response);
    if (!response.ok) throw new Error(`${PROVIDER} quote ${symbol} HTTP ${response.status}.`);
    const payload = await response.json();
    const price = Number(payload?.price);
    if (!Number.isFinite(price) || price <= 0) throw new Error(`${PROVIDER} returned an invalid ${symbol} quote.`);
    const quote = { symbol, price, timestamp: now() } satisfies ProviderQuote;
    state.quoteCache.set(symbol, quote);
    state.lastQuoteError = null;
    state.lastError = null;
    return quote;
  } catch (error) {
    state.lastQuoteError = error instanceof Error ? error.message : "Unknown quote error.";
    state.lastError = state.lastQuoteError;
    throw error;
  }
}

export async function fetchProviderQuote(symbol: MarketSymbol): Promise<ProviderQuote> {
  const cached = state.quoteCache.get(symbol);
  if (cached && now() - cached.timestamp <= QUOTE_CACHE_MS) return cached;

  const existing = state.quoteInFlight.get(symbol);
  if (existing) return existing;

  const request = fetchProviderQuoteUncached(symbol)
    .finally(() => state.quoteInFlight.delete(symbol));
  state.quoteInFlight.set(symbol, request);
  return request;
}

export function providerName(): string { return PROVIDER; }
export function providerSymbol(symbol: MarketSymbol): string { return SYMBOLS[symbol]; }

export function providerHealth(): ProviderHealth {
  const timestamp = now();
  cleanRequestHistory(timestamp);
  const latest = [...state.quoteCache.values()].sort((a, b) => b.timestamp - a.timestamp)[0];
  return {
    configured: Boolean(process.env.TWELVE_DATA_API_KEY),
    provider: PROVIDER,
    symbolMappings: { ...SYMBOLS },
    quoteCacheAgeSeconds: latest ? Math.max(0, (timestamp - latest.timestamp) / 1000) : null,
    lastQuoteAt: latest?.timestamp ?? null,
    lastQuoteError: state.lastQuoteError,
    lastError: state.lastError,
    lastRequestAt: state.lastRequestAt,
    requestsLastMinute: state.requestTimestamps.length,
    requestBudgetPerMinute: REQUEST_BUDGET_PER_MINUTE,
    rateLimited: cooldownSeconds(timestamp) > 0,
    cooldownRemainingSeconds: cooldownSeconds(timestamp),
    apiCreditsUsed: state.apiCreditsUsed,
    apiCreditsLeft: state.apiCreditsLeft,
    apiCreditsLimit: state.apiCreditsLimit,
    lastCreditSampleAt: state.lastCreditSampleAt,
  };
}
