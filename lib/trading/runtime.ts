import { MarketFeedStatus } from "./types";

export const NINE_VERSION = "2.4.0";

export function liveTradingEnabled(): boolean {
  return process.env.NINE_LIVE_TRADING_ENABLED === "true";
}

export function runtimeSafety(): {
  liveTradingEnabled: boolean;
  paperTradingEnabled: boolean;
  brokerConfigured: boolean;
  environment: string;
  warnings: string[];
} {
  const live = liveTradingEnabled();
  const brokerConfigured =
    Boolean(process.env.BROKER_EXECUTION_WEBHOOK_URL) &&
    Boolean(process.env.BROKER_EXECUTION_WEBHOOK_SECRET);

  const warnings: string[] = [];

  if (!process.env.TWELVE_DATA_API_KEY) {
    warnings.push("TWELVE_DATA_API_KEY is not configured.");
  }

  if (!process.env.FINNHUB_API_KEY) {
    warnings.push("FINNHUB_API_KEY is not configured; Atlas news/macro data will be limited.");
  }

  if (live && !brokerConfigured) {
    warnings.push("Live trading is enabled but the broker gateway is not completely configured.");
  }

  return {
    liveTradingEnabled: live,
    paperTradingEnabled: true,
    brokerConfigured,
    environment: process.env.NODE_ENV ?? "development",
    warnings,
  };
}

export function marketFeedStatus(
  market: {
    timestamp: number;
    priceSource?: "QUOTE" | "CANDLE";
    tradingAllowed?: boolean;
    marketState?: { dataState?: string };
  } | null,
): MarketFeedStatus {
  const configured = Boolean(process.env.TWELVE_DATA_API_KEY);

  if (!market) {
    return {
      provider: "Twelve Data",
      connection: configured ? "DISCONNECTED" : "DISCONNECTED",
      hasCredentials: configured,
      lastUpdate: null,
      ageSeconds: null,
      stale: true,
      priceSource: "NONE",
      tradingAllowed: false,
      reason: configured
        ? "No validated market snapshot is available."
        : "TWELVE_DATA_API_KEY is missing.",
    };
  }

  const ageSeconds = Math.max(
    0,
    (Date.now() - market.timestamp) / 1000,
  );
  const stale =
    ageSeconds > 15 ||
    market.marketState?.dataState === "STALE" ||
    market.marketState?.dataState === "SUSPICIOUS";

  const connection: MarketFeedStatus["connection"] =
    stale
      ? "DEGRADED"
      : "CONNECTED";

  return {
    provider: "Twelve Data",
    connection,
    hasCredentials: configured,
    lastUpdate: market.timestamp,
    ageSeconds,
    stale,
    priceSource: market.priceSource ?? "NONE",
    tradingAllowed: Boolean(market.tradingAllowed) && !stale,
    reason: stale
      ? "Market data is stale or failed freshness validation."
      : "Validated market snapshot is available.",
  };
}
