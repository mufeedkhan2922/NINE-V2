import {
  Candle,
  CrossTimeframeResult,
  DataQualityResult,
  MarketSnapshot,
  MarketSymbol,
  Timeframe,
  TimeframeData,
} from "./types";

import {
  validateCandleData,
} from "./dataQuality";

import {
  validateCrossTimeframes,
} from "./crossTimeframe";

import {
  validateMicrostructure,
} from "./microstructure";

import {
  assessMarketAndDataState,
} from "./marketState";

const TWELVE_DATA_URL = "https://api.twelvedata.com/time_series";
const TWELVE_QUOTE_URL = "https://api.twelvedata.com/price";

type CacheEntry = {
  data: TimeframeData;
  expiresAt: number;
};

const globalCache =
  globalThis as typeof globalThis & {
    __nineTimeframeCache?: Map<
      string,
      CacheEntry
    >;
  };

const cache =
  globalCache.__nineTimeframeCache ??
  new Map<string, CacheEntry>();

globalCache.__nineTimeframeCache =
  cache;

let quoteCache: { price: number; expiresAt: number } | null = null;

async function getLiveQuote(symbol: MarketSymbol): Promise<number | null> {
  if (quoteCache && quoteCache.expiresAt > Date.now()) return quoteCache.price;
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return null;
  const url = new URL(TWELVE_QUOTE_URL);
  url.searchParams.set("symbol", getTwelveDataSymbol(symbol));
  url.searchParams.set("apikey", apiKey);
  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json();
    const price = Number(data.price);
    if (!Number.isFinite(price) || price <= 0) return null;
    quoteCache = { price, expiresAt: Date.now() + 2000 };
    return price;
  } catch { return null; }
}

function getTwelveDataSymbol(
  symbol: MarketSymbol
): string {
  switch (symbol) {
    case "XAUUSD":
      return "XAU/USD";

    default:
      throw new Error(
        `Unsupported market symbol: ${symbol}`
      );
  }
}

function getCacheTTL(
  timeframe: Timeframe
): number {
  switch (timeframe) {
    case "1min":
      return 45_000;

    case "5min":
      return 60_000;

    case "15min":
      return 120_000;

    case "1h":
      return 300_000;

    case "4h":
      return 600_000;

    case "1day":
      return 3_600_000;

    default:
      return 60_000;
  }
}

function getOutputSize(
  timeframe: Timeframe
): number {
  switch (timeframe) {
    case "1min":
      return 100;

    case "5min":
      return 100;

    case "15min":
      return 100;

    case "1h":
      return 100;

    case "4h":
      return 100;

    case "1day":
      return 20;

    default:
      return 100;
  }
}

function convertCandle(
  value: {
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }
): Candle {
  return {
    time: new Date(
      `${value.datetime} UTC`
    ).getTime(),

    open: Number(
      value.open
    ),

    high: Number(
      value.high
    ),

    low: Number(
      value.low
    ),

    close: Number(
      value.close
    ),

    volume:
      value.volume !==
      undefined
        ? Number(
            value.volume
          )
        : undefined,
  };
}

async function getTimeframeData(
  symbol: MarketSymbol,
  timeframe: Timeframe
): Promise<TimeframeData> {
  const cacheKey =
    `${symbol}:${timeframe}`;

  const cached =
    cache.get(cacheKey);

  if (
    cached &&
    cached.expiresAt >
      Date.now()
  ) {
    return cached.data;
  }

  const apiKey =
    process.env
      .TWELVE_DATA_API_KEY;

  if (!apiKey) {
    throw new Error(
      "TWELVE_DATA_API_KEY is missing."
    );
  }

  const twelveSymbol =
    getTwelveDataSymbol(
      symbol
    );

  const url =
    new URL(
      TWELVE_DATA_URL
    );

  url.searchParams.set(
    "symbol",
    twelveSymbol
  );

  url.searchParams.set(
    "interval",
    timeframe
  );

  url.searchParams.set(
    "outputsize",
    String(
      getOutputSize(
        timeframe
      )
    )
  );

  url.searchParams.set(
    "order",
    "ASC"
  );

  url.searchParams.set(
    "timezone",
    "UTC"
  );

  url.searchParams.set(
    "apikey",
    apiKey
  );

  const response =
    await fetch(
      url.toString(),
      {
        cache:
          "no-store",
      }
    );

  if (!response.ok) {
    throw new Error(
      `Twelve Data HTTP error: ${response.status}`
    );
  }

  const data =
    await response.json();

  if (
    data.status ===
    "error"
  ) {
    throw new Error(
      data.message ||
        "Twelve Data returned an error."
    );
  }

  if (
    !Array.isArray(
      data.values
    ) ||
    data.values.length ===
      0
  ) {
    throw new Error(
      `No ${timeframe} candles returned for ${symbol}.`
    );
  }

  const candles:
    Candle[] =
    data.values
      .map(
        convertCandle
      )
      .filter(
        (
          candle: Candle
        ) =>
          Number.isFinite(
            candle.open
          ) &&
          Number.isFinite(
            candle.high
          ) &&
          Number.isFinite(
            candle.low
          ) &&
          Number.isFinite(
            candle.close
          )
      );

  if (
    candles.length === 0
  ) {
    throw new Error(
      `No valid ${timeframe} candles returned.`
    );
  }

  const latest =
    candles[
      candles.length - 1
    ];

  const previous =
    candles.length > 1
      ? candles[
          candles.length - 2
        ]
      : latest;

  const previousClose =
    previous.close;

  const changePercent =
    previousClose !==
    0
      ? (
          (
            latest.close -
            previousClose
          ) /
          previousClose
        ) *
        100
      : 0;

  const timeframeData:
    TimeframeData = {
    timeframe,

    candles,

    latestPrice:
      latest.close,

    previousClose,

    changePercent,

    updatedAt:
      Date.now(),
  };

  cache.set(
    cacheKey,
    {
      data:
        timeframeData,

      expiresAt:
        Date.now() +
        getCacheTTL(
          timeframe
        ),
    }
  );

  return timeframeData;
}

export async function getLiveMarketSnapshot(
  symbol: MarketSymbol
): Promise<MarketSnapshot> {
  const [
    oneMinute,
    fiveMinute,
    fifteenMinute,
    oneHour,
    fourHour,
    daily,
  ] =
    await Promise.all([
      getTimeframeData(
        symbol,
        "1min"
      ),

      getTimeframeData(
        symbol,
        "5min"
      ),

      getTimeframeData(
        symbol,
        "15min"
      ),

      getTimeframeData(
        symbol,
        "1h"
      ),

      getTimeframeData(
        symbol,
        "4h"
      ),

      getTimeframeData(
        symbol,
        "1day"
      ),
    ]);

  const dailyCandles =
    daily.candles;

  if (
    dailyCandles.length <
    2
  ) {
    throw new Error(
      "Not enough daily candles to calculate previous-day levels."
    );
  }

  const previousDay =
    dailyCandles[
      dailyCandles.length -
        2
    ];

  const candlePrice = oneMinute.latestPrice;
  const quotePrice = await getLiveQuote(symbol);
  const latestPrice = quotePrice ?? candlePrice;

  const previousDayClose =
    previousDay.close;

  const changePercent =
    previousDayClose !==
    0
      ? (
          (
            latestPrice -
            previousDayClose
          ) /
          previousDayClose
        ) *
        100
      : 0;

  const timeframes:
    Partial<
      Record<
        Timeframe,
        TimeframeData
      >
    > = {
    "1min":
      oneMinute,

    "5min":
      fiveMinute,

    "15min":
      fifteenMinute,

    "1h":
      oneHour,

    "4h":
      fourHour,

    "1day":
      daily,
  };

  const dataQuality:
    Partial<
      Record<
        Timeframe,
        DataQualityResult
      >
    > = {
    "1min":
      validateCandleData(
        oneMinute.candles,
        "1min"
      ),

    "5min":
      validateCandleData(
        fiveMinute.candles,
        "5min"
      ),

    "15min":
      validateCandleData(
        fifteenMinute.candles,
        "15min"
      ),

    "1h":
      validateCandleData(
        oneHour.candles,
        "1h"
      ),

    "4h":
      validateCandleData(
        fourHour.candles,
        "4h"
      ),

    "1day":
      validateCandleData(
        daily.candles,
        "1day"
      ),
  };

  const crossTimeframeValidation:
    CrossTimeframeResult =
    validateCrossTimeframes(
      timeframes
    );

  const microstructureValidation =
    validateMicrostructure(
      oneMinute.candles
    );

  const marketState =
    assessMarketAndDataState(
      symbol,
      timeframes,
      dataQuality,
      crossTimeframeValidation,
      microstructureValidation
    );

  const requiredTimeframes:
    Timeframe[] = [
    "1min",
    "5min",
    "15min",
    "1h",
    "4h",
    "1day",
  ];

  const structuralQualityValid =
    requiredTimeframes.every(
      (timeframe) =>
        dataQuality[
          timeframe
        ]?.valid === true
    );

  const tradingAllowed =
    structuralQualityValid &&
    crossTimeframeValidation.valid &&
    microstructureValidation.valid &&
    marketState.tradingPermission ===
      "ALLOWED";

  return {
    symbol,

    price:
      latestPrice,

    previousClose:
      previousDayClose,

    changePercent,

    candles:
      oneMinute.candles,

    timestamp:
      Date.now(),

    timeframes,

    previousDayHigh:
      previousDay.high,

    previousDayLow:
      previousDay.low,

    previousDayClose:
      previousDay.close,

    dataQuality,

    crossTimeframeValidation,

    microstructureValidation,

    marketState,

    tradingAllowed,
    priceSource: quotePrice !== null ? "QUOTE" : "CANDLE",
  };
}