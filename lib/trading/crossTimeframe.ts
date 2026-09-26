import {
  Candle,
  CrossTimeframeResult,
  Timeframe,
  TimeframeData,
} from "./types";

type TimeframeMap = Partial<
  Record<Timeframe, TimeframeData>
>;

function median(
  values: number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted =
    [...values].sort(
      (a, b) => a - b
    );

  const middle =
    Math.floor(
      sorted.length / 2
    );

  if (
    sorted.length % 2 === 0
  ) {
    return (
      sorted[middle - 1] +
      sorted[middle]
    ) / 2;
  }

  return sorted[middle];
}

function candleRange(
  candle: Candle
): number {
  return Math.max(
    0,
    candle.high - candle.low
  );
}

function percentageDifference(
  a: number,
  b: number
): number {
  if (b === 0) {
    return 0;
  }

  return (
    Math.abs(a - b) /
    Math.abs(b)
  ) * 100;
}

function recentCandles(
  candles: Candle[],
  count: number
): Candle[] {
  if (
    candles.length <= count
  ) {
    return candles;
  }

  return candles.slice(
    candles.length - count
  );
}

function repeatedPriceRatio(
  candles: Candle[]
): number {
  if (candles.length < 2) {
    return 0;
  }

  const recent =
    recentCandles(
      candles,
      60
    );

  let repeated = 0;

  for (
    let i = 1;
    i < recent.length;
    i++
  ) {
    const previous =
      recent[i - 1];

    const current =
      recent[i];

    if (
      Math.abs(
        current.close -
          previous.close
      ) < 0.000001
    ) {
      repeated++;
    }
  }

  return (
    repeated /
    (recent.length - 1)
  );
}

function compressionRatio(
  candles: Candle[]
): number {
  if (candles.length < 20) {
    return 1;
  }

  const recent =
    recentCandles(
      candles,
      20
    );

  const broader =
    recentCandles(
      candles,
      80
    );

  const recentRanges =
    recent.map(candleRange);

  const broaderRanges =
    broader.map(candleRange);

  const recentMedian =
    median(recentRanges);

  const broaderMedian =
    median(broaderRanges);

  if (
    broaderMedian <= 0
  ) {
    return 1;
  }

  return (
    recentMedian /
    broaderMedian
  );
}

/*
 * ------------------------------------------------
 * TIMEFRAME AGGREGATION
 * ------------------------------------------------
 *
 * Important:
 *
 * We do NOT assume that 4H candles are aligned to
 * Unix epoch 4-hour buckets.
 *
 * Instead, every higher-timeframe candle defines
 * its own time window.
 *
 * This is important because the Twelve Data 4H
 * timestamps can be offset from a simple epoch
 * 4-hour boundary.
 */

function compareAggregation(
  lowerCandles: Candle[],
  higherCandles: Candle[],
  lowerIntervalMinutes: number,
  higherIntervalMinutes: number
): boolean {
  const expectedLowerCount =
    higherIntervalMinutes /
    lowerIntervalMinutes;

  if (
    !Number.isFinite(
      expectedLowerCount
    ) ||
    expectedLowerCount <= 0
  ) {
    return false;
  }

  if (
    lowerCandles.length <
    expectedLowerCount
  ) {
    return true;
  }

  if (
    higherCandles.length < 3
  ) {
    return true;
  }

  const sortedLower =
    [...lowerCandles].sort(
      (a, b) =>
        a.time - b.time
    );

  const sortedHigher =
    [...higherCandles].sort(
      (a, b) =>
        a.time - b.time
    );

  /*
   * Exclude the newest higher-timeframe candle.
   *
   * The newest candle may still be forming.
   */
  const completedHigher =
    sortedHigher.slice(
      0,
      -1
    );

  let matched = 0;
  let validMatches = 0;

  const higherIntervalMs =
    higherIntervalMinutes *
    60 *
    1000;

  for (
    const higher of
      completedHigher
  ) {
    const windowStart =
      higher.time;

    const windowEnd =
      windowStart +
      higherIntervalMs;

    const lowerWindow =
      sortedLower.filter(
        (candle) =>
          candle.time >=
            windowStart &&
          candle.time <
            windowEnd
      );

    if (
      lowerWindow.length ===
      0
    ) {
      continue;
    }

    matched++;

    /*
     * A completed higher candle should contain
     * the expected number of lower candles.
     */
    if (
      lowerWindow.length !==
      expectedLowerCount
    ) {
      continue;
    }

    const sortedWindow =
      [...lowerWindow].sort(
        (a, b) =>
          a.time - b.time
      );

    const aggregated: Candle = {
      time:
        windowStart,

      open:
        sortedWindow[0].open,

      high: Math.max(
        ...sortedWindow.map(
          (candle) =>
            candle.high
        )
      ),

      low: Math.min(
        ...sortedWindow.map(
          (candle) =>
            candle.low
        )
      ),

      close:
        sortedWindow[
          sortedWindow.length - 1
        ].close,
    };

    const highDifference =
      percentageDifference(
        aggregated.high,
        higher.high
      );

    const lowDifference =
      percentageDifference(
        aggregated.low,
        higher.low
      );

    const openDifference =
      percentageDifference(
        aggregated.open,
        higher.open
      );

    const closeDifference =
      percentageDifference(
        aggregated.close,
        higher.close
      );

    if (
      highDifference <= 0.15 &&
      lowDifference <= 0.15 &&
      openDifference <= 0.15 &&
      closeDifference <= 0.15
    ) {
      validMatches++;
    }
  }

  /*
   * Not enough overlapping historical candles
   * to make a reliable judgement.
   */
  if (
    matched < 3
  ) {
    return true;
  }

  return (
    validMatches /
      matched >=
    0.70
  );
}

/*
 * ------------------------------------------------
 * LATEST PRICE CONSISTENCY
 * ------------------------------------------------
 */

function latestPriceDeviation(
  timeframes: TimeframeMap
): number {
  const names: Timeframe[] = [
    "1min",
    "5min",
    "15min",
    "1h",
    "4h",
  ];

  const prices: number[] =
    [];

  for (
    const timeframe of names
  ) {
    const data =
      timeframes[
        timeframe
      ];

    if (
      data &&
      Number.isFinite(
        data.latestPrice
      )
    ) {
      prices.push(
        data.latestPrice
      );
    }
  }

  if (
    prices.length < 2
  ) {
    return 0;
  }

  const reference =
    prices[0];

  if (
    reference === 0
  ) {
    return 0;
  }

  let maximum = 0;

  for (
    const price of prices
  ) {
    const deviation =
      percentageDifference(
        price,
        reference
      );

    maximum =
      Math.max(
        maximum,
        deviation
      );
  }

  return maximum;
}

/*
 * ------------------------------------------------
 * FEED FRESHNESS
 * ------------------------------------------------
 */

function isFeedStale(
  timeframes: TimeframeMap
): boolean {
  const now =
    Date.now();

  const names: Timeframe[] = [
    "1min",
    "5min",
    "15min",
    "1h",
    "4h",
  ];

  let checked = 0;

  for (
    const timeframe of names
  ) {
    const data =
      timeframes[
        timeframe
      ];

    if (!data) {
      continue;
    }

    checked++;

    const latest =
      data.candles[
        data.candles.length - 1
      ];

    if (!latest) {
      return true;
    }

    const age =
      now -
      latest.time;

    const maxAge =
      timeframe === "1min"
        ? 10 * 60 * 1000
        : timeframe === "5min"
          ? 20 * 60 * 1000
          : timeframe === "15min"
            ? 45 * 60 * 1000
            : timeframe === "1h"
              ? 3 * 60 * 60 * 1000
              : 12 * 60 * 60 * 1000;

    if (
      age >
      maxAge
    ) {
      return true;
    }
  }

  return checked === 0;
}

/*
 * ------------------------------------------------
 * HIGHER-TIMEFRAME FLATLINE DETECTION
 * ------------------------------------------------
 *
 * This is specifically designed to detect cases
 * where a provider repeats an almost identical
 * OHLC candle for an unusually long sequence.
 *
 * We intentionally do NOT use this on 1-minute
 * data because the dedicated microstructure engine
 * handles short-term behavior.
 */

function detectFlatlineAnomaly(
  candles: Candle[]
): {
  suspicious: boolean;
  longestRun: number;
  runRatio: number;
} {
  const sample =
    recentCandles(
      candles,
      100
    );

  if (
    sample.length < 20
  ) {
    return {
      suspicious: false,
      longestRun: 0,
      runRatio: 0,
    };
  }

  const ranges =
    sample.map(
      candleRange
    );

  const positiveRanges =
    ranges.filter(
      (value) =>
        value > 0
    );

  const baseline =
    median(
      positiveRanges
    );

  if (
    baseline <= 0
  ) {
    return {
      suspicious: false,
      longestRun: 0,
      runRatio: 0,
    };
  }

  /*
   * A candle is considered mechanically tiny when
   * its range is less than 10% of the normal
   * timeframe range and its close movement is also
   * very small.
   */
  const tinyRangeThreshold =
    baseline * 0.10;

  const tinyMovementThreshold =
    baseline * 0.05;

  let currentRun = 0;
  let longestRun = 0;

  for (
    let i = 0;
    i < sample.length;
    i++
  ) {
    const candle =
      sample[i];

    const previous =
      i > 0
        ? sample[i - 1]
        : null;

    const movement =
      previous
        ? Math.abs(
            candle.close -
              previous.close
          )
        : 0;

    const tiny =
      candleRange(
        candle
      ) <=
        tinyRangeThreshold &&
      (
        previous === null ||
        movement <=
          tinyMovementThreshold
      );

    if (tiny) {
      currentRun++;

      longestRun =
        Math.max(
          longestRun,
          currentRun
        );
    } else {
      currentRun = 0;
    }
  }

  const runRatio =
    longestRun /
    sample.length;

  /*
   * Require a long consecutive run.
   *
   * 12% of a 100-candle sample means roughly
   * 12 consecutive mechanically tiny candles.
   */
  const suspicious =
    longestRun >=
      Math.max(
        8,
        Math.ceil(
          sample.length *
            0.12
        )
      );

  return {
    suspicious,
    longestRun,
    runRatio,
  };
}

/*
 * ------------------------------------------------
 * MAIN CROSS-TIMEFRAME VALIDATOR
 * ------------------------------------------------
 */

export function validateCrossTimeframes(
  timeframes: TimeframeMap
): CrossTimeframeResult {
  const issues: string[] =
    [];

  const warnings: string[] =
    [];

  const oneMinute =
    timeframes["1min"];

  const fiveMinute =
    timeframes["5min"];

  const fifteenMinute =
    timeframes["15min"];

  const oneHour =
    timeframes["1h"];

  const fourHour =
    timeframes["4h"];

  if (
    !oneMinute ||
    !fiveMinute ||
    !fifteenMinute ||
    !oneHour ||
    !fourHour
  ) {
    return {
      valid: false,

      score: 0,

      issues: [
        "Required timeframes are missing.",
      ],

      warnings: [],

      repeatedPriceRatio: 0,

      compressionRatio: 0,

      latestPriceDeviationPercent: 0,

      aggregationChecks: {
        oneMinuteToFiveMinute:
          false,

        fiveMinuteToFifteenMinute:
          false,

        oneHourToFourHour:
          false,
      },

      staleFeed: true,

      providerAnomaly: true,
    };
  }

  /*
   * ------------------------------------------------
   * SHORT-TERM BEHAVIOR
   * ------------------------------------------------
   */

  const repeatedRatio =
    repeatedPriceRatio(
      oneMinute.candles
    );

  const compression =
    compressionRatio(
      oneMinute.candles
    );

  /*
   * ------------------------------------------------
   * PRICE CONSISTENCY
   * ------------------------------------------------
   */

  const priceDeviation =
    latestPriceDeviation(
      timeframes
    );

  /*
   * ------------------------------------------------
   * AGGREGATION CHECKS
   * ------------------------------------------------
   */

  const oneToFive =
    compareAggregation(
      oneMinute.candles,
      fiveMinute.candles,
      1,
      5
    );

  const fiveToFifteen =
    compareAggregation(
      fiveMinute.candles,
      fifteenMinute.candles,
      5,
      15
    );

  const oneHourToFourHour =
    compareAggregation(
      oneHour.candles,
      fourHour.candles,
      60,
      240
    );

  /*
   * ------------------------------------------------
   * FRESHNESS
   * ------------------------------------------------
   */

  const stale =
    isFeedStale(
      timeframes
    );

  /*
   * ------------------------------------------------
   * HIGHER-TIMEFRAME BEHAVIOR
   * ------------------------------------------------
   */

  const oneHourFlatline =
    detectFlatlineAnomaly(
      oneHour.candles
    );

  const fourHourFlatline =
    detectFlatlineAnomaly(
      fourHour.candles
    );

  /*
   * ------------------------------------------------
   * SHORT-TERM CHECKS
   * ------------------------------------------------
   */

  if (
    repeatedRatio > 0.7
  ) {
    issues.push(
      "1-minute feed contains an unusually high proportion of identical closing prices."
    );
  } else if (
    repeatedRatio > 0.4
  ) {
    warnings.push(
      "1-minute feed shows elevated identical-price behavior."
    );
  }

  if (
    compression < 0.08
  ) {
    warnings.push(
      "Recent 1-minute price ranges are severely compressed compared with the recent baseline."
    );
  } else if (
    compression < 0.2
  ) {
    warnings.push(
      "Recent 1-minute price ranges are significantly compressed."
    );
  }

  /*
   * ------------------------------------------------
   * CROSS-TIMEFRAME PRICE CHECK
   * ------------------------------------------------
   */

  if (
    priceDeviation > 1.0
  ) {
    issues.push(
      `Latest prices differ by ${priceDeviation.toFixed(
        3
      )}% across short and higher timeframes.`
    );
  } else if (
    priceDeviation > 0.5
  ) {
    warnings.push(
      `Cross-timeframe price deviation is elevated at ${priceDeviation.toFixed(
        3
      )}%.`
    );
  }

  /*
   * ------------------------------------------------
   * AGGREGATION CHECKS
   * ------------------------------------------------
   */

  if (!oneToFive) {
    issues.push(
      "1-minute candles do not aggregate consistently into the 5-minute feed."
    );
  }

  if (!fiveToFifteen) {
    issues.push(
      "5-minute candles do not aggregate consistently into the 15-minute feed."
    );
  }

  if (
    !oneHourToFourHour
  ) {
    issues.push(
      "1-hour candles do not aggregate consistently into the 4-hour feed."
    );
  }

  /*
   * ------------------------------------------------
   * STALE FEED
   * ------------------------------------------------
   */

  if (stale) {
    issues.push(
      "One or more market feeds appear stale."
    );
  }

  /*
   * ------------------------------------------------
   * HIGHER-TIMEFRAME FLATLINE
   * ------------------------------------------------
   */

  const higherTimeframeAnomaly =
    oneHourFlatline.suspicious ||
    fourHourFlatline.suspicious;

  if (
    oneHourFlatline.suspicious
  ) {
    issues.push(
      `1-hour feed contains an unusually long near-flat candle sequence (${oneHourFlatline.longestRun} candles).`
    );
  }

  if (
    fourHourFlatline.suspicious
  ) {
    issues.push(
      `4-hour feed contains an unusually long near-flat candle sequence (${fourHourFlatline.longestRun} candles).`
    );
  }

  /*
   * ------------------------------------------------
   * HARD ANOMALY SIGNALS
   * ------------------------------------------------
   */

  const hardAnomalySignals = [
    repeatedRatio > 0.7,
    priceDeviation > 1.0,
    !oneToFive,
    !fiveToFifteen,
    !oneHourToFourHour,
    stale,
    higherTimeframeAnomaly,
  ];

  const anomalyCount =
    hardAnomalySignals.filter(
      Boolean
    ).length;

  const providerAnomaly =
    anomalyCount >= 2 ||
    higherTimeframeAnomaly;

  if (
    providerAnomaly
  ) {
    issues.push(
      "Multiple independent feed-quality checks indicate a possible provider/data anomaly."
    );
  }

  /*
   * ------------------------------------------------
   * SCORE
   * ------------------------------------------------
   */

  let score = 100;

  score -=
    issues.length * 15;

  score -=
    warnings.length * 3;

  score = Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

  const valid =
    issues.length === 0 &&
    !providerAnomaly;

  return {
    valid,

    score,

    issues,

    warnings,

    repeatedPriceRatio:
      repeatedRatio,

    compressionRatio:
      compression,

    latestPriceDeviationPercent:
      priceDeviation,

    aggregationChecks: {
      oneMinuteToFiveMinute:
        oneToFive,

      fiveMinuteToFifteenMinute:
        fiveToFifteen,

      oneHourToFourHour:
        oneHourToFourHour,
    },

    staleFeed:
      stale,

    providerAnomaly,
  };
}