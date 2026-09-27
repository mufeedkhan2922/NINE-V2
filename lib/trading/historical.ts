import { fetchProviderHistoricalCandles } from "./provider";
import { validateCandleData } from "./dataQuality";
import type { Candle, MarketSymbol, Timeframe } from "./types";

export interface HistoricalBacktestDataset {
  symbol: MarketSymbol;
  timeframe: Timeframe;
  startDate: string;
  endDate: string;
  candles: Candle[];
  source: "HISTORICAL_PROVIDER";
  fetchedAt: number;
  quality: ReturnType<typeof validateCandleData>;
}

export function normalizeHistoricalDate(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Historical dates must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${trimmed}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed) {
    throw new Error(`Invalid historical date: ${value}.`);
  }
  return trimmed;
}

export async function fetchHistoricalBacktestDataset(
  symbol: MarketSymbol,
  timeframe: Timeframe,
  startDate: string,
  endDate: string,
): Promise<HistoricalBacktestDataset> {
  const start = normalizeHistoricalDate(startDate);
  const end = normalizeHistoricalDate(endDate);
  if (start >= end) {
    throw new Error("Historical backtest startDate must be before endDate.");
  }

  const candles = await fetchProviderHistoricalCandles(symbol, timeframe, start, end);
  const quality = validateCandleData(candles, timeframe);
  if (!quality.valid) {
    throw new Error(
      `Historical dataset failed validation for ${symbol} ${timeframe}: ${quality.issues.join("; ")}`,
    );
  }

  return {
    symbol,
    timeframe,
    startDate: start,
    endDate: end,
    candles,
    source: "HISTORICAL_PROVIDER",
    fetchedAt: Date.now(),
    quality,
  };
}
