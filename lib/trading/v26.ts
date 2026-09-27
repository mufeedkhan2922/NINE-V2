import { evaluateStrategyBook, type StrategyConsensus } from "./strategyEngine";
import { buildAdaptiveLearningSnapshot, type AdaptiveLearningSnapshot } from "./adaptiveLearning";
import type {
  AtlasContext,
  Candle,
  MarketSnapshot,
  PaperAccount,
  SentinelDecision,
  Timeframe,
  TradeDirection,
  TradingSetup,
} from "./types";

export type SetupLifecycle =
  | "FORMING"
  | "CONFIRMED"
  | "INVALIDATED"
  | "COMPLETED";

export interface MTFAlignment {
  direction: TradeDirection;
  score: number;
  timeframeDirections: Partial<
    Record<Timeframe, TradeDirection>
  >;
  reasons: string[];
}

export interface SetupV26 {
  id: string;
  symbol: MarketSnapshot["symbol"];
  lifecycle: SetupLifecycle;
  direction: TradeDirection;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  confidence: number;
  confluenceScore: number;
  reasons: string[];
  mtf: MTFAlignment;
  invalidation: string;
  generatedAt: number;
}

export interface BrainDecision {
  action:
    | "WATCH"
    | "PREPARE"
    | "PAPER_READY"
    | "BLOCKED";
  direction: TradeDirection;
  confidence: number;
  evidence: string[];
  blockers: string[];
  rationale: string;
  strategyConsensus?: StrategyConsensus;
  learning?: AdaptiveLearningSnapshot;
  generatedAt: number;
}

export interface MarketHealthV26 {
  state:
    | "HEALTHY"
    | "DEGRADED"
    | "BLOCKED";
  latencyMs: number | null;
  feedAgeSeconds: number;
  tradingAllowed: boolean;
  reasons: string[];
}

export interface RiskTelemetryV26 {
  equity: number;
  dailyLossPercent: number;
  drawdownPercent: number;
  openPositions: number;
  openNotional: number;
  projectedLoss: number;
  exposurePercent: number;
  consecutiveLosses: number;
  limits: {
    dailyLossPercent: number;
    drawdownPercent: number;
    openPositions: number;
    exposurePercent: number;
    consecutiveLosses: number;
  };
}

export interface BacktestV26Result {
  initialBalance: number;
  finalBalance: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  profitFactor: number;
  maxDrawdownPercent: number;
  averageWin: number;
  averageLoss: number;
  expectancy: number;
  sessionStats: Record<
    string,
    {
      trades: number;
      wins: number;
      pnl: number;
    }
  >;
}

export interface SignalEvent {
  type:
    | "SETUP_FORMING"
    | "SETUP_CONFIRMED"
    | "SETUP_INVALIDATED"
    | "SENTINEL_BLOCK"
    | "MARKET_DEGRADED"
    | "EXECUTION_READY";
  message: string;
  timestamp: number;
}

function closes(candles: Candle[]): number[] {
  return candles
    .map((c) => c.close)
    .filter(Number.isFinite);
}

function directionFromCandles(
  candles: Candle[],
): TradeDirection {
  if (candles.length < 20) {
    return "NONE";
  }

  const c = closes(candles);

  if (c.length < 20) {
    return "NONE";
  }

  const now = c.at(-1)!;
  const old =
    c[Math.max(0, c.length - 20)];

  const delta = now - old;

  const threshold = Math.max(
    Math.abs(old) * 0.00015,
    0.00001,
  );

  if (delta > threshold) {
    return "LONG";
  }

  if (delta < -threshold) {
    return "SHORT";
  }

  return "NONE";
}

export function buildMTFAlignment(
  market: MarketSnapshot,
): MTFAlignment {
  const frames: Timeframe[] = [
    "5min",
    "15min",
    "1h",
    "4h",
  ];

  const timeframeDirections: Partial<
    Record<Timeframe, TradeDirection>
  > = {};

  const reasons: string[] = [];

  let long = 0;
  let short = 0;

  for (const tf of frames) {
    const direction =
      directionFromCandles(
        market.timeframes?.[tf]?.candles ??
          [],
      );

    timeframeDirections[tf] =
      direction;

    if (direction === "LONG") {
      long += 1;
    }

    if (direction === "SHORT") {
      short += 1;
    }
  }

  const direction =
    long > short && long >= 2
      ? "LONG"
      : short > long && short >= 2
        ? "SHORT"
        : "NONE";

  const score = Math.round(
    (Math.max(long, short) /
      frames.length) *
      100,
  );

  if (direction !== "NONE") {
    reasons.push(
      `${direction} alignment across ${Math.max(
        long,
        short,
      )}/${frames.length} higher timeframes.`,
    );
  } else {
    reasons.push(
      "Higher timeframes are mixed; directional alignment is insufficient.",
    );
  }

  return {
    direction,
    score,
    timeframeDirections,
    reasons,
  };
}

export function buildSetupV26(
  market: MarketSnapshot,
  base: TradingSetup,
): SetupV26 {
  const mtf =
    buildMTFAlignment(market);

  const reasons = [
    ...mtf.reasons,
  ];

  if (base.smc.liquiditySweep) {
    reasons.push(
      "Liquidity sweep detected.",
    );
  }

  if (
    base.smc.marketStructureShift
  ) {
    reasons.push(
      "Market structure shift detected.",
    );
  }

  if (base.smc.fairValueGap) {
    reasons.push(
      "Fair value gap detected.",
    );
  }

  if (base.smc.orderBlock) {
    reasons.push(
      "Order block detected.",
    );
  }

  if (
    base.smc.chartist
      ?.chochDirection !== "NONE"
  ) {
    reasons.push(
      "CHoCH confirmation present.",
    );
  }

  if (
    base.smc.premiumDiscount ===
      "DISCOUNT" &&
    base.direction === "LONG"
  ) {
    reasons.push(
      "Long setup is in discount.",
    );
  }

  if (
    base.smc.premiumDiscount ===
      "PREMIUM" &&
    base.direction === "SHORT"
  ) {
    reasons.push(
      "Short setup is in premium.",
    );
  }

  const confluence = Math.min(
    100,
    (base.smc.liquiditySweep
      ? 15
      : 0) +
      (base.smc.marketStructureShift
        ? 15
        : 0) +
      (base.smc.fairValueGap
        ? 10
        : 0) +
      (base.smc.orderBlock
        ? 10
        : 0) +
      (base.smc.chartist
        ?.chochDirection !== "NONE"
        ? 10
        : 0) +
      (mtf.direction ===
        base.direction &&
      base.direction !== "NONE"
        ? 25
        : 0) +
      Math.min(
        15,
        base.confidence * 0.15,
      ),
  );

  const aligned =
    base.direction !== "NONE" &&
    mtf.direction ===
      base.direction;

  const lifecycle: SetupLifecycle =
    base.direction === "NONE"
      ? "INVALIDATED"
      : base.status === "VALID" && aligned && confluence >= 60
        ? "CONFIRMED"
        : "FORMING";

  const invalidation =
    base.direction === "LONG"
      ? `Invalidate below ${
          base.stopLoss ??
          "the structural low"
        }`
      : base.direction === "SHORT"
        ? `Invalidate above ${
            base.stopLoss ??
            "the structural high"
          }`
        : "No directional setup.";

  return {
    id: `V26-${market.symbol}-${market.timestamp}`,
    symbol: market.symbol,
    lifecycle,
    direction: base.direction,
    entry: base.entry,
    stopLoss: base.stopLoss,
    takeProfit: base.takeProfit,
    riskReward: base.riskReward,
    confidence: Math.round(
      Math.min(
        99,
        (base.confidence +
          confluence) /
          2,
      ),
    ),
    confluenceScore:
      Math.round(confluence),
    reasons,
    mtf,
    invalidation,
    generatedAt: Date.now(),
  };
}

export function buildMarketHealthV26(
  market: MarketSnapshot,
): MarketHealthV26 {
  const now = Date.now();

  const feedAgeSeconds =
    market.timestamp
      ? Math.max(
          0,
          (now -
            market.timestamp) /
            1000,
        )
      : Infinity;

  const staleSeconds =
    Number(
      process.env
        .NINE_MARKET_STALE_SECONDS ??
        20,
    );

  const allowed =
    market.tradingAllowed ===
      true &&
    market.marketState
      ?.tradingPermission ===
      "ALLOWED" &&
    market.marketState
      ?.dataState ===
      "LIVE" &&
    feedAgeSeconds <=
      staleSeconds;

  const reasons: string[] =
    [];

  if (!allowed) {
    reasons.push(
      "Validated live market permission is not available.",
    );
  }

  if (
    feedAgeSeconds >
    staleSeconds
  ) {
    reasons.push(
      "Market snapshot is stale.",
    );
  }

  if (
    market
      .microstructureValidation
      ?.valid === false
  ) {
    reasons.push(
      "Microstructure validation failed.",
    );
  }

  if (
    market
      .crossTimeframeValidation
      ?.valid === false
  ) {
    reasons.push(
      "Cross-timeframe validation failed.",
    );
  }

  return {
    state: allowed
      ? "HEALTHY"
      : reasons.length <= 1
        ? "DEGRADED"
        : "BLOCKED",

    latencyMs: null,

    feedAgeSeconds,

    tradingAllowed:
      allowed,

    reasons,
  };
}

/**
 * Calculate the trailing consecutive losing
 * closed-position count from durable paper
 * position history.
 *
 * Only completed positions are considered.
 * The scan starts with the most recently closed
 * position and stops at the first non-loss.
 *
 * Missing P&L or missing close time is ignored
 * rather than guessed.
 */
function consecutiveLosses(
  account: PaperAccount,
): number {
  const closed =
    account.positions
      .filter(
        (position) =>
          position.status ===
            "CLOSED" &&
          Number.isFinite(
            position.realizedPnl,
          ) &&
          Number.isFinite(
            position.closedAt,
          ),
      )
      .sort(
        (a, b) =>
          (b.closedAt ?? 0) -
          (a.closedAt ?? 0),
      );

  let losses = 0;

  for (const position of closed) {
    const pnl =
      position.realizedPnl;

    if (
      pnl === undefined ||
      !Number.isFinite(pnl)
    ) {
      continue;
    }

    if (pnl < 0) {
      losses += 1;
      continue;
    }

    /*
     * A break-even or profitable trade ends
     * the trailing loss streak.
     */
    break;
  }

  return losses;
}

export function buildRiskTelemetryV26(
  account: PaperAccount,
  setup: SetupV26,
  sentinel: SentinelDecision,
): RiskTelemetryV26 {
  void sentinel;

  const equity =
    Number.isFinite(
      account.equity,
    )
      ? account.equity
      : 0;

  const dailyLossPercent =
    account.dailyStartBalance >
    0
      ? Math.max(
          0,
          (-account.dailyRealizedPnl /
            account.dailyStartBalance) *
            100,
        )
      : 0;

  const drawdownPercent =
    account.peakEquity > 0
      ? Math.max(
          0,
          ((account.peakEquity -
            equity) /
            account.peakEquity) *
            100,
        )
      : 0;

  const open =
    account.positions.filter(
      (p) =>
        p.status === "OPEN",
    );

  const openNotional =
    open.reduce(
      (sum, p) =>
        sum +
        p.quantity *
          p.entryPrice,
      0,
    );

  const projectedLoss =
    setup.entry !== null &&
    setup.stopLoss !== null
      ? Math.abs(
          setup.entry -
            setup.stopLoss,
        ) *
        Math.max(
          0,
          Number(
            process.env
              .NINE_DEFAULT_ORDER_QUANTITY ??
              0.01,
          ),
        )
      : 0;

  const exposurePercent =
    equity > 0
      ? (openNotional /
          equity) *
        100
      : 100;

  return {
    equity,

    dailyLossPercent,

    drawdownPercent,

    openPositions:
      open.length,

    openNotional,

    projectedLoss,

    exposurePercent,

    consecutiveLosses:
      consecutiveLosses(
        account,
      ),

    limits: {
      dailyLossPercent:
        Number(
          process.env
            .NINE_MAX_DAILY_LOSS_PERCENT ??
            2,
        ),

      drawdownPercent:
        Number(
          process.env
            .NINE_MAX_DRAWDOWN_PERCENT ??
            5,
        ),

      openPositions:
        Number(
          process.env
            .NINE_PAPER_MAX_OPEN_POSITIONS ??
            3,
        ),

      exposurePercent:
        Number(
          process.env
            .NINE_MAX_EXPOSURE_PERCENT ??
            100,
        ),

      consecutiveLosses:
        Number(
          process.env
            .NINE_MAX_CONSECUTIVE_LOSSES ??
            3,
        ),
    },
  };
}

export function buildBrainDecision(
  market: MarketSnapshot,
  setup: SetupV26,
  atlas:
    | AtlasContext
    | undefined,
  sentinel: SentinelDecision,
): BrainDecision {
  const health =
    buildMarketHealthV26(
      market,
    );

  const strategyConsensus = evaluateStrategyBook(market);

  const learning =
    market.symbol === "XAUUSD"
      ? buildAdaptiveLearningSnapshot(market, {
          warmupCandles: Number(process.env.NINE_LEARNING_WARMUP_CANDLES ?? 100),
          evaluationHorizon: Number(process.env.NINE_LEARNING_HORIZON_CANDLES ?? 12),
          minimumScore: Number(process.env.NINE_LEARNING_MIN_SCORE ?? 65),
          minimumTrades: Number(process.env.NINE_LEARNING_MIN_TRADES ?? 20),
          targetWinRate: Number(process.env.NINE_LEARNING_TARGET_WIN_RATE ?? 90),
          spreadPrice: Number(process.env.NINE_LEARNING_SPREAD_PRICE ?? 0),
          slippagePrice: Number(process.env.NINE_LEARNING_SLIPPAGE_PRICE ?? 0),
        })
      : undefined;

  const evidence = [
    ...setup.reasons.slice(
      0,
      8,
    ),
  ];

  const blockers = [
    ...health.reasons,
  ];

  if (strategyConsensus.candidates.length) {
    evidence.push(
      "Strategy book: " + strategyConsensus.activeStrategies + " active, " + strategyConsensus.alignedStrategies + " aligned, regime " + strategyConsensus.regime + ".",
    );
    for (const candidate of strategyConsensus.candidates.slice(0, 3)) {
      evidence.push(candidate.strategyName + ": " + candidate.score + "/100 " + candidate.direction + ".");
    }
  }

  if (learning) {
    if (learning.bestStrategyName) {
      evidence.push(
        "Adaptive learning: " +
          learning.bestStrategyName +
          " measured at " +
          (learning.bestWinRate ?? 0) +
          "% over " +
          learning.totalEvaluatedSignals +
          " evaluated signals.",
      );
    }
    evidence.push(
      learning.targetReached
        ? "Adaptive learning target reached on the measured walk-forward sample."
        : "Adaptive learning target not yet proven; NINE will not treat the target as guaranteed.",
    );
  }

  if (
    atlas?.sourceStatus ===
    "UNAVAILABLE"
  ) {
    evidence.push(
      "Atlas external sources are unavailable; macro evidence is limited.",
    );
  } else if (
    atlas?.macroBias &&
    atlas.macroBias !==
      "NEUTRAL"
  ) {
    evidence.push(
      `Atlas macro bias: ${atlas.macroBias}.`,
    );
  }

  if (!sentinel.approved) {
    blockers.push(
      sentinel.reason,
    );
  }

  if (!health.tradingAllowed) {
    return {
      action: "BLOCKED",
      direction:
        setup.direction,
      confidence:
        Math.min(99, Math.round((setup.confidence + strategyConsensus.confidence) / 2)),
      evidence,
      blockers,
      rationale:
        "Market health does not satisfy the execution gate.",
      strategyConsensus,
      learning,
      generatedAt:
        Date.now(),
    };
  }

  if (
    setup.lifecycle ===
      "CONFIRMED" &&
    sentinel.approved
  ) {
    return {
      action:
        "PAPER_READY",

      direction:
        setup.direction,

      confidence:
        Math.min(99, Math.round((setup.confidence + strategyConsensus.confidence) / 2)),

      evidence,

      blockers,

      rationale:
        "MTF alignment, setup confluence, validated market data, Sentinel approval, and multi-strategy evidence are present.",

      strategyConsensus,

      generatedAt:
        Date.now(),
    };
  }

  if (
    setup.lifecycle ===
    "FORMING"
  ) {
    return {
      action:
        "PREPARE",

      direction:
        setup.direction,

      confidence:
        Math.min(99, Math.round((setup.confidence + strategyConsensus.confidence) / 2)),

      evidence,

      blockers,

      rationale:
        "A directional structure is forming but confirmation is incomplete.",

      strategyConsensus,

      generatedAt:
        Date.now(),
    };
  }

  return {
    action: "WATCH",

    direction:
      setup.direction,

    confidence:
      Math.min(99, Math.round((setup.confidence + strategyConsensus.confidence) / 2)),

    evidence,

    blockers,

    rationale:
      "NINE is monitoring for a complete, validated setup.",

    strategyConsensus,

    learning,

    generatedAt:
      Date.now(),
  };
}

export function buildSignalEvents(
  market: MarketSnapshot,
  setup: SetupV26,
  sentinel: SentinelDecision,
): SignalEvent[] {
  const events: SignalEvent[] =
    [];

  const timestamp =
    Date.now();

  if (
    setup.lifecycle ===
    "FORMING"
  ) {
    events.push({
      type:
        "SETUP_FORMING",

      message:
        `${setup.direction} setup is forming.`,

      timestamp,
    });
  }

  if (
    setup.lifecycle ===
    "CONFIRMED"
  ) {
    events.push({
      type:
        "SETUP_CONFIRMED",

      message:
        `${setup.direction} setup confirmed at ${setup.confluenceScore}% confluence.`,

      timestamp,
    });
  }

  if (
    setup.lifecycle ===
    "INVALIDATED"
  ) {
    events.push({
      type:
        "SETUP_INVALIDATED",

      message:
        "Setup is invalidated or has no confirmed direction.",

      timestamp,
    });
  }

  if (!sentinel.approved) {
    events.push({
      type:
        "SENTINEL_BLOCK",

      message:
        sentinel.reason,

      timestamp,
    });
  }

  const health =
    buildMarketHealthV26(
      market,
    );

  if (
    !health.tradingAllowed
  ) {
    events.push({
      type:
        "MARKET_DEGRADED",

      message:
        "Market health is blocking execution.",

      timestamp,
    });
  }

  if (
    setup.lifecycle ===
      "CONFIRMED" &&
    sentinel.approved &&
    health.tradingAllowed
  ) {
    events.push({
      type:
        "EXECUTION_READY",

      message:
        "Paper execution gate is ready; live execution remains separately locked.",

      timestamp,
    });
  }

  return events;
}

function sessionOf(
  time: number,
): string {
  const hour =
    new Date(time).getUTCHours();

  if (
    hour >= 0 &&
    hour < 8
  ) {
    return "ASIA";
  }

  if (
    hour >= 8 &&
    hour < 13
  ) {
    return "LONDON";
  }

  if (
    hour >= 13 &&
    hour < 21
  ) {
    return "NEW_YORK";
  }

  return "OFF_SESSION";
}

export function runBacktestV26(
  candles: Candle[],
  initialBalance = 10000,
  riskPercent = 0.5,
): BacktestV26Result {
  if (candles.length < 40) {
    return {
      initialBalance: Number(initialBalance),
      finalBalance: Number(initialBalance),
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      netPnl: 0,
      profitFactor: 0,
      maxDrawdownPercent: 0,
      averageWin: 0,
      averageLoss: 0,
      expectancy: 0,
      sessionStats: {},
    };
  }

  let balance =
    initialBalance;

  let peak =
    initialBalance;

  let maxDrawdown = 0;

  const pnls: number[] =
    [];

  const sessionStats: BacktestV26Result["sessionStats"] =
    {};

  for (
    let i = 30;
    i < candles.length - 2;
    i += 1
  ) {
    const window =
      candles.slice(
        Math.max(0, i - 30),
        i + 1,
      );

    const direction =
      directionFromCandles(
        window,
      );

    if (
      direction === "NONE"
    ) {
      continue;
    }

    const entry =
      candles[i + 1].open;

    const ranges =
      window
        .slice(-14)
        .map(
          (c) =>
            c.high - c.low,
        )
        .filter(
          (x) => x > 0,
        );

    const atr =
      ranges.length
        ? ranges.reduce(
            (a, b) => a + b,
            0,
          ) /
          ranges.length
        : 0;

    if (!(atr > 0)) {
      continue;
    }

    const riskDistance =
      Math.max(
        atr * 1.2,
        entry * 0.001,
      );

    const stop =
      direction === "LONG"
        ? entry -
          riskDistance
        : entry +
          riskDistance;

    const target =
      direction === "LONG"
        ? entry +
          riskDistance * 2
        : entry -
          riskDistance * 2;

    const riskDollars =
      balance *
      (riskPercent / 100);

    const quantity =
      riskDollars /
      riskDistance;

    if (
      !(quantity > 0) ||
      !Number.isFinite(
        quantity,
      )
    ) {
      continue;
    }

    let exit =
      candles[i + 1].close;

    let reason = "END";

    let exitIndex =
      i + 1;

    for (
      let j = i + 1;
      j <
      Math.min(
        candles.length,
        i + 41,
      );
      j += 1
    ) {
      const bar =
        candles[j];

      const stopHit =
        direction === "LONG"
          ? bar.low <= stop
          : bar.high >= stop;

      const targetHit =
        direction === "LONG"
          ? bar.high >= target
          : bar.low <= target;

      if (
        stopHit ||
        targetHit
      ) {
        exit = stopHit
          ? stop
          : target;

        reason = stopHit
          ? "STOP"
          : "TARGET";

        exitIndex = j;

        break;
      }

      exit = bar.close;

      exitIndex = j;
    }

    const pnl =
      direction === "LONG"
        ? (exit - entry) *
          quantity
        : (entry - exit) *
          quantity;

    balance += pnl;

    peak = Math.max(
      peak,
      balance,
    );

    maxDrawdown =
      Math.max(
        maxDrawdown,
        peak > 0
          ? ((peak -
              balance) /
              peak) *
            100
          : 0,
      );

    pnls.push(pnl);

    const session =
      sessionOf(
        candles[i + 1].time,
      );

    const stats =
      sessionStats[session] ??
      {
        trades: 0,
        wins: 0,
        pnl: 0,
      };

    stats.trades += 1;

    if (pnl > 0) {
      stats.wins += 1;
    }

    stats.pnl += pnl;

    sessionStats[session] =
      stats;

    if (
      reason !== "END"
    ) {
      i = exitIndex;
    }
  }

  const wins =
    pnls.filter(
      (p) => p > 0,
    );

  const losses =
    pnls.filter(
      (p) => p < 0,
    );

  const grossWin =
    wins.reduce(
      (a, b) => a + b,
      0,
    );

  const grossLoss =
    Math.abs(
      losses.reduce(
        (a, b) => a + b,
        0,
      ),
    );

  const averageWin =
    wins.length
      ? grossWin /
        wins.length
      : 0;

  const averageLoss =
    losses.length
      ? grossLoss /
        losses.length
      : 0;

  return {
    initialBalance:
      Number(initialBalance),

    finalBalance:
      Number(balance),

    totalTrades:
      pnls.length,

    wins:
      wins.length,

    losses:
      losses.length,

    winRate:
      pnls.length
        ? (wins.length /
            pnls.length) *
          100
        : 0,

    netPnl:
      balance -
      initialBalance,

    profitFactor:
      grossLoss
        ? grossWin /
          grossLoss
        : wins.length
          ? Infinity
          : 0,

    maxDrawdownPercent:
      maxDrawdown,

    averageWin,

    averageLoss,

    expectancy:
      pnls.length
        ? pnls.reduce(
            (a, b) => a + b,
            0,
          ) /
          pnls.length
        : 0,

    sessionStats,
  };
}