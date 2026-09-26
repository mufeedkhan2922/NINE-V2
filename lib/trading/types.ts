export type MarketSymbol = "XAUUSD" | "NIFTY" | "BANKNIFTY";

export type Timeframe =
  | "1min"
  | "5min"
  | "15min"
  | "1h"
  | "4h"
  | "1day";

export type TradeDirection = "LONG" | "SHORT" | "NONE";
export type MarketBias = "BULLISH" | "BEARISH" | "NEUTRAL";
export type SetupStatus = "WATCHING" | "VALID" | "BLOCKED" | "INVALID";
export type MarketState = "OPEN" | "CLOSED" | "PRE_OPEN" | "UNKNOWN";
export type DataState =
  | "LIVE"
  | "DELAYED"
  | "STALE"
  | "SUSPICIOUS"
  | "UNKNOWN";
export type TradingPermission = "ALLOWED" | "BLOCKED";
export type AgentId = "ATLAS" | "CHARTIST" | "SENTINEL" | "NINE";
export type AgentStatus = "ONLINE" | "DEGRADED" | "BLOCKED";
export type OrderSide = "BUY" | "SELL";

export type OrderStatus =
  | "PENDING"
  | "SUBMITTING"
  | "SUBMITTED"
  | "FILLED"
  | "CLOSED"
  | "CANCELLED"
  | "REJECTED";

export type ExecutionMode = "PAPER" | "LIVE";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface TimeframeData {
  timeframe: Timeframe;
  candles: Candle[];
  latestPrice: number;
  previousClose: number;
  changePercent: number;
  updatedAt: number;
}

export interface DataQualityStats {
  candleCount: number;
  duplicateTimestamps: number;
  invalidOHLC: number;
  abnormalRanges: number;
  timestampGaps: number;
  medianRange: number;
}

export interface DataQualityResult {
  valid: boolean;
  score: number;
  issues: string[];
  warnings: string[];
  stats: DataQualityStats;
}

export interface CrossTimeframeResult {
  valid: boolean;
  score: number;
  issues: string[];
  warnings: string[];
  repeatedPriceRatio: number;
  compressionRatio: number;
  latestPriceDeviationPercent: number;
  aggregationChecks: {
    oneMinuteToFiveMinute: boolean;
    fiveMinuteToFifteenMinute: boolean;
    oneHourToFourHour: boolean;
  };
  staleFeed: boolean;
  providerAnomaly: boolean;
}

export interface MicrostructureResult {
  valid: boolean;
  score: number;
  issues: string[];
  warnings: string[];
  sampleSize: number;
  uniqueCloseRatio: number;
  uniqueHighRatio: number;
  uniqueLowRatio: number;
  closeMovementDiversity: number;
  rangeDiversity: number;
  repeatedRangeRatio: number;
  repeatedLowRatio: number;
  repeatedHighRatio: number;
  directionalAlternationRatio: number;
  closeRangeRatio: number;
  suspiciousSignals: string[];
}

export interface MarketStateAssessment {
  marketState: MarketState;
  dataState: DataState;
  tradingPermission: TradingPermission;
  reasons: string[];
  warnings: string[];
  latestCandleTime: number;
  latestCandleAgeSeconds: number;
  oneMinuteAgeSeconds: number;
  fiveMinuteAgeSeconds: number;
  fifteenMinuteAgeSeconds: number;
  oneHourAgeSeconds: number;
  fourHourAgeSeconds: number;
  feedActivity: boolean;
  suspiciousFeed: boolean;
}

export interface MarketSnapshot {
  symbol: MarketSymbol;
  price: number;
  previousClose: number;
  changePercent: number;
  candles: Candle[];
  timestamp: number;
  timeframes?: Partial<Record<Timeframe, TimeframeData>>;
  previousDayHigh?: number;
  previousDayLow?: number;
  previousDayClose?: number;
  dataQuality?: Partial<Record<Timeframe, DataQualityResult>>;
  crossTimeframeValidation?: CrossTimeframeResult;
  microstructureValidation?: MicrostructureResult;
  marketState?: MarketStateAssessment;
  tradingAllowed?: boolean;
  priceSource?: "QUOTE" | "CANDLE";
}

export interface TechnicalAnalysis {
  trend: MarketBias;
  momentum: MarketBias;
  structure: string;
  atr: number;
  emaFast: number;
  emaSlow: number;
}

export interface SMCAnalysis {
  liquiditySweep: boolean;
  marketStructureShift: boolean;
  fairValueGap: boolean;
  orderBlock: boolean;
  premiumDiscount: "PREMIUM" | "DISCOUNT" | "EQUILIBRIUM";
  sweepDirection: TradeDirection;
  structureDirection: TradeDirection;
  chartist?: ChartistAnalysis;
}

export interface RiskAssessment {
  allowed: boolean;
  riskPercent: number;
  reason: string;
  maxRiskPercent: number;
}

export interface EngineValidation {
  valid: boolean;
  score: number;
  blockers: string[];
  warnings: string[];
  checks: {
    marketData: boolean;
    dataQuality: boolean;
    crossTimeframe: boolean;
    microstructure: boolean;
    marketState: boolean;
    risk: boolean;
    setup: boolean;
  };
}

export interface TradingSetup {
  symbol: MarketSymbol;
  direction: TradeDirection;
  status: SetupStatus;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  marketBias: MarketBias;
  confidence: number;
  technical: TechnicalAnalysis;
  smc: SMCAnalysis;
  risk: RiskAssessment;
  validation: EngineValidation;
  generatedAt: number;
}

export interface AgentReport {
  id: AgentId;
  name: string;
  status: AgentStatus;
  summary: string;
  signals: string[];
  confidence: number;
  generatedAt: number;
}

export interface SentinelDecision {
  approved: boolean;
  reason: string;
  checks: string[];
}

export interface NINEOrchestration {
  agentReports: AgentReport[];
  atlas?: AtlasContext;
  setup: TradingSetup;
  sentinel: SentinelDecision;
  executionMode: ExecutionMode;
  commandSummary: string;
  generatedAt: number;
}

export interface PaperPosition {
  id: string;
  orderId: string;
  symbol: MarketSymbol;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  openedAt: number;
  status: "OPEN" | "CLOSED";
  exitPrice?: number;
  closedAt?: number;
  realizedPnl?: number;
}

export interface PaperAccount {
  currency: "USD";
  initialBalance: number;
  balance: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  positions: PaperPosition[];
  updatedAt: number;
  peakEquity: number;
  dailyStartBalance: number;
  dailyRealizedPnl: number;
  tradingDay: string;
}

export type TradingEventType =
  | "PAPER_OPEN"
  | "PAPER_CLOSE"
  | "PAPER_REJECT"
  | "RISK_GUARD"
  | "BROKER_REJECT"
  | "BROKER_SUBMIT"
  | "COMMAND";

export interface TradingEvent {
  id: string;
  type: TradingEventType;
  timestamp: number;
  message: string;
  symbol?: MarketSymbol;
  positionId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ExecutionRequest {
  symbol: MarketSymbol;
  side: OrderSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  mode: ExecutionMode;
  sentinelApproved: boolean;
}

export interface ExecutionResult {
  accepted: boolean;
  mode: ExecutionMode;
  status: "SIMULATED" | "SUBMITTED" | "REJECTED";
  message: string;
  brokerOrderId?: string;
  orderId?: string;
  timestamp: number;
}

export interface ExecutionLedgerRecord {
  id: string;
  eventType:
    | "SUBMIT"
    | "FILL"
    | "REJECT"
    | "CANCEL"
    | "CLOSE"
    | "RISK_BLOCK";
  timestamp: number;
  symbol: MarketSymbol;
  mode: ExecutionMode;
  side: OrderSide;
  quantity: number;
  price: number;
  stopLoss: number;
  takeProfit: number;
  status: string;
  brokerOrderId?: string;
  orderId?: string;
  requestHash?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface TradingOrder {
  id: string;
  accountId?: string;
  symbol: MarketSymbol;
  mode: ExecutionMode;
  side: OrderSide;
  quantity: number;
  requestedPrice: number;
  filledPrice?: number;
  stopLoss: number;
  takeProfit: number;
  status: OrderStatus;
  brokerOrderId?: string;
  sentinelApproved: boolean;
  requestHash: string;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SMCZone {
  high: number;
  low: number;
  direction: TradeDirection;
  createdAt: number;
}

export interface ChartistAnalysis {
  liquidityHigh: number | null;
  liquidityLow: number | null;
  fairValueGaps: SMCZone[];
  orderBlocks: SMCZone[];
  mssDirection: TradeDirection;
  chochDirection: TradeDirection;
  session: "ASIA" | "LONDON" | "NEW_YORK" | "OFF_SESSION";
  sessionHigh: number | null;
  sessionLow: number | null;
}

export interface AtlasContext {
  headlineCount: number;
  bullish: number;
  bearish: number;
  neutral: number;
  headlines: Array<{
    title: string;
    source: string;
    url?: string;
    sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
    publishedAt?: string;
  }>;
  macroBias: MarketBias;
  summary: string;
  generatedAt: number;
}

export interface AdvancedRiskAssessment extends RiskAssessment {
  accountEquity?: number;
  dailyLossLimitPercent: number;
  maxDrawdownPercent: number;
  exposurePercent: number;
  riskBudgetDollars: number;
  projectedLossDollars: number;
  warnings: string[];
}