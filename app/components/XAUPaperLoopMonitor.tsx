"use client";

import { Activity, ShieldCheck, TimerReset, TrendingDown, TrendingUp, WalletCards } from "lucide-react";

type MonitorProps = {
  paperLoop?: any;
  decisionEngine?: any;
};

function money(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
}

function pct(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`
    : "—";
}

const stages = ["DETECTED", "VALIDATED", "TRACKING", "ENTERED", "MANAGING", "CLOSED"];

export function XAUPaperLoopMonitor({ paperLoop, decisionEngine }: MonitorProps) {
  const state = String(paperLoop?.state ?? "WATCH");
  const health = paperLoop?.health;
  const telemetry = paperLoop?.telemetry;
  const currentIndex = Math.max(0, stages.indexOf(state === "ENTERED" ? "ENTERED" : state));
  const normalizedIndex = state === "MANAGING" ? 4 : state === "CLOSED" ? 5 : currentIndex;

  return (
    <section className="xau-v45-monitor">
      <div className="xau-v45-head">
        <div>
          <div className="xau-v45-kicker"><Activity size={13} /> V4.5 AUTONOMOUS PAPER ENGINE</div>
          <h2>XAUUSD Loop Monitor</h2>
          <p>Event-driven paper execution · deterministic setup identity · Sentinel gate · broker locked</p>
        </div>
        <div className={health?.healthy ? "xau-v45-health healthy" : "xau-v45-health"}>
          <span />
          {health?.label ?? "WAITING"}
          <small>{health?.ageSeconds != null ? `${Number(health.ageSeconds).toFixed(1)}s heartbeat` : "Awaiting first cycle"}</small>
        </div>
      </div>

      <div className="xau-v45-rail">
        {stages.map((stage, index) => (
          <div key={stage} className={index < normalizedIndex ? "xau-v45-stage done" : index === normalizedIndex ? "xau-v45-stage active" : "xau-v45-stage"}>
            <i>{index + 1}</i>
            <span>{stage}</span>
          </div>
        ))}
      </div>

      <div className="xau-v45-grid">
        <div className="xau-v45-card">
          <span><WalletCards size={13} /> EQUITY</span>
          <b>{money(paperLoop?.account?.equity)}</b>
          <small>Balance {money(paperLoop?.account?.balance)}</small>
        </div>
        <div className="xau-v45-card">
          <span><TrendingUp size={13} /> WIN RATE</span>
          <b>{telemetry ? `${money(telemetry.winRate)}%` : "—"}</b>
          <small>{telemetry?.wins ?? 0} wins · {telemetry?.losses ?? 0} losses</small>
        </div>
        <div className="xau-v45-card">
          <span><TrendingDown size={13} /> NET P&amp;L</span>
          <b>{money(telemetry?.netPnl)}</b>
          <small>Daily {pct(telemetry?.dailyPnlPercent)}</small>
        </div>
        <div className="xau-v45-card">
          <span><ShieldCheck size={13} /> RISK</span>
          <b>{money(telemetry?.openRiskUsd)}</b>
          <small>{pct(telemetry?.totalRiskPercent)} open risk</small>
        </div>
        <div className="xau-v45-card">
          <span><TimerReset size={13} /> EXPECTANCY</span>
          <b>{money(telemetry?.expectancy)}</b>
          <small>{telemetry?.closedTrades ?? 0} closed trades</small>
        </div>
      </div>

      <div className="xau-v45-bottom">
        <div>
          <span>SETUP</span>
          <b>{decisionEngine?.tracking?.setupId ? String(decisionEngine.tracking.setupId).slice(0, 12) : "—"}</b>
        </div>
        <div>
          <span>LIFECYCLE</span>
          <b>{decisionEngine?.lifecycle ?? "WATCH"}</b>
        </div>
        <div>
          <span>POSITION</span>
          <b>{paperLoop?.positionId ? String(paperLoop.positionId).slice(0, 12) : "NONE"}</b>
        </div>
        <div>
          <span>DRAWDOWN</span>
          <b>{money(telemetry?.maxDrawdown)} <em>{pct(telemetry?.maxDrawdownPercent)}</em></b>
        </div>
        <div>
          <span>EXECUTION</span>
          <b className="locked">PAPER ONLY</b>
        </div>
      </div>
    </section>
  );
}
