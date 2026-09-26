import {
  Candle,
  CrossTimeframeResult,
  DataQualityResult,
  DataState,
  MarketState,
  MarketStateAssessment,
  MarketSymbol,
  MicrostructureResult,
  Timeframe,
  TimeframeData,
  TradingPermission,
} from "./types";

type TimeframeMap = Partial<
  Record<
    Timeframe,
    TimeframeData
  >
>;

type QualityMap = Partial<
  Record<
    Timeframe,
    DataQualityResult
  >
>;

function getLatestCandle(
  data:
    | TimeframeData
    | undefined
): Candle | null {
  if (
    !data ||
    data.candles.length === 0
  ) {
    return null;
  }

  return data.candles[
    data.candles.length - 1
  ];
}

function getAgeSeconds(
  candle: Candle | null,
  now: number
): number {
  if (!candle) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(
    0,
    (now - candle.time) /
      1000
  );
}

function isFiniteAge(
  value: number
): boolean {
  return Number.isFinite(
    value
  );
}

function assessDataState(
  oneMinuteAge: number,
  fiveMinuteAge: number,
  fifteenMinuteAge: number,
  oneHourAge: number,
  fourHourAge: number,
  crossTimeframe:
    CrossTimeframeResult,
  microstructure:
    MicrostructureResult,
  quality: QualityMap
): {
  state: DataState;
  suspicious: boolean;
  reasons: string[];
  warnings: string[];
} {
  const reasons: string[] =
    [];

  const warnings: string[] =
    [];

  const structuralFailure =
    Object.values(
      quality
    ).some(
      (result) =>
        result !== undefined &&
        !result.valid
    );

  if (
    structuralFailure
  ) {
    reasons.push(
      "One or more timeframe feeds failed structural candle validation."
    );

    return {
      state:
        "SUSPICIOUS",

      suspicious:
        true,

      reasons,

      warnings,
    };
  }

  /*
   * Microstructure validation is primarily
   * responsible for the 1-minute execution feed.
   */

  if (
    microstructure.valid ===
    false
  ) {
    reasons.push(
      ...microstructure.issues
    );
  }

  if (
    microstructure.warnings
      .length > 0
  ) {
    warnings.push(
      ...microstructure.warnings
    );
  }

  /*
   * Cross-timeframe provider anomaly is a
   * hard safety condition.
   */

  if (
    crossTimeframe.providerAnomaly
  ) {
    reasons.push(
      "Multiple independent cross-timeframe checks indicate a possible provider anomaly."
    );

    return {
      state:
        "SUSPICIOUS",

      suspicious:
        true,

      reasons,

      warnings,
    };
  }

  if (
    crossTimeframe.issues
      .length > 0
  ) {
    warnings.push(
      ...crossTimeframe.issues
    );
  }

  if (
    crossTimeframe.warnings
      .length > 0
  ) {
    warnings.push(
      ...crossTimeframe.warnings
    );
  }

  /*
   * Higher timeframes are slower by design.
   *
   * They should not block a live 1-minute feed
   * merely because their current candle is older.
   *
   * We therefore warn only when their age exceeds
   * generous freshness windows.
   */

  if (
    oneHourAge >
    3 * 60 * 60
  ) {
    warnings.push(
      "1-hour market data is outside the preferred freshness window."
    );
  }

  if (
    fourHourAge >
    12 * 60 * 60
  ) {
    warnings.push(
      "4-hour market data is outside the preferred freshness window."
    );
  }

  /*
   * Microstructure failure blocks trading.
   */

  if (
    !microstructure.valid
  ) {
    return {
      state:
        "SUSPICIOUS",

      suspicious:
        true,

      reasons,

      warnings,
    };
  }

  /*
   * LIVE:
   *
   * Short-term execution timeframes are fresh.
   */

  if (
    oneMinuteAge <= 180 &&
    fiveMinuteAge <= 720 &&
    fifteenMinuteAge <= 1800
  ) {
    reasons.push(
      "Short-term market candles are updating within their expected freshness windows."
    );

    return {
      state:
        "LIVE",

      suspicious:
        false,

      reasons,

      warnings,
    };
  }

  /*
   * DELAYED:
   *
   * Data still exists but is outside the
   * preferred live window.
   */

  if (
    oneMinuteAge <= 600 &&
    fiveMinuteAge <= 1800 &&
    fifteenMinuteAge <= 5400
  ) {
    reasons.push(
      "Market data is available but one or more short-term feeds are outside the preferred live freshness window."
    );

    return {
      state:
        "DELAYED",

      suspicious:
        false,

      reasons,

      warnings,
    };
  }

  /*
   * STALE:
   */

  if (
    oneMinuteAge > 1800 ||
    fiveMinuteAge > 3600 ||
    fifteenMinuteAge > 10800
  ) {
    reasons.push(
      "One or more short-term market feeds are too old for live trading decisions."
    );

    return {
      state:
        "STALE",

      suspicious:
        false,

      reasons,

      warnings,
    };
  }

  return {
    state:
      "UNKNOWN",

    suspicious:
      false,

    reasons: [
      "Market data freshness could not be classified confidently.",
    ],

    warnings,
  };
}

function assessMarketState(
  symbol: MarketSymbol,
  dataState: DataState,
  oneMinuteAge: number
): {
  state: MarketState;
  feedActivity: boolean;
  reasons: string[];
} {
  const feedActivity =
    isFiniteAge(
      oneMinuteAge
    ) &&
    oneMinuteAge <= 600;

  if (
    symbol === "XAUUSD"
  ) {
    if (
      dataState ===
        "LIVE" ||
      dataState ===
        "DELAYED"
    ) {
      return {
        state:
          "OPEN",

        feedActivity,

        reasons: [
          "XAUUSD is configured as a continuously available commodity feed.",
        ],
      };
    }

    if (
      dataState ===
      "STALE"
    ) {
      return {
        state:
          "UNKNOWN",

        feedActivity:
          false,

        reasons: [
          "The XAUUSD feed is too stale to confirm current market activity.",
        ],
      };
    }

    if (
      dataState ===
      "SUSPICIOUS"
    ) {
      return {
        state:
          "UNKNOWN",

        feedActivity:
          false,

        reasons: [
          "Market activity cannot be trusted while the underlying feed is suspicious.",
        ],
      };
    }

    return {
      state:
        "UNKNOWN",

      feedActivity,

      reasons: [],
    };
  }

  return {
    state:
      "UNKNOWN",

    feedActivity,

    reasons: [
      `No market-session calendar is configured yet for ${symbol}.`,
    ],
  };
}

export function assessMarketAndDataState(
  symbol: MarketSymbol,
  timeframes: TimeframeMap,
  quality: QualityMap,
  crossTimeframe:
    CrossTimeframeResult,
  microstructure:
    MicrostructureResult,
  now: number =
    Date.now()
): MarketStateAssessment {
  const oneMinute =
    timeframes[
      "1min"
    ];

  const fiveMinute =
    timeframes[
      "5min"
    ];

  const fifteenMinute =
    timeframes[
      "15min"
    ];

  const oneHour =
    timeframes[
      "1h"
    ];

  const fourHour =
    timeframes[
      "4h"
    ];

  const oneMinuteCandle =
    getLatestCandle(
      oneMinute
    );

  const fiveMinuteCandle =
    getLatestCandle(
      fiveMinute
    );

  const fifteenMinuteCandle =
    getLatestCandle(
      fifteenMinute
    );

  const oneHourCandle =
    getLatestCandle(
      oneHour
    );

  const fourHourCandle =
    getLatestCandle(
      fourHour
    );

  const oneMinuteAge =
    getAgeSeconds(
      oneMinuteCandle,
      now
    );

  const fiveMinuteAge =
    getAgeSeconds(
      fiveMinuteCandle,
      now
    );

  const fifteenMinuteAge =
    getAgeSeconds(
      fifteenMinuteCandle,
      now
    );

  const oneHourAge =
    getAgeSeconds(
      oneHourCandle,
      now
    );

  const fourHourAge =
    getAgeSeconds(
      fourHourCandle,
      now
    );

  const latestCandleTime =
    Math.max(
      oneMinuteCandle?.time ??
        0,

      fiveMinuteCandle?.time ??
        0,

      fifteenMinuteCandle?.time ??
        0,

      oneHourCandle?.time ??
        0,

      fourHourCandle?.time ??
        0
    );

  const latestCandleAgeSeconds =
    latestCandleTime > 0
      ? Math.max(
          0,
          (now -
            latestCandleTime) /
            1000
        )
      : Number.POSITIVE_INFINITY;

  const dataAssessment =
    assessDataState(
      oneMinuteAge,
      fiveMinuteAge,
      fifteenMinuteAge,
      oneHourAge,
      fourHourAge,
      crossTimeframe,
      microstructure,
      quality
    );

  const marketAssessment =
    assessMarketState(
      symbol,
      dataAssessment.state,
      oneMinuteAge
    );

  const reasons = [
    ...marketAssessment.reasons,
    ...dataAssessment.reasons,
  ];

  const warnings = [
    ...dataAssessment.warnings,
  ];

  let tradingPermission:
    TradingPermission =
    "BLOCKED";

  if (
    marketAssessment.state ===
      "OPEN" &&
    dataAssessment.state ===
      "LIVE" &&
    !dataAssessment.suspicious
  ) {
    tradingPermission =
      "ALLOWED";
  }

  if (
    marketAssessment.state !==
    "OPEN"
  ) {
    reasons.push(
      "Trading is blocked because the market cannot currently be confirmed as open."
    );
  }

  if (
    dataAssessment.state !==
    "LIVE"
  ) {
    reasons.push(
      `Trading is blocked because data state is ${dataAssessment.state}.`
    );
  }

  if (
    dataAssessment.suspicious
  ) {
    reasons.push(
      "Trading is blocked because the market feed failed plausibility validation."
    );
  }

  if (
    crossTimeframe.providerAnomaly
  ) {
    reasons.push(
      "Trading is blocked because the provider anomaly flag is active."
    );
  }

  return {
    marketState:
      marketAssessment.state,

    dataState:
      dataAssessment.state,

    tradingPermission,

    reasons,

    warnings,

    latestCandleTime,

    latestCandleAgeSeconds,

    oneMinuteAgeSeconds:
      oneMinuteAge,

    fiveMinuteAgeSeconds:
      fiveMinuteAge,

    fifteenMinuteAgeSeconds:
      fifteenMinuteAge,

    oneHourAgeSeconds:
      oneHourAge,

    fourHourAgeSeconds:
      fourHourAge,

    feedActivity:
      marketAssessment.feedActivity,

    suspiciousFeed:
      dataAssessment.suspicious,
  };
}