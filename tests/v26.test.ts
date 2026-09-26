import assert from "node:assert/strict";

import {
  buildMTFAlignment,
  buildSetupV26,
  buildBrainDecision,
  buildMarketHealthV26,
  buildRiskTelemetryV26,
  runBacktestV26,
} from "../lib/trading/v26";

import {
  orchestrateNINE,
} from "../lib/trading/orchestrator";

import type {
  PaperAccount,
  PaperPosition,
} from "../lib/trading/types";

function candles(
  count: number,
  start: number,
  step: number,
) {
  return Array.from(
    { length: count },
    (_, i) => {
      const close =
        start + i * step;

      return {
        time:
          Date.now() -
          (count - i) * 60_000,

        open:
          close - 0.5,

        high:
          close + 1,

        low:
          close - 1,

        close,
      };
    },
  );
}

function baseAccount(): PaperAccount {
  return {
    currency: "USD",

    initialBalance:
      10_000,

    balance:
      10_000,

    equity:
      10_000,

    realizedPnl:
      0,

    unrealizedPnl:
      0,

    positions: [],

    updatedAt:
      Date.now(),

    peakEquity:
      10_000,

    dailyStartBalance:
      10_000,

    dailyRealizedPnl:
      0,

    tradingDay:
      new Date()
        .toISOString()
        .slice(0, 10),
  };
}

function position(
  id: string,
  pnl: number,
  closedAt: number,
): PaperPosition {
  return {
    id,

    symbol:
      "XAUUSD",

    side:
      "BUY",

    quantity:
      0.01,

    entryPrice:
      4200,

    stopLoss:
      4190,

    takeProfit:
      4220,

    openedAt:
      closedAt - 60_000,

    status:
      "CLOSED",

    exitPrice:
      4200 + pnl,

    closedAt,

    realizedPnl:
      pnl,

    orderId:
      `TEST-${id}`,
  };
}

export async function runV26Test(): Promise<void> {
  const c =
    candles(
      80,
      4200,
      0.5,
    );

  const market: any = {
    symbol:
      "XAUUSD",

    price:
      c.at(-1)!.close,

    previousClose:
      c.at(-2)!.close,

    changePercent:
      0.1,

    candles:
      c,

    timestamp:
      Date.now(),

    tradingAllowed:
      true,

    marketState: {
      tradingPermission:
        "ALLOWED",

      dataState:
        "LIVE",
    },

    timeframes: {
      "5min": {
        candles: c,
      },

      "15min": {
        candles: c,
      },

      "1h": {
        candles: c,
      },

      "4h": {
        candles: c,
      },
    },
  };

  /*
   * ---------------------------------------------------------
   * V2.6 MULTI-TIMEFRAME ALIGNMENT
   * ---------------------------------------------------------
   */

  const alignment =
    buildMTFAlignment(
      market,
    );

  assert.equal(
    alignment.direction,
    "LONG",
  );

  assert.equal(
    alignment.score,
    100,
  );

  /*
   * ---------------------------------------------------------
   * BASE TRADING SETUP
   * ---------------------------------------------------------
   */

  const base: any = {
    symbol:
      "XAUUSD",

    direction:
      "LONG",

    status:
      "VALID",

    entry:
      4239.5,

    stopLoss:
      4230,

    takeProfit:
      4258.5,

    riskReward:
      2,

    marketBias:
      "BULLISH",

    confidence:
      80,

    technical: {
      trend:
        "BULLISH",

      momentum:
        "BULLISH",

      structure:
        "BULLISH",

      atr:
        5,

      emaFast:
        4239,

      emaSlow:
        4230,
    },

    smc: {
      liquiditySweep:
        true,

      marketStructureShift:
        true,

      fairValueGap:
        true,

      orderBlock:
        true,

      premiumDiscount:
        "DISCOUNT",

      sweepDirection:
        "LONG",

      structureDirection:
        "LONG",

      chartist: {
        chochDirection:
          "LONG",
      },
    },

    risk: {
      allowed:
        true,

      riskPercent:
        0.5,

      reason:
        "ok",

      maxRiskPercent:
        1,
    },

    validation: {
      valid:
        true,

      score:
        90,

      blockers: [],

      warnings: [],

      checks: {
        marketData:
          true,

        dataQuality:
          true,

        crossTimeframe:
          true,

        microstructure:
          true,

        marketState:
          true,

        risk:
          true,

        setup:
          true,
      },
    },

    generatedAt:
      Date.now(),
  };

  /*
   * ---------------------------------------------------------
   * V2.6 SETUP ENGINE
   * ---------------------------------------------------------
   */

  const setup =
    buildSetupV26(
      market,
      base,
    );

  assert.equal(
    setup.lifecycle,
    "CONFIRMED",
  );

  assert.ok(
    setup.confluenceScore >=
      60,
  );

  /*
   * ---------------------------------------------------------
   * V2.6 BRAIN
   * ---------------------------------------------------------
   */

  const brain =
    buildBrainDecision(
      market,
      setup,
      undefined,
      {
        approved:
          true,

        reason:
          "Approved",

        checks: [
          "test approval",
        ],
      },
    );

  assert.equal(
    brain.action,
    "PAPER_READY",
  );

  /*
   * ---------------------------------------------------------
   * MARKET HEALTH
   * ---------------------------------------------------------
   */

  const health =
    buildMarketHealthV26(
      market,
    );

  assert.equal(
    health.state,
    "HEALTHY",
  );

  assert.equal(
    health.tradingAllowed,
    true,
  );

  /*
   * ---------------------------------------------------------
   * RISK TELEMETRY — EMPTY HISTORY
   * ---------------------------------------------------------
   */

  const emptyTelemetry =
    buildRiskTelemetryV26(
      baseAccount(),
      setup,
      {
        approved:
          true,

        reason:
          "Approved",

        checks: [],
      },
    );

  assert.equal(
    emptyTelemetry
      .consecutiveLosses,
    0,
  );

  /*
   * ---------------------------------------------------------
   * RISK TELEMETRY — TWO CONSECUTIVE LOSSES
   * ---------------------------------------------------------
   */

  const twoLossAccount =
    baseAccount();

  twoLossAccount.positions = [
    position(
      "LOSS-1",
      -10,
      1_000,
    ),

    position(
      "LOSS-2",
      -15,
      2_000,
    ),
  ];

  const twoLossTelemetry =
    buildRiskTelemetryV26(
      twoLossAccount,
      setup,
      {
        approved:
          true,

        reason:
          "Approved",

        checks: [],
      },
    );

  assert.equal(
    twoLossTelemetry
      .consecutiveLosses,
    2,
  );

  /*
   * ---------------------------------------------------------
   * RISK TELEMETRY — PROFIT BREAKS STREAK
   * ---------------------------------------------------------
   */

  const recoveredAccount =
    baseAccount();

  recoveredAccount.positions = [
    position(
      "LOSS-1",
      -10,
      1_000,
    ),

    position(
      "LOSS-2",
      -15,
      2_000,
    ),

    position(
      "WIN-1",
      20,
      3_000,
    ),
  ];

  const recoveredTelemetry =
    buildRiskTelemetryV26(
      recoveredAccount,
      setup,
      {
        approved:
          true,

        reason:
          "Approved",

        checks: [],
      },
    );

  assert.equal(
    recoveredTelemetry
      .consecutiveLosses,
    0,
  );

  /*
   * ---------------------------------------------------------
   * STALE MARKET SAFETY
   * ---------------------------------------------------------
   */

  const staleMarket = {
    ...market,

    timestamp:
      Date.now() -
      120_000,
  };

  const staleHealth =
    buildMarketHealthV26(
      staleMarket,
    );

  assert.equal(
    staleHealth
      .tradingAllowed,
    false,
  );

  /*
   * ---------------------------------------------------------
   * ORCHESTRATOR V2.6 INTEGRATION
   * ---------------------------------------------------------
   */

  const orchestration =
    await orchestrateNINE(
      market,
      baseAccount(),
    );

  assert.ok(
    orchestration.v26,
  );

  assert.ok(
    orchestration.v26.setup,
  );

  assert.ok(
    orchestration.v26.brain,
  );

  assert.ok(
    orchestration.v26
      .marketHealth,
  );

  assert.ok(
    orchestration.v26
      .riskTelemetry,
  );

  assert.ok(
    Array.isArray(
      orchestration.v26
        .signalEvents,
    ),
  );

  /*
   * V2.6 remains PAPER only.
   */
  assert.equal(
    orchestration.executionMode,
    "PAPER",
  );

  /*
   * ---------------------------------------------------------
   * STALE ORCHESTRATOR SAFETY
   * ---------------------------------------------------------
   */

  const staleOrchestration =
    await orchestrateNINE(
      staleMarket,
      baseAccount(),
    );

  assert.equal(
    staleOrchestration
      .sentinel
      .approved,
    false,
  );

  assert.equal(
    staleOrchestration
      .v26
      .marketHealth
      .tradingAllowed,
    false,
  );

  /*
   * ---------------------------------------------------------
   * V2.6 BACKTEST SMOKE TEST
   * ---------------------------------------------------------
   */

  const result =
    runBacktestV26(
      c,
      10_000,
      0.5,
    );

  assert.ok(
    Number.isFinite(
      result.netPnl,
    ),
  );

  assert.ok(
    Number.isFinite(
      result.maxDrawdownPercent,
    ),
  );
}