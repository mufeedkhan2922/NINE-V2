import {
  MarketSnapshot,
  PaperAccount,
  SentinelDecision,
  SentinelGateResult,
  SentinelRiskSnapshot,
  TradingSetup,
} from "./types";

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function buildRiskSnapshot(
  market: MarketSnapshot,
  setup: TradingSetup,
  account: PaperAccount,
): SentinelRiskSnapshot {
  const openPositions = account.positions.filter(
    (position) => position.status === "OPEN",
  );

  const openNotional = openPositions.reduce(
    (sum, position) => sum + position.quantity * position.entryPrice,
    0,
  );

  const projectedLoss =
    setup.entry !== null && setup.stopLoss !== null
      ? Math.abs(setup.entry - setup.stopLoss) *
        Math.max(
          0,
          account.equity * (setup.risk.riskPercent / 100),
        ) /
        Math.max(Math.abs(setup.entry - setup.stopLoss), 0.000001)
      : 0;

  const dailyLossPercent =
    account.dailyStartBalance > 0
      ? Math.max(
          0,
          (-account.dailyRealizedPnl / account.dailyStartBalance) * 100,
        )
      : 0;

  const drawdownPercent =
    account.peakEquity > 0
      ? Math.max(
          0,
          ((account.peakEquity - account.equity) /
            account.peakEquity) *
            100,
        )
      : 0;

  const exposurePercent =
    account.equity > 0
      ? (openNotional / account.equity) * 100
      : 100;

  return {
    equity: account.equity,
    openPositions: openPositions.length,
    openNotional,
    dailyRealizedPnl: account.dailyRealizedPnl,
    dailyLossPercent,
    drawdownPercent,
    projectedLoss,
    riskPercent: setup.risk.riskPercent,
    maxRiskPercent: setup.risk.maxRiskPercent,
    exposurePercent,
  };
}

export function evaluateSentinel(
  market: MarketSnapshot,
  setup: TradingSetup,
  account: PaperAccount,
): SentinelGateResult {
  const risk = buildRiskSnapshot(market, setup, account);
  const checks: string[] = [];
  const blockers: string[] = [];

  const dataOK =
    market.tradingAllowed === true &&
    market.marketState?.tradingPermission === "ALLOWED" &&
    market.marketState?.dataState === "LIVE";

  if (dataOK) checks.push("Validated live market data ✓");
  else blockers.push("Market data is not currently validated for trading.");

  if (setup.validation.valid && setup.status === "VALID") {
    checks.push("Trading engine validation ✓");
  } else {
    blockers.push(
      setup.validation.blockers[0] ??
        "Trading setup did not pass engine validation.",
    );
  }

  if (setup.direction !== "NONE") checks.push("Trade direction confirmed ✓");
  else blockers.push("No trade direction is confirmed.");

  if (
    setup.entry !== null &&
    setup.stopLoss !== null &&
    setup.takeProfit !== null &&
    finitePositive(setup.entry) &&
    finitePositive(setup.stopLoss) &&
    finitePositive(setup.takeProfit)
  ) {
    checks.push("Trade geometry valid ✓");
  } else {
    blockers.push("Entry, stop loss, and take profit are required.");
  }

  if (setup.risk.allowed) checks.push("Risk budget ✓");
  else blockers.push(setup.risk.reason);

  const maxOpen = Math.max(
    1,
    Number(process.env.NINE_PAPER_MAX_OPEN_POSITIONS ?? 3),
  );
  if (risk.openPositions < maxOpen) {
    checks.push(`Open-position limit ${risk.openPositions}/${maxOpen} ✓`);
  } else {
    blockers.push(`Maximum of ${maxOpen} open positions reached.`);
  }

  const maxDailyLoss = Math.max(
    0.1,
    Number(process.env.NINE_MAX_DAILY_LOSS_PERCENT ?? 2),
  );
  if (risk.dailyLossPercent < maxDailyLoss) {
    checks.push(`Daily loss limit ${risk.dailyLossPercent.toFixed(2)}% ✓`);
  } else {
    blockers.push(`Daily loss limit of ${maxDailyLoss}% reached.`);
  }

  const maxDrawdown = Math.max(
    0.1,
    Number(process.env.NINE_MAX_DRAWDOWN_PERCENT ?? 5),
  );
  if (risk.drawdownPercent < maxDrawdown) {
    checks.push(`Drawdown ${risk.drawdownPercent.toFixed(2)}% ✓`);
  } else {
    blockers.push(`Maximum drawdown of ${maxDrawdown}% reached.`);
  }

  const maxExposure = Math.max(
    1,
    Number(process.env.NINE_MAX_EXPOSURE_PERCENT ?? 100),
  );
  if (risk.exposurePercent <= maxExposure) {
    checks.push(`Exposure ${risk.exposurePercent.toFixed(2)}% ✓`);
  } else {
    blockers.push(`Maximum exposure of ${maxExposure}% exceeded.`);
  }

  if (
    setup.risk.riskPercent > 0 &&
    setup.risk.riskPercent <= setup.risk.maxRiskPercent
  ) {
    checks.push("Risk-per-trade ceiling ✓");
  } else {
    blockers.push("Risk-per-trade ceiling exceeded.");
  }

  const approved = blockers.length === 0;

  return {
    approved,
    reason: approved
      ? "All Sentinel V2.4 gates passed."
      : blockers[0],
    checks: [...checks, ...blockers.map((item) => `BLOCK: ${item}`)],
    risk,
  };
}

export function sentinelDecision(
  market: MarketSnapshot,
  setup: TradingSetup,
  account: PaperAccount,
): SentinelDecision {
  const result = evaluateSentinel(market, setup, account);

  return {
    approved: result.approved,
    reason: result.reason,
    checks: result.checks,
  };
}
