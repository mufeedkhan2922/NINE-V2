import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  closePaperPosition,
  executePaperSetup,
  getPaperAccount,
} from "../lib/trading/paperTrading";
import { getOrder } from "../lib/trading/orders";
import {
  getStoreSnapshot,
  withStore,
} from "../lib/trading/store";

function orchestration() {
  return {
    agentReports: [],
    setup: {
      symbol: "XAUUSD" as const,
      direction: "LONG" as const,
      status: "VALID" as const,
      entry: 4300,
      stopLoss: 4290,
      takeProfit: 4320,
      riskReward: 2,
      marketBias: "BULLISH" as const,
      confidence: 90,
      technical: {
        trend: "BULLISH" as const,
        momentum: "BULLISH" as const,
        structure: "BULLISH",
        atr: 10,
        emaFast: 4300,
        emaSlow: 4290,
      },
      smc: {
        liquiditySweep: true,
        marketStructureShift: true,
        fairValueGap: true,
        orderBlock: true,
        premiumDiscount: "DISCOUNT" as const,
        sweepDirection: "LONG" as const,
        structureDirection: "LONG" as const,
      },
      risk: {
        allowed: true,
        riskPercent: 0.5,
        reason: "Test approval",
        maxRiskPercent: 1,
      },
      validation: {
        valid: true,
        score: 100,
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
    },
    sentinel: {
      approved: true,
      reason: "Approved for paper test.",
      checks: ["risk", "geometry"],
    },
    executionMode: "PAPER" as const,
    commandSummary: "Test paper order",
    generatedAt: Date.now(),
  };
}

const market = {
  symbol: "XAUUSD" as const,
  price: 4300,
  previousClose: 4290,
  changePercent: 0.23,
  candles: [],
  timestamp: Date.now(),
};

function resetPaperTestState(): void {
  const snapshot = getStoreSnapshot();
  const account = snapshot.account;

  withStore((store) => {
    store.account = {
      ...account,
      balance: account.initialBalance,
      equity: account.initialBalance,
      realizedPnl: 0,
      unrealizedPnl: 0,
      peakEquity: account.initialBalance,
      dailyStartBalance: account.initialBalance,
      dailyRealizedPnl: 0,
      positions: [],
      tradingDay: new Date().toISOString().slice(0, 10),
      updatedAt: Date.now(),
    };
  });
}

export function runPaperOrdersTests(): void {
  /*
   * Reset the in-memory paper account.
   *
   * executePaperSetup() performs its risk checks against
   * store.account.positions, not directly against SQLite.
   * Therefore deleting database rows alone is insufficient.
   */
  resetPaperTestState();

  /*
   * Use one unique request identity for the first order
   * and its intentional duplicate.
   */
  const testId = randomUUID();

  const firstOrchestration = orchestration();

  firstOrchestration.commandSummary =
    `Test paper order ${testId}`;

  const first = executePaperSetup(
    firstOrchestration,
    market,
  );

  assert.equal(
    first.ok,
    true,
    `First paper execution failed: ${first.message}`,
  );

  assert.ok(
    first.position,
    "First execution must return a paper position.",
  );

  assert.ok(
    first.orderId,
    "First execution must return an order ID.",
  );

  const order = getOrder(first.orderId!);

  assert.ok(
    order,
    "Created order must exist in the order ledger.",
  );

  assert.equal(
    order?.status,
    "FILLED",
  );

  assert.equal(
    order?.filledPrice,
    4300,
  );

  assert.equal(
    first.position?.orderId,
    first.orderId,
  );

  /*
   * Same request identity:
   * - same symbol
   * - same setup
   * - same market timestamp
   * - same commandSummary
   *
   * It must resolve to the existing order rather
   * than being rejected by the open-position guard.
   */
  const duplicateOrchestration = orchestration();

  duplicateOrchestration.commandSummary =
    `Test paper order ${testId}`;

  const duplicate = executePaperSetup(
    duplicateOrchestration,
    market,
  );

  assert.equal(
    duplicate.ok,
    true,
    `Duplicate paper execution failed: ${duplicate.message}`,
  );

  assert.equal(
    duplicate.orderId,
    first.orderId,
  );

  /*
   * Close the paper position.
   */
  const closed = closePaperPosition(
    first.position!.id,
    4310,
  );

  assert.equal(
    closed.ok,
    true,
    `Paper position close failed: ${closed.message}`,
  );

  assert.equal(
    closed.orderId,
    first.orderId,
  );

  /*
   * The order must now be CLOSED.
   */
  const closedOrder = getOrder(
    first.orderId!,
  );

  assert.ok(
    closedOrder,
    "Closed order must still exist in the order ledger.",
  );

  assert.equal(
    closedOrder?.status,
    "CLOSED",
  );

  /*
   * Automatic stop/target settlement must close both the
   * paper position and its immutable order lifecycle.
   */
  resetPaperTestState();
  const targetId = randomUUID();
  const targetOrchestration = orchestration();
  targetOrchestration.commandSummary = `Target settlement ${targetId}`;

  const targetOpen = executePaperSetup(targetOrchestration, {
    ...market,
    timestamp: Date.now() + 1,
  });

  assert.equal(targetOpen.ok, true, "Target test position must open.");
  assert.ok(targetOpen.position, "Target test position must exist.");

  // Refresh through the paper account path so automatic settlement is persisted.
  const afterTarget = getPaperAccount(4320);

  assert.equal(afterTarget.positions.find((p) => p.id === targetOpen.position!.id)?.status, "CLOSED");
  assert.equal(getOrder(targetOpen.orderId!)?.status, "CLOSED");
  assert.equal(afterTarget.positions.find((p) => p.id === targetOpen.position!.id)?.realizedPnl !== undefined, true);
}