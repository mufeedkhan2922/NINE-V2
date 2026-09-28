import { buildPaperTelemetry, paperTelemetryHealth } from "../lib/trading/paperTelemetry";
import type { PaperAccount } from "../lib/trading/types";
import * as assert from "./assert";

export function runPaperTelemetryTest(): void {
  const account: PaperAccount = {
    currency: "USD",
    initialBalance: 10000,
    balance: 10040,
    equity: 10040,
    realizedPnl: 40,
    unrealizedPnl: 0,
    updatedAt: Date.now(),
    peakEquity: 10060,
    dailyStartBalance: 10000,
    dailyRealizedPnl: 40,
    tradingDay: new Date().toISOString().slice(0, 10),
    positions: [
      { id: "1", orderId: "o1", symbol: "XAUUSD", side: "BUY", quantity: 1, entryPrice: 100, stopLoss: 90, takeProfit: 120, openedAt: 1, status: "CLOSED", exitPrice: 120, closedAt: 2, realizedPnl: 20 },
      { id: "2", orderId: "o2", symbol: "XAUUSD", side: "SELL", quantity: 1, entryPrice: 100, stopLoss: 110, takeProfit: 80, openedAt: 3, status: "CLOSED", exitPrice: 80, closedAt: 4, realizedPnl: 20 },
      { id: "3", orderId: "o3", symbol: "XAUUSD", side: "BUY", quantity: 1, entryPrice: 100, stopLoss: 95, takeProfit: 110, openedAt: 5, status: "OPEN" },
    ],
  };

  const telemetry = buildPaperTelemetry(account);
  assert.equal(telemetry.closedTrades, 2, "closed trade count");
  assert.equal(telemetry.wins, 2, "win count");
  assert.equal(telemetry.losses, 0, "loss count");
  assert.equal(telemetry.winRate, 100, "win rate");
  assert.equal(telemetry.netPnl, 40, "net pnl");
  assert.equal(telemetry.openRiskUsd, 5, "open risk");
  assert.equal(telemetry.maxDrawdown, 0, "max drawdown");

  const healthy = paperTelemetryHealth("MANAGING", Date.now(), Date.now());
  assert.equal(healthy.healthy, true, "fresh managing loop should be healthy");

  const stale = paperTelemetryHealth("MANAGING", Date.now() - 20000, Date.now());
  assert.equal(stale.healthy, false, "old loop heartbeat should be stale");
}
