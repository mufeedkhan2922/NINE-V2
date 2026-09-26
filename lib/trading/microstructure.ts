import {
  Candle,
  MicrostructureResult,
} from "./types";

function recentCandles(
  candles: Candle[],
  count: number
): Candle[] {
  if (candles.length <= count) {
    return candles;
  }

  return candles.slice(
    candles.length - count
  );
}

function roundPrice(
  value: number,
  decimals: number = 4
): number {
  const multiplier =
    10 ** decimals;

  return (
    Math.round(
      value * multiplier
    ) / multiplier
  );
}

function uniqueRatio(
  values: number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  return (
    new Set(values).size /
    values.length
  );
}

function movementDiversity(
  candles: Candle[]
): number {
  if (candles.length < 3) {
    return 1;
  }

  const movements: number[] =
    [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const movement =
      Math.abs(
        candles[i].close -
          candles[i - 1].close
      );

    if (
      Number.isFinite(
        movement
      )
    ) {
      movements.push(
        movement
      );
    }
  }

  if (
    movements.length < 2
  ) {
    return 0;
  }

  const average =
    movements.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    movements.length;

  if (average <= 0) {
    return 0;
  }

  const variance =
    movements.reduce(
      (sum, value) =>
        sum +
        (
          value -
          average
        ) ** 2,
      0
    ) /
    movements.length;

  return Math.min(
    1,
    Math.sqrt(variance) /
      average
  );
}

function rangeDiversity(
  candles: Candle[]
): number {
  if (candles.length < 3) {
    return 1;
  }

  const ranges =
    candles.map(
      (candle) =>
        Math.max(
          0,
          candle.high -
            candle.low
        )
    );

  const average =
    ranges.reduce(
      (sum, value) =>
        sum + value,
      0
    ) /
    ranges.length;

  if (average <= 0) {
    return 0;
  }

  const variance =
    ranges.reduce(
      (sum, value) =>
        sum +
        (
          value -
          average
        ) ** 2,
      0
    ) /
    ranges.length;

  return Math.min(
    1,
    Math.sqrt(variance) /
      average
  );
}

function repeatedValueRatio(
  values: number[]
): number {
  if (
    values.length < 2
  ) {
    return 0;
  }

  const counts =
    new Map<
      number,
      number
    >();

  for (
    const value of values
  ) {
    counts.set(
      value,
      (counts.get(value) ?? 0) +
        1
    );
  }

  let repeatedCount = 0;

  for (
    const count of counts.values()
  ) {
    if (count > 1) {
      repeatedCount += count;
    }
  }

  return (
    repeatedCount /
    values.length
  );
}

function directionalAlternationRatio(
  candles: Candle[]
): number {
  if (candles.length < 3) {
    return 0;
  }

  const directions:
    number[] = [];

  for (
    let i = 1;
    i < candles.length;
    i++
  ) {
    const delta =
      candles[i].close -
      candles[i - 1].close;

    if (delta > 0) {
      directions.push(1);
    } else if (
      delta < 0
    ) {
      directions.push(-1);
    } else {
      directions.push(0);
    }
  }

  let comparisons = 0;
  let alternations = 0;

  for (
    let i = 1;
    i < directions.length;
    i++
  ) {
    if (
      directions[i] === 0 ||
      directions[i - 1] === 0
    ) {
      continue;
    }

    comparisons++;

    if (
      directions[i] !==
      directions[i - 1]
    ) {
      alternations++;
    }
  }

  if (
    comparisons === 0
  ) {
    return 0;
  }

  return (
    alternations /
    comparisons
  );
}

function closeRangeRatio(
  candles: Candle[]
): number {
  if (
    candles.length === 0
  ) {
    return 0;
  }

  let valid = 0;

  for (
    const candle of candles
  ) {
    const range =
      candle.high -
      candle.low;

    if (range <= 0) {
      continue;
    }

    const closeLocation =
      (
        candle.close -
        candle.low
      ) / range;

    if (
      closeLocation >= 0.05 &&
      closeLocation <= 0.95
    ) {
      valid++;
    }
  }

  return (
    valid /
    candles.length
  );
}

export function validateMicrostructure(
  candles: Candle[]
): MicrostructureResult {
  const sample =
    recentCandles(
      candles,
      100
    );

  const issues: string[] =
    [];

  const warnings: string[] =
    [];

  const suspiciousSignals:
    string[] = [];

  if (
    sample.length < 20
  ) {
    return {
      valid: false,

      score: 0,

      issues: [
        "Not enough candles for microstructure validation.",
      ],

      warnings: [],

      sampleSize:
        sample.length,

      uniqueCloseRatio: 0,
      uniqueHighRatio: 0,
      uniqueLowRatio: 0,

      closeMovementDiversity: 0,
      rangeDiversity: 0,

      repeatedRangeRatio: 0,
      repeatedLowRatio: 0,
      repeatedHighRatio: 0,

      directionalAlternationRatio: 0,

      closeRangeRatio: 0,

      suspiciousSignals: [],
    };
  }

  const closes =
    sample.map(
      (candle) =>
        roundPrice(
          candle.close
        )
    );

  const highs =
    sample.map(
      (candle) =>
        roundPrice(
          candle.high
        )
    );

  const lows =
    sample.map(
      (candle) =>
        roundPrice(
          candle.low
        )
    );

  const ranges =
    sample.map(
      (candle) =>
        roundPrice(
          candle.high -
            candle.low
        )
    );

  const uniqueCloseRatio =
    uniqueRatio(
      closes
    );

  const uniqueHighRatio =
    uniqueRatio(
      highs
    );

  const uniqueLowRatio =
    uniqueRatio(
      lows
    );

  const repeatedRangeRatio =
    repeatedValueRatio(
      ranges
    );

  const repeatedLowRatio =
    repeatedValueRatio(
      lows
    );

  const repeatedHighRatio =
    repeatedValueRatio(
      highs
    );

  const closeMovementDiversity =
    movementDiversity(
      sample
    );

  const rangeDiversityValue =
    rangeDiversity(
      sample
    );

  const directionalAlternation =
    directionalAlternationRatio(
      sample
    );

  const closeRange =
    closeRangeRatio(
      sample
    );

  /*
   * ------------------------------------------------
   * INDIVIDUAL SIGNALS
   * ------------------------------------------------
   */

  if (
    uniqueCloseRatio < 0.35
  ) {
    suspiciousSignals.push(
      "Very low closing-price diversity."
    );
  }

  if (
    repeatedLowRatio > 0.85
  ) {
    suspiciousSignals.push(
      "Extremely high repetition of low-price levels."
    );
  }

  if (
    repeatedHighRatio > 0.85
  ) {
    suspiciousSignals.push(
      "Extremely high repetition of high-price levels."
    );
  }

  if (
    repeatedRangeRatio > 0.85
  ) {
    suspiciousSignals.push(
      "Extremely high repetition of candle ranges."
    );
  }

  if (
    closeMovementDiversity <
    0.08
  ) {
    warnings.push(
      "Close-to-close movement diversity is very low."
    );
  }

  if (
    rangeDiversityValue <
    0.08
  ) {
    warnings.push(
      "Candle-range diversity is very low."
    );
  }

  if (
    directionalAlternation >
    0.90
  ) {
    warnings.push(
      "Price direction alternates unusually frequently."
    );
  }

  if (
    closeRange > 0.95
  ) {
    warnings.push(
      "Most candles close away from their extremes."
    );
  }

  /*
   * ------------------------------------------------
   * COMBINED MICROSTRUCTURE TESTS
   * ------------------------------------------------
   *
   * A single repeated level is NOT enough to block
   * the market.
   *
   * We require multiple related fingerprints.
   */

  const repeatedLowCluster =
    repeatedLowRatio >
      0.60 &&
    uniqueLowRatio <
      0.50;

  const repeatedHighCluster =
    repeatedHighRatio >
      0.60 &&
    uniqueHighRatio <
      0.50;

  const alternatingPriceCluster =
    directionalAlternation >
      0.82 &&
    uniqueCloseRatio >
      0.70 &&
    closeMovementDiversity >
      0.15;

  const mechanicalRangePattern =
    repeatedRangeRatio >
      0.65 &&
    rangeDiversityValue <
      0.15;

  /*
   * ------------------------------------------------
   * STRONG ANOMALY COMBINATIONS
   * ------------------------------------------------
   */

  if (
    repeatedLowCluster
  ) {
    suspiciousSignals.push(
      "Large proportion of candles repeatedly use a small set of low-price levels."
    );
  }

  if (
    repeatedHighCluster
  ) {
    suspiciousSignals.push(
      "Large proportion of candles repeatedly use a small set of high-price levels."
    );
  }

  if (
    alternatingPriceCluster
  ) {
    suspiciousSignals.push(
      "Price direction alternates at an unusually high frequency despite substantial close-price diversity."
    );
  }

  if (
    mechanicalRangePattern
  ) {
    suspiciousSignals.push(
      "Candle ranges show a potentially mechanical repeating pattern."
    );
  }

  /*
   * ------------------------------------------------
   * FINAL DECISION
   * ------------------------------------------------
   *
   * We require TWO independent fingerprints.
   */

  const strongSignals = [
    repeatedLowCluster,
    repeatedHighCluster,
    alternatingPriceCluster,
    mechanicalRangePattern,
    uniqueCloseRatio < 0.35,
    repeatedRangeRatio > 0.85,
  ];

  const strongSignalCount =
    strongSignals.filter(
      Boolean
    ).length;

  const suspicious =
    strongSignalCount >= 2;

  if (
    suspicious
  ) {
    issues.push(
      "Multiple independent microstructure fingerprints indicate that the short-term feed may not represent natural market-price behavior."
    );
  }

  /*
   * ------------------------------------------------
   * QUALITY SCORE
   * ------------------------------------------------
   */

  const qualitySignals = [
    uniqueCloseRatio >= 0.65,
    uniqueHighRatio >= 0.65,
    uniqueLowRatio >= 0.50,
    repeatedRangeRatio < 0.60,
    closeMovementDiversity >= 0.08,
    rangeDiversityValue >= 0.08,
  ];

  let score =
    (
      qualitySignals.filter(
        Boolean
      ).length /
      qualitySignals.length
    ) *
    100;

  score -=
    strongSignalCount *
    15;

  score -=
    warnings.length *
    3;

  score = Math.max(
    0,
    Math.min(
      100,
      score
    )
  );

  return {
    valid:
      !suspicious,

    score,

    issues,

    warnings,

    sampleSize:
      sample.length,

    uniqueCloseRatio,

    uniqueHighRatio,

    uniqueLowRatio,

    closeMovementDiversity,

    rangeDiversity:
      rangeDiversityValue,

    repeatedRangeRatio,

    repeatedLowRatio,

    repeatedHighRatio,

    directionalAlternationRatio:
      directionalAlternation,

    closeRangeRatio:
      closeRange,

    suspiciousSignals,
  };
}