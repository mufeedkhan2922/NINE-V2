import { Candle } from "./types";
import { analyzeTechnicals } from "./technical";
import { analyzeSMC } from "./smc";

export interface BacktestTrade { id: string; index: number; side: "LONG" | "SHORT"; entryTime: number; exitTime: number; entryPrice: number; exitPrice: number; stopLoss: number; takeProfit: number; quantity: number; pnl: number; outcome: "WIN" | "LOSS"; reason: "TARGET" | "STOP" | "END"; }
export interface BacktestResult { initialBalance: number; finalBalance: number; totalTrades: number; wins: number; losses: number; winRate: number; netPnl: number; maxDrawdown: number; profitFactor: number; trades: BacktestTrade[]; config: Record<string, number>; }

function signal(candles: Candle[]): "LONG" | "SHORT" | null {
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  if (tech.trend === "BULLISH" && (smc.structureDirection === "LONG" || smc.sweepDirection === "LONG")) return "LONG";
  if (tech.trend === "BEARISH" && (smc.structureDirection === "SHORT" || smc.sweepDirection === "SHORT")) return "SHORT";
  return null;
}

export function runBacktest(candles: Candle[], initialBalance = 10000, riskPercent = 0.5): BacktestResult {
  const trades: BacktestTrade[] = [];
  let balance = initialBalance, peak = initialBalance, maxDrawdown = 0;
  for (let i = 60; i < candles.length - 1; i += 1) {
    const setupCandles = candles.slice(0, i + 1);
    const side = signal(setupCandles);
    if (!side) continue;
    const tech = analyzeTechnicals(setupCandles);
    if (!tech.atr || !Number.isFinite(tech.atr)) continue;
    const entry = candles[i + 1].open;
    const stopDistance = Math.max(tech.atr * 1.2, entry * 0.0012);
    const stop = side === "LONG" ? entry - stopDistance : entry + stopDistance;
    const target = side === "LONG" ? entry + stopDistance * 2 : entry - stopDistance * 2;
    const riskDollars = balance * (riskPercent / 100);
    const quantity = Number((riskDollars / stopDistance).toFixed(4));
    if (!(quantity > 0)) continue;
    let exit = candles[i + 1].close, reason: BacktestTrade["reason"] = "END", exitIndex = i + 1;
    for (let j = i + 1; j < candles.length; j += 1) {
      const bar = candles[j];
      const stopHit = side === "LONG" ? bar.low <= stop : bar.high >= stop;
      const targetHit = side === "LONG" ? bar.high >= target : bar.low <= target;
      if (stopHit || targetHit) { reason = stopHit ? "STOP" : "TARGET"; exit = stopHit ? stop : target; exitIndex = j; break; }
      exit = bar.close;
    }
    const pnl = side === "LONG" ? (exit - entry) * quantity : (entry - exit) * quantity;
    balance += pnl;
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);
    trades.push({ id: `BT-${i}-${exitIndex}`, index: i, side, entryTime: candles[i + 1].time, exitTime: candles[exitIndex].time, entryPrice: entry, exitPrice: exit, stopLoss: stop, takeProfit: target, quantity, pnl, outcome: pnl >= 0 ? "WIN" : "LOSS", reason });
    i = exitIndex;
  }
  const wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0), grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  return { initialBalance, finalBalance: balance, totalTrades: trades.length, wins: wins.length, losses: losses.length, winRate: trades.length ? (wins.length / trades.length) * 100 : 0, netPnl: balance - initialBalance, maxDrawdown, profitFactor: grossLoss ? grossWin / grossLoss : wins.length ? Number.POSITIVE_INFINITY : 0, trades, config: { riskPercent } };
}
