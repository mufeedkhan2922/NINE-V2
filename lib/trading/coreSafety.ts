import type {
  ExecutionRequest,
  MarketSnapshot,
  PaperAccount,
  TradingSetup,
} from "./types";

export interface CoreSafetyResult {
  valid: boolean;
  blockers: string[];
  warnings: string[];
  score: number;
}

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function validGeometry(request: ExecutionRequest): boolean {
  if (
    !finitePositive(request.quantity) ||
    !finitePositive(request.entryPrice) ||
    !finitePositive(request.stopLoss) ||
    !finitePositive(request.takeProfit)
  ) return false;

  if (request.side === "BUY") {
    return request.stopLoss < request.entryPrice &&
      request.takeProfit > request.entryPrice;
  }

  return request.stopLoss > request.entryPrice &&
    request.takeProfit < request.entryPrice;
}

export function validateExecutionRequest(request: ExecutionRequest): CoreSafetyResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!validGeometry(request)) {
    blockers.push("Execution request contains invalid quantity or trade geometry.");
  }

  if (request.mode === "LIVE") {
    blockers.push("Live execution is hard-locked in NINE core safety.");
  }

  if (!request.sentinelApproved) {
    blockers.push("Sentinel approval is mandatory before execution.");
  }

  if (request.quantity > 0 && request.entryPrice > 0) {
    const notional = request.quantity * request.entryPrice;
    if (!Number.isFinite(notional)) {
      blockers.push("Execution notional is not finite.");
    }
  }

  const passed = 3 - blockers.filter((item) =>
    item.includes("geometry") || item.includes("quantity"),
  ).length - (request.mode === "PAPER" ? 0 : 1) - (request.sentinelApproved ? 0 : 1);
  const score = blockers.length === 0 ? 100 : Math.max(0, Math.min(100, passed * 33));

  if (request.mode === "PAPER") {
    warnings.push("Paper execution only; no broker order is permitted by this gate.");
  }

  return { valid: blockers.length === 0, blockers, warnings, score };
}

export function validateMarketSnapshotCore(
  market: MarketSnapshot,
  minimumCandles = 30,
): CoreSafetyResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!finitePositive(market.price)) blockers.push("Market price is invalid.");
  if (!Number.isFinite(market.timestamp) || market.timestamp <= 0) blockers.push("Market timestamp is invalid.");
  if (market.candles.length < minimumCandles) blockers.push(`At least ${minimumCandles} candles are required.`);

  for (const candle of market.candles.slice(-minimumCandles)) {
    if (
      !Number.isFinite(candle.time) ||
      !finitePositive(candle.open) ||
      !finitePositive(candle.high) ||
      !finitePositive(candle.low) ||
      !finitePositive(candle.close) ||
      candle.high < candle.low ||
      candle.high < candle.open ||
      candle.high < candle.close ||
      candle.low > candle.open ||
      candle.low > candle.close
    ) {
      blockers.push("Recent market candles contain invalid OHLC geometry.");
      break;
    }
  }

  const ageSeconds = (Date.now() - market.timestamp) / 1000;
  if (ageSeconds > 600) blockers.push("Market snapshot is stale.");
  else if (ageSeconds > 120) warnings.push("Market snapshot is delayed.");

  if (market.marketState?.suspiciousFeed) blockers.push("Market-state engine marked the feed suspicious.");
  if (market.crossTimeframeValidation && !market.crossTimeframeValidation.valid) {
    blockers.push("Cross-timeframe validation failed.");
  }
  if (market.microstructureValidation && !market.microstructureValidation.valid) {
    blockers.push("Microstructure validation failed.");
  }

  const score = Math.round(
    Math.max(0, 100 - blockers.length * 20 - warnings.length * 5),
  );
  return { valid: blockers.length === 0, blockers, warnings, score };
}

export function validatePaperAccountCore(account: PaperAccount): CoreSafetyResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!finitePositive(account.initialBalance)) blockers.push("Initial paper balance is invalid.");
  if (!Number.isFinite(account.balance) || account.balance < 0) blockers.push("Paper balance is invalid.");
  if (!Number.isFinite(account.equity) || account.equity < 0) blockers.push("Paper equity is invalid.");
  if (account.positions.filter((position) => position.status === "OPEN").length > 3) {
    blockers.push("Paper account exceeds the maximum open-position safety bound.");
  }

  const seenOrderIds = new Set<string>();
  for (const position of account.positions) {
    if (seenOrderIds.has(position.orderId)) blockers.push(`Duplicate paper order reference: ${position.orderId}.`);
    seenOrderIds.add(position.orderId);

    if (
      !finitePositive(position.quantity) ||
      !finitePositive(position.entryPrice) ||
      !finitePositive(position.stopLoss) ||
      !finitePositive(position.takeProfit)
    ) {
      blockers.push(`Position ${position.id} contains invalid numeric fields.`);
    }
  }

  if (account.equity < account.balance) warnings.push("Unrealized losses are reducing equity.");
  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    score: Math.max(0, 100 - blockers.length * 20 - warnings.length * 5),
  };
}

export function validateSetupCore(setup: TradingSetup): CoreSafetyResult {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (setup.direction === "NONE") return { valid: true, blockers, warnings, score: 100 };
  if (setup.entry === null || setup.stopLoss === null || setup.takeProfit === null) {
    blockers.push("Setup geometry is incomplete.");
  } else if (
    setup.direction === "LONG" &&
    !(setup.stopLoss < setup.entry && setup.takeProfit > setup.entry)
  ) {
    blockers.push("LONG setup geometry is invalid.");
  } else if (
    setup.direction === "SHORT" &&
    !(setup.stopLoss > setup.entry && setup.takeProfit < setup.entry)
  ) {
    blockers.push("SHORT setup geometry is invalid.");
  }

  if (!Number.isFinite(setup.riskReward ?? NaN) || (setup.riskReward ?? 0) < 1.5) {
    blockers.push("Setup risk/reward is below the 1.5R core minimum.");
  }
  if (!Number.isFinite(setup.confidence) || setup.confidence < 0 || setup.confidence > 100) {
    blockers.push("Setup confidence is outside 0-100.");
  }
  if (!setup.risk.allowed) blockers.push(setup.risk.reason);

  return {
    valid: blockers.length === 0,
    blockers,
    warnings,
    score: Math.max(0, 100 - blockers.length * 20),
  };
}
