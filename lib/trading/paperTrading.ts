import { MarketSnapshot, NINEOrchestration, OrderSide, PaperAccount, PaperPosition, TradeDirection } from "./types";
import { appendEvent, getStoreSnapshot, withStore } from "./store";
import { appendExecutionLedger } from "./ledger";

const MAX_NOTIONAL_USD = Number(process.env.NINE_PAPER_MAX_NOTIONAL_USD ?? 25_000);
const MAX_DAILY_LOSS_PERCENT = Number(process.env.NINE_PAPER_MAX_DAILY_LOSS_PERCENT ?? 2);
const MAX_OPEN_POSITIONS = Number(process.env.NINE_PAPER_MAX_OPEN_POSITIONS ?? 2);

function safeNumber(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function resetDailyCounters(account: PaperAccount): void {
  const day = new Date().toISOString().slice(0, 10);
  if (account.tradingDay !== day) {
    account.tradingDay = day;
    account.dailyStartBalance = account.balance;
    account.dailyRealizedPnl = 0;
  }
}

function markToMarket(account: PaperAccount, price: number): void {
  resetDailyCounters(account);
  let unrealized = 0;
  for (const position of account.positions.filter((item) => item.status === "OPEN")) {
    unrealized += position.side === "BUY"
      ? (price - position.entryPrice) * position.quantity
      : (position.entryPrice - price) * position.quantity;
  }
  account.unrealizedPnl = unrealized;
  account.equity = account.balance + unrealized;
  account.peakEquity = Math.max(account.peakEquity, account.equity);
  account.updatedAt = Date.now();
}

function settleTriggeredPositions(account: PaperAccount, price: number): void {
  const now = Date.now();
  for (const position of account.positions.filter((item) => item.status === "OPEN")) {
    const stopHit = position.side === "BUY" ? price <= position.stopLoss : price >= position.stopLoss;
    const targetHit = position.side === "BUY" ? price >= position.takeProfit : price <= position.takeProfit;
    if (!stopHit && !targetHit) continue;

    const exitPrice = stopHit ? position.stopLoss : position.takeProfit;
    const pnl = position.side === "BUY"
      ? (exitPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - exitPrice) * position.quantity;
    position.status = "CLOSED";
    position.exitPrice = exitPrice;
    position.closedAt = now;
    position.realizedPnl = pnl;
    account.balance += pnl;
    account.realizedPnl += pnl;
    account.dailyRealizedPnl += pnl;
    appendExecutionLedger({ eventType: "CLOSE", timestamp: now, symbol: position.symbol, mode: "PAPER", side: position.side, quantity: position.quantity, price: exitPrice, stopLoss: position.stopLoss, takeProfit: position.takeProfit, status: "CLOSED", metadata: { positionId: position.id, pnl, reason: stopHit ? "STOP" : "TARGET" } });
  }
}

function sideForDirection(direction: TradeDirection): OrderSide | null {
  if (direction === "LONG") return "BUY";
  if (direction === "SHORT") return "SELL";
  return null;
}

export function getPaperAccount(price?: number): PaperAccount {
  const store = getStoreSnapshot();
  const account = store.account;
  const mark = safeNumber(price ?? 0, 0);
  if (mark > 0) {
    settleTriggeredPositions(account, mark);
    markToMarket(account, mark);
  } else {
    markToMarket(account, account.positions.find((position) => position.status === "OPEN")?.entryPrice ?? account.balance);
  }
  withStore((target) => {
    target.account = account;
  });
  return account;
}

export function getPaperEvents(limit = 30) {
  return getStoreSnapshot().events.slice(-Math.max(1, Math.min(limit, 100))).reverse();
}

export function executePaperSetup(orchestration: NINEOrchestration, market: MarketSnapshot): { ok: boolean; message: string; position?: PaperPosition; account: PaperAccount } {
  const setup = orchestration.setup;
  const side = sideForDirection(setup.direction);
  if (!orchestration.sentinel.approved || !side || setup.entry === null || setup.stopLoss === null || setup.takeProfit === null) {
    return withStore((store) => {
      appendEvent(store, { type: "PAPER_REJECT", message: orchestration.sentinel.reason, symbol: setup.symbol });
      markToMarket(store.account, market.price);
      return { ok: false, message: orchestration.sentinel.reason, account: store.account };
    });
  }

  return withStore((store) => {
    const account = store.account;
    resetDailyCounters(account);
    settleTriggeredPositions(account, market.price);
    markToMarket(account, market.price);

    const openPositions = account.positions.filter((item) => item.status === "OPEN");
    if (openPositions.length >= Math.max(1, MAX_OPEN_POSITIONS)) {
      const message = `Paper risk guard: maximum ${MAX_OPEN_POSITIONS} open positions reached.`;
      appendEvent(store, { type: "RISK_GUARD", message, symbol: setup.symbol });
      return { ok: false, message, account };
    }

    const dailyLossLimit = account.dailyStartBalance * (Math.max(0.1, MAX_DAILY_LOSS_PERCENT) / 100);
    if (account.dailyRealizedPnl <= -dailyLossLimit) {
      const message = `Paper risk guard: daily realized loss limit of ${MAX_DAILY_LOSS_PERCENT}% reached.`;
      appendEvent(store, { type: "RISK_GUARD", message, symbol: setup.symbol });
      return { ok: false, message, account };
    }

    if (openPositions.some((position) => position.symbol === setup.symbol && position.side === side)) {
      const message = `Paper risk guard: an open ${side} ${setup.symbol} position already exists.`;
      appendEvent(store, { type: "RISK_GUARD", message, symbol: setup.symbol });
      return { ok: false, message, account };
    }

    const entryPrice = setup.entry;
    const stopLoss = setup.stopLoss;
    const takeProfit = setup.takeProfit;
    if (entryPrice === null || stopLoss === null || takeProfit === null) {
      const message = "Trade geometry became unavailable before paper execution.";
      appendEvent(store, { type: "PAPER_REJECT", message, symbol: setup.symbol });
      return { ok: false, message, account };
    }
    const riskDollars = account.equity * (setup.risk.riskPercent / 100);
    const riskPerUnit = Math.abs(entryPrice - stopLoss);
    if (!Number.isFinite(riskDollars) || riskDollars <= 0 || !Number.isFinite(riskPerUnit) || riskPerUnit <= 0) {
      const message = "Invalid paper risk geometry.";
      appendEvent(store, { type: "PAPER_REJECT", message, symbol: setup.symbol });
      return { ok: false, message, account };
    }

    const rawQuantity = Math.min(riskDollars / riskPerUnit, MAX_NOTIONAL_USD / entryPrice);
    const quantity = Number(rawQuantity.toFixed(4));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      const message = "Calculated paper quantity is invalid.";
      appendEvent(store, { type: "PAPER_REJECT", message, symbol: setup.symbol });
      return { ok: false, message, account };
    }

    const position: PaperPosition = {
      id: `PAPER-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: setup.symbol,
      side,
      quantity,
      entryPrice,
      stopLoss,
      takeProfit,
      openedAt: Date.now(),
      status: "OPEN",
    };

    account.positions.push(position);
    markToMarket(account, market.price);
    appendExecutionLedger({ eventType: "FILL", timestamp: Date.now(), symbol: setup.symbol, mode: "PAPER", side, quantity, price: entryPrice, stopLoss, takeProfit, status: "FILLED", metadata: { positionId: position.id } });
    appendEvent(store, {
      type: "PAPER_OPEN",
      message: `${side} ${quantity} ${setup.symbol} opened in paper mode.`,
      symbol: setup.symbol,
      positionId: position.id,
      metadata: { quantity, entry: entryPrice, stop: stopLoss, target: takeProfit },
    });
    return { ok: true, message: `${side} ${quantity} ${position.symbol} paper position opened.`, position, account };
  });
}

export function closePaperPosition(id: string, marketPrice: number): { ok: boolean; message: string; account: PaperAccount } {
  return withStore((store) => {
    const account = store.account;
    settleTriggeredPositions(account, marketPrice);
    const position = account.positions.find((item) => item.id === id && item.status === "OPEN");
    if (!position) return { ok: false, message: "Open paper position not found (it may already have hit SL/TP).", account };

    const pnl = position.side === "BUY"
      ? (marketPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - marketPrice) * position.quantity;
    position.status = "CLOSED";
    position.exitPrice = marketPrice;
    position.closedAt = Date.now();
    position.realizedPnl = pnl;
    account.balance += pnl;
    account.realizedPnl += pnl;
    account.dailyRealizedPnl += pnl;
    markToMarket(account, marketPrice);
    appendExecutionLedger({ eventType: "CLOSE", timestamp: Date.now(), symbol: position.symbol, mode: "PAPER", side: position.side, quantity: position.quantity, price: marketPrice, stopLoss: position.stopLoss, takeProfit: position.takeProfit, status: "CLOSED", metadata: { positionId: position.id, pnl } });
    appendEvent(store, {
      type: "PAPER_CLOSE",
      message: `Paper position ${position.id} closed at ${marketPrice.toFixed(2)}.`,
      symbol: position.symbol,
      positionId: position.id,
      metadata: { pnl },
    });
    return { ok: true, message: `Paper position closed at ${marketPrice.toFixed(2)}.`, account };
  });
}
