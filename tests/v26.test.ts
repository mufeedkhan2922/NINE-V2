import assert from "node:assert/strict";

import {
  buildMTFAlignment,
  buildSetupV26,
  buildBrainDecision,
  runBacktestV26,
} from "../lib/trading/v26";

function candles(
  count: number,
  start: number,
  step: number,
) {
  return Array.from(
    { length: count },
    (_, i) => {
      const close = start + i * step;

      return {
        time:
          Date.now() -
          (count - i) * 60_000,
        open: close - 0.5,
        high: close + 1,
        low: close - 1,
        close,
      };
    },
  );
}

export function runV26Test(): void {
  const c = candles(80, 4200, 0.5);

  const latest = c.at(-1);
  const previous = c.at(-2);

  assert.ok(latest);
  assert.ok(previous);

  const market: any = {
    symbol: "XAUUSD",
    price: latest.close,
    previousClose: previous.close,
    changePercent: 0.1,
    candles: c,
    timestamp: Date.now(),
    tradingAllowed: true,
    marketState: {
      tradingPermission: "ALLOWED",
      dataState: "LIVE",
    },
    timeframes: {
      "5min": { candles: c },
      "15min": { candles: c },
      "1h": { candles: c },
      "4h": { candles: c },
    },
  };

  const alignment = buildMTFAlignment(market);

  assert.equal(alignment.direction, "LONG");

  const base: any = {
    symbol: "XAUUSD",
    direction: "LONG",
    status: "VALID",
    entry: 4239.5,
    stopLoss: 4230,
    takeProfit: 4258.5,
    riskReward: 2,
    confidence: 80,

    technical: {
      trend: "BULLISH",
      momentum: "BULLISH",
      structure: "BULLISH",
      atr: 5,
      emaFast: 4239,
      emaSlow: 4230,
    },

    smc: {
      liquiditySweep: true,
      marketStructureShift: true,
      fairValueGap: true,
      orderBlock: true,
      premiumDiscount: "DISCOUNT",
      sweepDirection: "LONG",
      structureDirection: "LONG",
      chartist: {
        chochDirection: "LONG",
      },
    },

    risk: {
      allowed: true,
      riskPercent: 0.5,
      reason: "ok",
      maxRiskPercent: 1,
    },

    validation: {
      valid: true,
      score: 90,
      blockers: [],
      warnings: [],
      checks: {
        marketData: true,
        dataQuality: true,
        crossTimeframe: true,
        microstructure: true,
        marketState: true,
        risk: true,
        setup: true,
      },
    },

    generatedAt: Date.now(),
  };

  const setup = buildSetupV26(
    market,
    base,
  );

  assert.equal(
    setup.lifecycle,
    "CONFIRMED",
  );

  const brain = buildBrainDecision(
    market,
    setup,
    undefined,
    {
      approved: true,
      reason: "ok",
      checks: [],
    },
  );

  assert.equal(
    brain.action,
    "PAPER_READY",
  );

  const bt = runBacktestV26(
    c,
    10000,
    0.5,
  );

  assert.ok(bt.totalTrades >= 0);
}