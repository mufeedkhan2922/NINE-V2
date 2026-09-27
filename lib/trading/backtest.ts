import { Candle, BacktestResult, BacktestTrade } from "./types";
import { analyzeTechnicals } from "./technical";
import { analyzeSMC } from "./smc";

function signal(candles: Candle[]): { side: "LONG" | "SHORT" | null; reason: string; score: number } {
  const tech = analyzeTechnicals(candles);
  const smc = analyzeSMC(candles);
  const reasons: string[] = [];
  if (tech.trend === "BULLISH") reasons.push("Bullish EMA/trend alignment");
  if (tech.trend === "BEARISH") reasons.push("Bearish EMA/trend alignment");
  if (smc.liquiditySweep) reasons.push(`${smc.sweepDirection} liquidity sweep`);
  if (smc.marketStructureShift) reasons.push(`${smc.structureDirection} market-structure shift`);
  if (smc.fairValueGap) reasons.push("FVG present");
  if (smc.orderBlock) reasons.push("Order block present");
  if (smc.chartist?.chochDirection && smc.chartist.chochDirection !== "NONE") reasons.push(`${smc.chartist.chochDirection} CHoCH`);
  const side = tech.trend === "BULLISH" && (smc.structureDirection === "LONG" || smc.sweepDirection === "LONG") ? "LONG" : tech.trend === "BEARISH" && (smc.structureDirection === "SHORT" || smc.sweepDirection === "SHORT") ? "SHORT" : null;
  return { side, reason: reasons.length ? reasons.join(" · ") : "No confirmed technical/SMC alignment", score: Math.min(100, (side ? 40 : 20) + reasons.length * 10) };
}

export function runBacktest(candles: Candle[], initialBalance = 10000, riskPercent = 0.5): BacktestResult {
  const trades: BacktestTrade[] = [];
  let balance = initialBalance;
  let peak = initialBalance;
  let maxDD = 0;
  let winStreak = 0, lossStreak = 0, currentWin = 0, currentLoss = 0;
  const equityCurve = candles.length ? [{ time: candles[0].time, balance, drawdown: 0 }] : [];
  for (let i = 60; i < candles.length - 1; i += 1) {
    const setupCandles = candles.slice(0, i + 1);
    const sig = signal(setupCandles);
    if (!sig.side) continue;
    const tech = analyzeTechnicals(setupCandles);
    if (!(tech.atr > 0)) continue;
    const entry = candles[i + 1].open;
    const stopDistance = Math.max(tech.atr * 1.2, entry * 0.0012);
    const stop = sig.side === "LONG" ? entry - stopDistance : entry + stopDistance;
    const target = sig.side === "LONG" ? entry + stopDistance * 2 : entry - stopDistance * 2;
    const riskDollars = balance * (riskPercent / 100);
    const quantity = Number((riskDollars / stopDistance).toFixed(4));
    if (!(quantity > 0)) continue;
    let exit = candles[i + 1].close;
    let reason: BacktestTrade["reason"] = "END";
    let exitIndex = i + 1;
    let exitReason = "Replay ended before target/stop.";
    for (let j = i + 1; j < candles.length; j += 1) {
      const bar = candles[j];
      const stopHit = sig.side === "LONG" ? bar.low <= stop : bar.high >= stop;
      const targetHit = sig.side === "LONG" ? bar.high >= target : bar.low <= target;
      if (stopHit || targetHit) {
        reason = stopHit ? "STOP" : "TARGET";
        exit = stopHit ? stop : target;
        exitIndex = j;
        exitReason = stopHit ? "Protective stop was hit." : "Risk/reward target was reached.";
        break;
      }
      exit = bar.close;
    }
    const pnl = sig.side === "LONG" ? (exit - entry) * quantity : (entry - exit) * quantity;
    balance += pnl;
    peak = Math.max(peak, balance);
    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    maxDD = Math.max(maxDD, dd);
    if (pnl > 0) { currentWin += 1; currentLoss = 0; winStreak = Math.max(winStreak, currentWin); }
    else if (pnl < 0) { currentLoss += 1; currentWin = 0; lossStreak = Math.max(lossStreak, currentLoss); }
    trades.push({
      id: `BT-${i}-${exitIndex}`, index: i, side: sig.side,
      entryTime: candles[i + 1].time, exitTime: candles[exitIndex].time,
      entryPrice: entry, exitPrice: exit, stopLoss: stop, takeProfit: target, quantity, pnl,
      outcome: pnl > 0 ? "WIN" : "LOSS", reason, entryReason: sig.reason, exitReason,
      setupScore: sig.score, cumulativePnl: balance - initialBalance, balanceAfter: balance,
    });
    equityCurve.push({ time: candles[exitIndex].time, balance, drawdown: dd });
    i = exitIndex;
  }
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const breakevens = trades.filter(t => t.pnl === 0);
  const grossWin = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const expectancy = trades.length ? trades.reduce((s, t) => s + t.pnl, 0) / trades.length : 0;
  return {
    initialBalance, finalBalance: balance, totalTrades: trades.length, wins: wins.length, losses: losses.length, breakevens: breakevens.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0, netPnl: balance - initialBalance, maxDrawdown: maxDD,
    profitFactor: grossLoss ? grossWin / grossLoss : wins.length ? Number.POSITIVE_INFINITY : 0, expectancy,
    averageWin: wins.length ? grossWin / wins.length : 0, averageLoss: losses.length ? grossLoss / losses.length : 0,
    winStreak, lossStreak, equityCurve, outcomeDistribution: { wins: wins.length, losses: losses.length, breakevens: breakevens.length },
    trades, config: { riskPercent, rr: 2, minWarmupCandles: 60 }, generatedAt: Date.now(),
    dataStartTime: candles[0]?.time ?? null, dataEndTime: candles.at(-1)?.time ?? null, candlesUsed: candles.length,
  };
}