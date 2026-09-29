import { Candle } from "./types";
import { analyzeTechnicals } from "./technical";
import { analyzeSMC } from "./smc";
import type {
  BacktestAnalytics,
  BacktestDistribution,
  BacktestEquityPoint,
} from "./types";

export interface BacktestTrade {
  id: string;
  index: number;
  side: "LONG" | "SHORT";
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  quantity: number;
  pnl: number;
  outcome: "WIN" | "LOSS";
  reason: "TARGET" | "STOP" | "END";
  entryReason: string;
  exitReason: string;
}

export interface BacktestResult extends BacktestAnalytics {
  initialBalance: number;
  finalBalance: number;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  netPnl: number;
  maxDrawdown: number;
  trades: BacktestTrade[];
  config: Record<string, number | string | boolean>;
  warnings: string[];
}

const WARMUP_CANDLES = 60;
const REWARD_RISK = 2;
const STOP_ATR_MULTIPLIER = 1.2;
const MIN_STOP_PERCENT = 0.12;
const MIN_SETUP_BODY_ATR = 0.35;
const MAX_ZONE_AGE_CANDLES = 12;
const ZONE_PROXIMITY_ATR = 0.2;
const COOLDOWN_CANDLES = 6;

function setupSignal(candles: Candle[]): { side: "LONG" | "SHORT" | null; reason: string } {
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  const current = candles.at(-1);
  if (!current || !tech.atr || !Number.isFinite(tech.atr)) {
    return { side: null, reason: "Insufficient setup data" };
  }

  const session = smc.chartist.session;
  if (session !== "LONDON" && session !== "NEW_YORK") {
    return { side: null, reason: "Outside London/New York trading session" };
  }

  const body = Math.abs(current.close - current.open);
  if (body < tech.atr * MIN_SETUP_BODY_ATR) {
    return { side: null, reason: "Setup candle body too small" };
  }

  const longTrigger = smc.sweepDirection === "LONG" || smc.structureDirection === "LONG";
  const shortTrigger = smc.sweepDirection === "SHORT" || smc.structureDirection === "SHORT";

  const recentCutoff = current.time - MAX_ZONE_AGE_CANDLES * 5 * 60 * 1000;
  const nearZone = (side: "LONG" | "SHORT") => {
    const zones = [...smc.chartist.fairValueGaps, ...smc.chartist.orderBlocks]
      .filter((zone) => zone.direction === side && zone.createdAt >= recentCutoff);
    return zones.some((zone) => {
      const inside = current.close >= zone.low && current.close <= zone.high;
      const distance = current.close < zone.low ? zone.low - current.close : current.close > zone.high ? current.close - zone.high : 0;
      return inside || distance <= tech.atr * ZONE_PROXIMITY_ATR;
    });
  };

  const longConfirmed =
    tech.trend === "BULLISH" &&
    tech.momentum === "BULLISH" &&
    current.close > current.open &&
    longTrigger;

  if (longConfirmed) {
    const confirmations = [
      smc.sweepDirection === "LONG" ? "liquidity sweep" : "MSS/CHoCH",
      nearZone("LONG") ? "fresh FVG/OB retest" : null,
      smc.premiumDiscount === "DISCOUNT" ? "discount" : null,
    ].filter(Boolean);
    return {
      side: "LONG",
      reason: `London/NY session; bullish trend + momentum; ${confirmations.join("; ") || "directional structure trigger"}`,
    };
  }

  const shortConfirmed =
    tech.trend === "BEARISH" &&
    tech.momentum === "BEARISH" &&
    current.close < current.open &&
    shortTrigger;

  if (shortConfirmed) {
    const confirmations = [
      smc.sweepDirection === "SHORT" ? "liquidity sweep" : "MSS/CHoCH",
      nearZone("SHORT") ? "fresh FVG/OB retest" : null,
      smc.premiumDiscount === "PREMIUM" ? "premium" : null,
    ].filter(Boolean);
    return {
      side: "SHORT",
      reason: `London/NY session; bearish trend + momentum; ${confirmations.join("; ") || "directional structure trigger"}`,
    };
  }

  return { side: null, reason: "No session-aligned directional setup" };
}
