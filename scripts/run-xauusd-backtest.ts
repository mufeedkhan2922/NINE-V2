import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest } from "../lib/trading/backtest";
import type { BacktestTrade } from "../lib/trading/backtest";

const START = process.env.NINE_BACKTEST_START ?? "2026-09-15";
const END = process.env.NINE_BACKTEST_END ?? "2026-09-29";
const TIMEFRAME = "5min" as const;
const INITIAL_BALANCE = Number(process.env.NINE_BACKTEST_INITIAL_BALANCE ?? "10000");
const FIXED_LOT = Number(process.env.NINE_BACKTEST_LOTS ?? "0.01");
const CONTRACT_SIZE_OZ = Number(process.env.NINE_XAUUSD_CONTRACT_SIZE_OZ ?? "100");
const OUNCE_SIZE = FIXED_LOT * CONTRACT_SIZE_OZ;

function fixedPnl(trade: BacktestTrade): number {
  const move = trade.side === "LONG"
    ? trade.exitPrice - trade.entryPrice
    : trade.entryPrice - trade.exitPrice;
  return move * OUNCE_SIZE;
}

function fixedRisk(trade: BacktestTrade): number {
  const move = trade.side === "LONG"
    ? trade.entryPrice - trade.stopLoss
    : trade.stopLoss - trade.entryPrice;
  return Math.abs(move) * OUNCE_SIZE;
}

function money(value: number): number {
  return Number(value.toFixed(2));
}

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) {
    throw new Error("TWELVE_DATA_API_KEY is missing from the workflow environment.");
  }
  if (!(INITIAL_BALANCE > 0) || !(FIXED_LOT > 0) || !(CONTRACT_SIZE_OZ > 0)) {
    throw new Error("Invalid backtest configuration.");
  }

  const candles = await fetchProviderHistoricalCandles("XAUUSD", TIMEFRAME, START, END);
  const base = runBacktest(candles, INITIAL_BALANCE, 0.5);

  let balance = INITIAL_BALANCE;
  let peak = INITIAL_BALANCE;
  let maxDrawdown = 0;

  const trades = base.trades.map((trade, index) => {
    const pnl = fixedPnl(trade);
    balance += pnl;
    peak = Math.max(peak, balance);
    maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - balance) / peak) * 100 : 0);

    return {
      trade: index + 1,
      id: trade.id,
      side: trade.side,
      entryTime: new Date(trade.entryTime).toISOString(),
      exitTime: new Date(trade.exitTime).toISOString(),
      entryPrice: money(trade.entryPrice),
      exitPrice: money(trade.exitPrice),
      stopLoss: money(trade.stopLoss),
      takeProfit: money(trade.takeProfit),
      pnl: money(pnl),
      riskUsd: money(fixedRisk(trade)),
      rMultiple: fixedRisk(trade) > 0 ? money(pnl / fixedRisk(trade)) : 0,
      outcome: pnl >= 0 ? "WIN" : "LOSS",
      reason: trade.reason,
      entryReason: trade.entryReason,
      exitReason: trade.exitReason,
    };
  });

  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossWin = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const netPnl = balance - INITIAL_BALANCE;

  const result = {
    instrument: "XAUUSD",
    timeframe: TIMEFRAME,
    start: START,
    end: END,
    dataPoints: candles.length,
    fixedLot: FIXED_LOT,
    contractSizeOzPerLot: CONTRACT_SIZE_OZ,
    effectiveExposureOz: OUNCE_SIZE,
    initialBalance: INITIAL_BALANCE,
    finalBalance: money(balance),
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? money((wins.length / trades.length) * 100) : 0,
    netPnl: money(netPnl),
    profitFactor: grossLoss ? money(grossWin / grossLoss) : (wins.length ? null : 0),
    averageWin: wins.length ? money(grossWin / wins.length) : 0,
    averageLoss: losses.length ? money(-grossLoss / losses.length) : 0,
    expectancyPerTrade: trades.length ? money(netPnl / trades.length) : 0,
    maxDrawdownPercent: money(maxDrawdown),
    strategyConfig: base.config,
    warnings: [
      ...base.warnings,
      "Fixed-lot P&L is calculated at the requested 0.01 lot using the configured 100 oz per 1.00 lot XAUUSD contract assumption.",
      "No spread, commission, swap/financing or slippage is added unless present in the source prices.",
      "This is a historical simulation, not a live execution record or a guarantee of future performance.",
    ],
    trades,
  };

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-backtest-0.01lot.json", JSON.stringify(result, null, 2));

  const lines = [
    "# NINE XAUUSD Backtest — 0.01 Lot",
    "",
    `Period: ${START} to ${END}`,
    `Timeframe: ${TIMEFRAME}`,
    `Data points: ${candles.length}`,
    `Initial balance: $${INITIAL_BALANCE.toFixed(2)}`,
    `Fixed size: ${FIXED_LOT} lot (${OUNCE_SIZE} oz effective exposure)`,
    "",
    "## Summary",
    "",
    `- Trades: ${trades.length}`,
    `- Wins: ${wins.length}`,
    `- Losses: ${losses.length}`,
    `- Win rate: ${result.winRate}%`,
    `- Net P&L: $${result.netPnl.toFixed(2)}`,
    `- Final balance: $${result.finalBalance.toFixed(2)}`,
    `- Profit factor: ${result.profitFactor ?? "—"}`,
    `- Expectancy/trade: $${result.expectancyPerTrade.toFixed(2)}`,
    `- Max drawdown: ${result.maxDrawdownPercent}%`,
    "",
    "## Trades",
    "",
    "| # | Side | Entry | Exit | SL | TP | P&L | R | Result |",
    "|---:|:---:|---:|---:|---:|---:|---:|---:|:---:|",
    ...trades.map((t) => `| ${t.trade} | ${t.side} | ${t.entryPrice} | ${t.exitPrice} | ${t.stopLoss} | ${t.takeProfit} | $${t.pnl.toFixed(2)} | ${t.rMultiple}R | ${t.outcome} |`),
    "",
    "## Warnings",
    "",
    ...result.warnings.map((warning) => `- ${warning}`),
  ];
  fs.writeFileSync("artifacts/xauusd-backtest-0.01lot.md", lines.join("\n"));

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
