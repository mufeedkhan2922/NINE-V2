import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  closePaperPosition,
  executePaperSetup,
  getPaperAccount,
} from "../lib/trading/paperTrading";
import { reconcilePaperState } from "../lib/trading/paperReconciliation";
import { getOrder } from "../lib/trading/orders";
import { getStoreSnapshot, withStore } from "../lib/trading/store";

function orchestration(id: string, direction: "LONG" | "SHORT") {
  const entry = 4300;
  const stop = direction === "LONG" ? 4290 : 4310;
  const target = direction === "LONG" ? 4320 : 4280;

  return {
    agentReports: [],
    setup: {
      symbol: "XAUUSD" as const,
      direction,
      status: "VALID" as const,
      entry,
      stopLoss: stop,
      takeProfit: target,
      riskReward: 2,
      marketBias: direction === "LONG" ? "BULLISH" as const : "BEARISH" as const,
      confidence: 90,
      technical: {
        trend: direction === "LONG" ? "BULLISH" as const : "BEARISH" as const,
        momentum: direction === "LONG" ? "BULLISH" as const : "BEARISH" as const,
        structure: direction,
        atr: 10,
        emaFast: entry,
        emaSlow: direction === "LONG" ? 4290 : 4310,
      },
      smc: {
        liquiditySweep: true,
        marketStructureShift: true,
        fairValueGap: true,
        orderBlock: true,
        premiumDiscount: direction === "LONG" ? "DISCOUNT" as const : "PREMIUM" as const,
        sweepDirection: direction,
        structureDirection: direction,
      },
      risk: {
        allowed: true,
        riskPercent: 0.5,
        reason: "Stress harness approval",
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
      reason: "Stress harness Sentinel approval.",
      checks: ["risk", "geometry", "paper-only"],
    },
    executionMode: "PAPER" as const,
    commandSummary: `Operational stress ${id}`,
    generatedAt: Date.now(),
  };
}

function resetAccount(): void {
  const account = getStoreSnapshot().account;
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

const baseMarket = {
  symbol: "XAUUSD" as const,
  price: 4300,
  previousClose: 4295,
  changePercent: 0.12,
  candles: [],
};

export function runPaperStressTest(): void {
  resetAccount();

  let opened = 0;
  let closed = 0;

  for (let i = 0; i < 100; i += 1) {
    const id = `${i}-${randomUUID()}`;
    const direction = i % 2 === 0 ? "LONG" as const : "SHORT" as const;
    const setup = orchestration(id, direction);
    const market = { ...baseMarket, timestamp: Date.now() + i };

    const openedResult = executePaperSetup(setup, market);
    assert.equal(openedResult.ok, true, `cycle ${i} failed to open: ${openedResult.message}`);
    assert.ok(openedResult.orderId);
    assert.ok(openedResult.position);

    const order = getOrder(openedResult.orderId!);
    assert.equal(order?.status, "FILLED");
    opened += 1;

    // Exercise automatic settlement on alternating target/stop paths.
    const settlementPrice =
      direction === "LONG"
        ? (i % 2 === 0 ? 4320 : 4290)
        : (i % 2 === 0 ? 4280 : 4310);

    const settled = getPaperAccount(settlementPrice);
    const position = settled.positions.find((p) => p.id === openedResult.position!.id);
    assert.equal(position?.status, "CLOSED", `cycle ${i} did not settle automatically`);
    assert.equal(getOrder(openedResult.orderId!)?.status, "CLOSED");
    closed += 1;

    // Verify the duplicate request resolves to the same lifecycle record.
    const duplicate = executePaperSetup(setup, market);
    assert.equal(duplicate.orderId, openedResult.orderId);
  }

  assert.equal(opened, 100);
  assert.equal(closed, 100);

  const reconciliation = reconcilePaperState();
  assert.equal(
    reconciliation.issues.some((issue) => issue.severity === "ERROR"),
    false,
    `stress reconciliation errors: ${JSON.stringify(reconciliation.issues)}`,
  );
  assert.ok(reconciliation.score >= 95, `unexpected reconciliation score: ${reconciliation.score}`);

  // Exercise the explicit close path once more after the automatic-settlement loop.
  resetAccount();
  const manualId = `manual-${randomUUID()}`;
  const manual = executePaperSetup(orchestration(manualId, "LONG"), {
    ...baseMarket,
    timestamp: Date.now() + 1000,
  });
  assert.equal(manual.ok, true);
  const manualClose = closePaperPosition(manual.position!.id, 4310);
  assert.equal(manualClose.ok, true);
  assert.equal(getOrder(manual.orderId!)?.status, "CLOSED");

  const finalReconciliation = reconcilePaperState();
  assert.equal(
    finalReconciliation.issues.some((issue) => issue.severity === "ERROR"),
    false,
  );
}
