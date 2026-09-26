import {
  Candle,
  Timeframe,
} from "./types";

export interface DataQualityResult {
  valid: boolean;
  score: number;
  issues: string[];
  warnings: string[];
  stats: {
    candleCount: number;
    duplicateTimestamps: number;
    invalidOHLC: number;
    abnormalRanges: number;
    timestampGaps: number;
    medianRange: number;
  };
}

function expectedIntervalMs(
  timeframe: Timeframe
): number {
  switch (timeframe) {
    case "1min":
      return 60_000;

    case "5min":
      return 5 * 60_000;

    case "15min":
      return 15 * 60_000;

    case "1h":
      return 60 * 60_000;

    case "4h":
      return 4 * 60 * 60_000;

    case "1day":
      return 24 * 60 * 60_000;
  }
}

function median(
  values: number[]
): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [
    ...values,
  ].sort(
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
      (sorted[middle - 1] +
        sorted[middle]) /
      2
    );
  }

  return sorted[middle];
}

export function validateCandleData(
  candles: Candle[],
  timeframe: Timeframe
): DataQualityResult {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (candles.length < 10) {
    issues.push(
      `Only ${candles.length} candles available.`
    );
  }

  let duplicateTimestamps = 0;
  let invalidOHLC = 0;
  let timestampGaps = 0;
  let abnormalRanges = 0;

  const ranges: number[] = [];

  const timestamps =
    new Set<number>();

  for (
    let i = 0;
    i < candles.length;
    i++
  ) {
    const candle =
      candles[i];

    if (
      timestamps.has(
        candle.time
      )
    ) {
      duplicateTimestamps++;
    }

    timestamps.add(
      candle.time
    );

    const validOHLC =
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
      ) &&
      candle.high >=
        candle.low &&
      candle.high >=
        candle.open &&
      candle.high >=
        candle.close &&
      candle.low <=
        candle.open &&
      candle.low <=
        candle.close;

    if (!validOHLC) {
      invalidOHLC++;
    }

    const range =
      candle.high -
      candle.low;

    if (
      Number.isFinite(range) &&
      range >= 0
    ) {
      ranges.push(range);
    }

    if (i > 0) {
      const previous =
        candles[i - 1];

      const gap =
        candle.time -
        previous.time;

      const expected =
        expectedIntervalMs(
          timeframe
        );

      if (
        gap >
        expected * 3
      ) {
        timestampGaps++;
      }

      if (gap <= 0) {
        issues.push(
          `${timeframe}: timestamps are not strictly increasing.`
        );
      }
    }
  }

  const medianRange =
    median(ranges);

  if (
    medianRange <= 0
  ) {
    issues.push(
      `${timeframe}: median candle range is zero.`
    );
  }

  if (
    medianRange > 0
  ) {
    abnormalRanges =
      ranges.filter(
        (range) =>
          range >
          medianRange * 10
      ).length;

    if (
      abnormalRanges > 0
    ) {
      warnings.push(
        `${timeframe}: ${abnormalRanges} candles have unusually large ranges compared with the median.`
      );
    }

    const tinyCount =
      ranges.filter(
        (range) =>
          range <
          medianRange * 0.05
      ).length;

    const tinyRatio =
      tinyCount /
      Math.max(
        ranges.length,
        1
      );

    if (
      tinyRatio > 0.5
    ) {
      warnings.push(
        `${timeframe}: more than 50% of candles have extremely small ranges.`
      );
    }
  }

  if (
    duplicateTimestamps > 0
  ) {
    issues.push(
      `${timeframe}: ${duplicateTimestamps} duplicate timestamps detected.`
    );
  }

  if (
    invalidOHLC > 0
  ) {
    issues.push(
      `${timeframe}: ${invalidOHLC} invalid OHLC candles detected.`
    );
  }

  if (
    timestampGaps > 0
  ) {
    warnings.push(
      `${timeframe}: ${timestampGaps} large timestamp gaps detected.`
    );
  }

  const valid =
    issues.length === 0;

  let score = 100;

  score -=
    duplicateTimestamps *
    15;

  score -=
    invalidOHLC *
    20;

  score -=
    timestampGaps *
    2;

  score -=
    abnormalRanges *
    2;

  if (
    medianRange <= 0
  ) {
    score -= 30;
  }

  score = Math.max(
    0,
    score
  );

  return {
    valid,
    score,
    issues,
    warnings,
    stats: {
      candleCount:
        candles.length,
      duplicateTimestamps,
      invalidOHLC,
      abnormalRanges,
      timestampGaps,
      medianRange,
    },
  };
}