import { ExecutionRequest, ExecutionResult, TradingSetup } from "./types";
import { appendEvent, withStore } from "./store";
import { appendExecutionLedger, requestHash } from "./ledger";
import { getBrokerAdapter } from "./broker";

const MAX_LIVE_NOTIONAL_USD = Number(process.env.NINE_LIVE_MAX_NOTIONAL_USD ?? 5_000);

function validFinitePositive(value: number): boolean { return Number.isFinite(value) && value > 0; }
function validateGeometry(request: ExecutionRequest): string | null {
  if (!validFinitePositive(request.quantity)) return "Quantity must be a positive finite number.";
  if (!validFinitePositive(request.entryPrice) || !validFinitePositive(request.stopLoss) || !validFinitePositive(request.takeProfit)) return "Entry, stop and target must be positive finite numbers.";
  if (request.side === "BUY" && !(request.stopLoss < request.entryPrice && request.takeProfit > request.entryPrice)) return "BUY geometry is invalid.";
  if (request.side === "SELL" && !(request.stopLoss > request.entryPrice && request.takeProfit < request.entryPrice)) return "SELL geometry is invalid.";
  const notional = request.quantity * request.entryPrice;
  if (!Number.isFinite(notional) || notional > MAX_LIVE_NOTIONAL_USD) return `Notional exceeds the ${MAX_LIVE_NOTIONAL_USD} USD live safety cap.`;
  return null;
}

export function executionRequestFromSetup(setup: TradingSetup, quantity: number, mode: "PAPER" | "LIVE", sentinelApproved: boolean): ExecutionRequest | null {
  if (setup.direction === "NONE" || setup.entry === null || setup.stopLoss === null || setup.takeProfit === null) return null;
  return { symbol: setup.symbol, side: setup.direction === "LONG" ? "BUY" : "SELL", quantity, entryPrice: setup.entry, stopLoss: setup.stopLoss, takeProfit: setup.takeProfit, mode, sentinelApproved };
}

export async function executeBrokerOrder(request: ExecutionRequest): Promise<ExecutionResult> {
  const timestamp = Date.now();
  const geometryError = validateGeometry(request);
  if (geometryError) {
    appendExecutionLedger({ eventType: "RISK_BLOCK", timestamp, symbol: request.symbol, mode: request.mode, side: request.side, quantity: request.quantity, price: request.entryPrice, stopLoss: request.stopLoss, takeProfit: request.takeProfit, status: "REJECTED", requestHash: requestHash(request), metadata: { reason: geometryError } });
    withStore((store) => appendEvent(store, { type: "BROKER_REJECT", message: geometryError, symbol: request.symbol }));
    return { accepted: false, mode: request.mode, status: "REJECTED", message: geometryError, timestamp };
  }
  if (!request.sentinelApproved) {
    const message = "Sentinel approval is required before execution.";
    appendExecutionLedger({ eventType: "RISK_BLOCK", timestamp, symbol: request.symbol, mode: request.mode, side: request.side, quantity: request.quantity, price: request.entryPrice, stopLoss: request.stopLoss, takeProfit: request.takeProfit, status: "REJECTED", requestHash: requestHash(request), metadata: { reason: message } });
    withStore((store) => appendEvent(store, { type: "BROKER_REJECT", message, symbol: request.symbol }));
    return { accepted: false, mode: request.mode, status: "REJECTED", message, timestamp };
  }
  if (request.mode !== "LIVE") return { accepted: true, mode: "PAPER", status: "SIMULATED", message: "Paper mode selected; no broker order was sent.", timestamp };
  const adapter = getBrokerAdapter();
  const result = await adapter.submitOrder(request);
  appendExecutionLedger({ eventType: result.accepted ? "SUBMIT" : "REJECT", timestamp: result.timestamp, symbol: request.symbol, mode: "LIVE", side: request.side, quantity: request.quantity, price: request.entryPrice, stopLoss: request.stopLoss, takeProfit: request.takeProfit, status: result.status, brokerOrderId: result.brokerOrderId, requestHash: requestHash(request), metadata: { adapter: adapter.id, message: result.message } });
  withStore((store) => appendEvent(store, { type: result.accepted ? "BROKER_SUBMIT" : "BROKER_REJECT", message: result.message, symbol: request.symbol, metadata: { quantity: request.quantity, brokerOrderId: result.brokerOrderId ?? null, adapter: adapter.id } }));
  return result;
}
