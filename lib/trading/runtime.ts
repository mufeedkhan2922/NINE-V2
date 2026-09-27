import { MarketFeedStatus } from "./types";
import { providerHealth, providerName } from "./provider";

export const NINE_VERSION = "3.8.0";

export function liveTradingEnabled(): boolean {
  return (
    process.env.NINE_LIVE_TRADING_ENABLED ===
      "true" &&
    process.env.NINE_LIVE_TRADING_CONFIRMATION ===
      "I_UNDERSTAND_LIVE_TRADING"
  );
}

export function runtimeSafety(): {
  liveTradingEnabled: boolean;
  paperTradingEnabled: boolean;
  brokerConfigured: boolean;
  marketProviderConfigured: boolean;
  environment: string;
  warnings: string[];
} {
  const live =
    liveTradingEnabled();

  const brokerConfigured =
    Boolean(
      process.env
        .BROKER_EXECUTION_WEBHOOK_URL,
    ) &&
    Boolean(
      process.env
        .BROKER_EXECUTION_WEBHOOK_SECRET,
    );

  const marketProviderConfigured =
    Boolean(
      process.env.TWELVE_DATA_API_KEY,
    );

  const warnings: string[] = [];

  if (
    !marketProviderConfigured
  ) {
    warnings.push(
      "TWELVE_DATA_API_KEY is not configured; live market data is unavailable.",
    );
  }

  if (
    !process.env.FINNHUB_API_KEY
  ) {
    warnings.push(
      "FINNHUB_API_KEY is not configured; Atlas news and macro data are unavailable.",
    );
  }

  if (
    process.env
      .NINE_LIVE_TRADING_ENABLED ===
      "true" &&
    process.env
      .NINE_LIVE_TRADING_CONFIRMATION !==
      "I_UNDERSTAND_LIVE_TRADING"
  ) {
    warnings.push(
      "Live trading requested but the explicit safety confirmation is missing; live execution remains locked.",
    );
  }

  if (
    live &&
    !brokerConfigured
  ) {
    warnings.push(
      "Live trading confirmation is present but the broker gateway is incomplete.",
    );
  }

  /*
   * V2.6 hard safety rule:
   * even if the environment requests live trading,
   * the runtime reports live trading as enabled only
   * when BOTH the explicit confirmation and broker
   * gateway are present.
   */
  const effectiveLiveTrading =
    live &&
    brokerConfigured;

  return {
    liveTradingEnabled:
      effectiveLiveTrading,

    paperTradingEnabled:
      true,

    brokerConfigured,

    marketProviderConfigured,

    environment:
      process.env.NODE_ENV ??
      "development",

    warnings,
  };
}

export function marketFeedStatus(
  market: {
    timestamp: number;
    priceSource?: "QUOTE" | "CANDLE";
    tradingAllowed?: boolean;
    marketState?: { dataState?: string; reasons?: string[] };
    providerErrors?: Partial<Record<string, string>>;
    providerWarnings?: Partial<Record<string, string>>;
  } | null,
): MarketFeedStatus {
  const health = providerHealth();
  const configured = health.configured;
  const hardDiagnostics = Object.values(market?.providerErrors ?? {}).filter(Boolean) as string[];
  const softDiagnostics = Object.values(market?.providerWarnings ?? {}).filter(Boolean) as string[];
  const diagnostics = [...hardDiagnostics, ...softDiagnostics];
  if (health.rateLimited && health.cooldownRemainingSeconds > 0) {
    diagnostics.unshift(`${providerName()} rate-limit protection active for ${health.cooldownRemainingSeconds}s.`);
  }
  if (!market) {
    return {
      provider: providerName(), connection: "DISCONNECTED", hasCredentials: configured,
      lastUpdate: null, ageSeconds: null, stale: true, priceSource: "NONE", tradingAllowed: false,
      reason: configured ? "No validated market snapshot is available." : "TWELVE_DATA_API_KEY is missing.",
      diagnostics: [health.lastQuoteError, ...diagnostics].filter(Boolean) as string[],
    };
  }
  const ageSeconds = Math.max(0, (Date.now() - market.timestamp) / 1000);
  const staleThreshold = Number(process.env.NINE_MARKET_STALE_SECONDS ?? 20);
  const stale = ageSeconds > staleThreshold || market.marketState?.dataState === "STALE" || market.marketState?.dataState === "SUSPICIOUS";
  const blockedByProvider = hardDiagnostics.length > 0 || health.rateLimited;
  return {
    provider: providerName(),
    connection: stale || blockedByProvider ? "DEGRADED" : "CONNECTED",
    hasCredentials: configured,
    lastUpdate: market.timestamp,
    ageSeconds,
    stale,
    priceSource: market.priceSource ?? "NONE",
    tradingAllowed: Boolean(market.tradingAllowed) && !stale && !blockedByProvider,
    reason: stale ? "Market data is stale or failed freshness validation." : health.rateLimited ? `Provider request protection is active for ${health.cooldownRemainingSeconds}s.` : blockedByProvider ? "One or more required market feeds failed validation." : "Validated market snapshot is available.",
    diagnostics: [health.lastQuoteError, ...diagnostics].filter(Boolean) as string[],
  };
}

export function runtimeDiagnostics() {
  const safety = runtimeSafety();
  const provider = providerHealth();
  return {
    version: NINE_VERSION,
    provider: {
      ...provider,
      quoteEndpointEnabled: process.env.NINE_MARKET_USE_QUOTE === "true",
    },
    atlasConfigured: Boolean(process.env.FINNHUB_API_KEY),
    brokerConfigured: safety.brokerConfigured,
    paperTradingEnabled: safety.paperTradingEnabled,
    liveTradingEnabled: safety.liveTradingEnabled,
    warnings: safety.warnings,
    environment: safety.environment,
  };
}
