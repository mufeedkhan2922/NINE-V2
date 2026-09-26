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

const BASE_URL = "https://api.twelvedata.com";
const PROVIDER = "Twelve Data";

const SYMBOLS: Record<MarketSymbol, string> = {
  XAUUSD: process.env.NINE_TWELVE_XAUUSD_SYMBOL ?? "XAU/USD",
  NIFTY: process.env.NINE_TWELVE_NIFTY_SYMBOL ?? "NIFTY",
  BANKNIFTY: process.env.NINE_TWELVE_BANKNIFTY_SYMBOL ?? "BANKNIFTY",
};

const TIMEOUT_MS = Math.max(2000, Math.min(Number(process.env.NINE_MARKET_TIMEOUT_MS ?? 7000), 15000));

function assertApiKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY?.trim();
  if (!key) throw new Error("TWELVE_DATA_API_KEY is missing.");
  return key;
}

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

function convertCandle(value: any): Candle {
  return {
    time: new Date(`${String(value.datetime)} UTC`).getTime(),
    open: Number(value.open),
    high: Number(value.high),
    low: Number(value.low),
    close: Number(value.close),
    volume: value.volume == null ? undefined : Number(value.volume),
  };
}

function validateCandle(candle: Candle): boolean {
  return [candle.time, candle.open, candle.high, candle.low, candle.close].every(Number.isFinite) &&
    candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0 &&
    candle.high >= Math.max(candle.open, candle.close, candle.low) &&
    candle.low <= Math.min(candle.open, candle.close, candle.high);
}

export async function fetchProviderCandles(symbol: MarketSymbol, timeframe: Timeframe, outputsize: number): Promise<Candle[]> {
  const key = assertApiKey();
  const url = new URL(`${BASE_URL}/time_series`);
  url.searchParams.set("symbol", SYMBOLS[symbol]);
  url.searchParams.set("interval", timeframe);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("order", "ASC");
  url.searchParams.set("timezone", "UTC");
  url.searchParams.set("apikey", key);

  const response = await fetch(url, { cache: "no-store", signal: timeoutSignal() });
  if (!response.ok) throw new Error(`${PROVIDER} HTTP ${response.status}.`);
  const payload = await response.json();
  if (payload?.status === "error") throw new Error(String(payload.message ?? `${PROVIDER} returned an error.`));
  if (!Array.isArray(payload?.values)) throw new Error(`No ${timeframe} candles returned for ${symbol}.`);

  const candles = payload.values.map(convertCandle).filter(validateCandle);
  if (candles.length < Math.min(20, outputsize)) throw new Error(`Insufficient validated ${timeframe} candles for ${symbol}.`);
  return candles;
}

export async function fetchProviderQuote(symbol: MarketSymbol): Promise<ProviderQuote> {
  const key = assertApiKey();
  const url = new URL(`${BASE_URL}/price`);
  url.searchParams.set("symbol", SYMBOLS[symbol]);
  url.searchParams.set("apikey", key);
  const response = await fetch(url, { cache: "no-store", signal: timeoutSignal() });
  if (!response.ok) throw new Error(`${PROVIDER} quote HTTP ${response.status}.`);
  const payload = await response.json();
  const price = Number(payload?.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${PROVIDER} returned an invalid quote.`);
  return { symbol, price, timestamp: Date.now() };
}

export function providerName(): string {
  return PROVIDER;
}

export function providerSymbol(symbol: MarketSymbol): string {
  return SYMBOLS[symbol];
}
