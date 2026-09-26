import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { requireUser } from "@/lib/security/auth";
import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { runBacktest } from "@/lib/trading/backtest";
import { db } from "@/lib/trading/db";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    requireUser(request);
    const body = await request.json().catch(() => ({})) as { initialBalance?: number; riskPercent?: number };
    const market = await getLiveMarketSnapshot("XAUUSD");
    const initialBalance = Number.isFinite(body.initialBalance) && Number(body.initialBalance) > 0 ? Number(body.initialBalance) : 10000;
    const riskPercent = Number.isFinite(body.riskPercent) && Number(body.riskPercent) > 0 && Number(body.riskPercent) <= 1 ? Number(body.riskPercent) : 0.5;
    const result = runBacktest(market.timeframes?.["1min"]?.candles ?? market.candles, initialBalance, riskPercent);
    const runId = `RUN-${randomUUID()}`;
    const now = Date.now();
    db.prepare(`INSERT INTO backtest_runs (id,symbol,timeframe,started_at,completed_at,initial_balance,final_balance,total_trades,wins,losses,win_rate,net_pnl,max_drawdown,profit_factor,config_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,"XAUUSD","1min",now,Date.now(),result.initialBalance,result.finalBalance,result.totalTrades,result.wins,result.losses,result.winRate,result.netPnl,result.maxDrawdown,result.profitFactor,JSON.stringify(result.config));
    const insert = db.prepare(`INSERT INTO backtest_trades (id,run_id,index_no,side,entry_time,exit_time,entry_price,exit_price,stop_loss,take_profit,quantity,pnl,outcome,reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const t of result.trades) insert.run(t.id,runId,t.index,t.side,t.entryTime,t.exitTime,t.entryPrice,t.exitPrice,t.stopLoss,t.takeProfit,t.quantity,t.pnl,t.outcome,t.reason);
    return NextResponse.json({ ok: true, runId, result });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Backtest failed." }, { status: 500 });
  }
}
