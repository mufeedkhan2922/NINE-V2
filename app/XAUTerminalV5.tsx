"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Database,
  Gauge,
  LockKeyhole,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  WifiOff,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  buildXAUReplayTimeline,
  buildXAUTerminalAnalytics,
  lifecycleProgress,
} from "../lib/trading/xauTerminalAnalytics";

type Props = {
  dashboard: any;
  streaming: boolean;
  user: any;
  loading: boolean;
  onRefresh: () => void;
  onLogout: () => void;
  onCommand: (text: string) => void;
  commandBusy: boolean;
  commandText: string;
  setCommandText: (value: string) => void;
  voiceOn: boolean;
  onVoice: () => void;
  login: { email: string; password: string };
  setLogin: (value: { email: string; password: string }) => void;
  loginError: string;
  onLogin: (event: React.FormEvent<HTMLFormElement>) => void;
  onRunBacktest: () => void;
  backtestBusy: boolean;
  backtest: any;
  backtestError: string;
  onRunResearch: () => void;
  researchBusy: boolean;
  research: any;
  researchError: string;
};

const STATES = ["DETECTED", "VALIDATED", "TRACKING", "ENTERED", "MANAGING", "CLOSED"];

function n(value: unknown, digits = 2) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}

function pct(value: unknown, digits = 2) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) + "%" : "—";
}

function tone(value: string) {
  const v = value.toUpperCase();
  if (["LONG", "BUY", "BULLISH", "APPROVED", "HEALTHY", "CONNECTED", "PAPER_READY", "PAPER_ACTIVE", "MANAGING"].includes(v)) return "terminal-positive";
  if (["SHORT", "SELL", "BEARISH", "BLOCKED", "DEGRADED", "RECONNECTING", "EXPIRED"].includes(v)) return "terminal-negative";
  return "terminal-neutral";
}

function MiniChart({ candles, setup, streaming }: { candles: any[]; setup: any; streaming: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const data = candles.slice(-110);
  if (!data.length) {
    return (
      <div className="terminal-chart-empty">
        <Database size={22} />
        <b>NO VALIDATED CANDLES</b>
        <span>{streaming ? "Waiting for a fresh provider snapshot." : "Feed reconnecting. Last validated data will be retained."}</span>
      </div>
    );
  }
  const width = 1200;
  const height = 520;
  const left = 16;
  const right = 74;
  const top = 22;
  const bottom = 36;
  const highs = data.map((c) => Number(c.high));
  const lows = data.map((c) => Number(c.low));
  const max = Math.max(...highs);
  const min = Math.min(...lows);
  const span = Math.max(max - min, 0.000001);
  const step = (width - left - right) / Math.max(data.length, 1);
  const x = (i: number) => left + i * step + step / 2;
  const y = (p: number) => top + ((max - p) / span) * (height - top - bottom);
  const grid = Array.from({ length: 6 }, (_, i) => max - (i / 5) * span);
  const entry = Number(setup?.entry);
  const stop = Number(setup?.stopLoss);
  const target = Number(setup?.takeProfit);
  return (
    <div className="terminal-chart">
      <svg viewBox={`0 0 \${width} \${height}`} preserveAspectRatio="none" onMouseLeave={() => setHover(null)}>
        <rect x={left} y={top} width={width-left-right} height={height-top-bottom} className="terminal-chart-bg" />
        {grid.map((value, i) => (
          <g key={i}>
            <line x1={left} x2={width-right} y1={y(value)} y2={y(value)} className="terminal-grid" />
            <text x={width-right+8} y={y(value)+4} className="terminal-axis">{n(value)}</text>
          </g>
        ))}
        {data.map((c, i) => {
          const open = Number(c.open), close = Number(c.close), high = Number(c.high), low = Number(c.low);
          const up = close >= open;
          const cx = x(i);
          const bodyY = y(Math.max(open, close));
          const bodyH = Math.max(2, Math.abs(y(open)-y(close)));
          return (
            <g key={c.time ?? i} onMouseMove={() => setHover(i)}>
              <line x1={cx} x2={cx} y1={y(high)} y2={y(low)} className={up ? "terminal-wick-up" : "terminal-wick-down"} />
              <rect x={cx-step*.28} y={bodyY} width={Math.max(2, step*.56)} height={bodyH} className={up ? "terminal-candle-up" : "terminal-candle-down"} />
            </g>
          );
        })}
        {Number.isFinite(entry) && entry >= min && entry <= max && <line x1={left} x2={width-right} y1={y(entry)} y2={y(entry)} className="terminal-level-entry" />}
        {Number.isFinite(stop) && stop >= min && stop <= max && <line x1={left} x2={width-right} y1={y(stop)} y2={y(stop)} className="terminal-level-stop" />}
        {Number.isFinite(target) && target >= min && target <= max && <line x1={left} x2={width-right} y1={y(target)} y2={y(target)} className="terminal-level-target" />}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={top} y2={height-bottom} className="terminal-crosshair" />
            <rect x={Math.min(x(hover)+10, width-235)} y={35} width="220" height="92" rx="6" className="terminal-tooltip" />
            <text x={Math.min(x(hover)+22, width-223)} y={58} className="terminal-tooltip-title">{new Date(Number(data[hover].time)).toLocaleTimeString()}</text>
            <text x={Math.min(x(hover)+22, width-223)} y={78} className="terminal-tooltip-text">O {n(data[hover].open)} · H {n(data[hover].high)}</text>
            <text x={Math.min(x(hover)+22, width-223)} y={98} className="terminal-tooltip-text">L {n(data[hover].low)} · C {n(data[hover].close)}</text>
          </g>
        )}
      </svg>
      <div className="terminal-chart-labels">
        <span>1M</span><span>5M</span><span>15M</span><span>1H</span>
        <span className="terminal-chart-legend"><i className="entry-dot"/>ENTRY <i className="stop-dot"/>SL <i className="target-dot"/>TP</span>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return <div className="terminal-metric"><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>;
}

export default function XAUTerminalV5(props: Props) {
  const {
    dashboard, streaming, user, loading, onRefresh, onLogout, onCommand,
    commandBusy, commandText, setCommandText, voiceOn, onVoice, login,
    setLogin, loginError, onLogin, onRunBacktest, backtestBusy, backtest,
    backtestError, onRunResearch, researchBusy, research, researchError,
  } = props;
  const market = dashboard?.market;
  const setup = dashboard?.orchestration?.setup;
  const sentinel = dashboard?.orchestration?.sentinel;
  const atlas = dashboard?.orchestration?.atlas;
  const decision = dashboard?.decisionEngine;
  const loop = dashboard?.paperLoop;
  const account = dashboard?.account;
  const feed = dashboard?.feed;
  const chart = dashboard?.chart ?? [];
  const positions = account?.positions ?? [];
  const openPosition = positions.find((p: any) => p.status === "OPEN");
  const analytics = useMemo(() => buildXAUTerminalAnalytics(positions), [positions]);
  const replay = useMemo(
    () => buildXAUReplayTimeline(loop?.history ?? [], decision?.events ?? []),
    [loop?.history, decision?.events],
  );
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [tab, setTab] = useState<"LIVE" | "REPLAY" | "ANALYTICS">("LIVE");
  const state = String(loop?.state ?? decision?.lifecycle ?? "WATCH");
  const progress = lifecycleProgress(state);
  const price = Number(market?.price);
  const move = Number(market?.changePercent);
  const degraded = !streaming || feed?.stale || feed?.connection === "DEGRADED";
  const lifecycle = state === "PAPER_ACTIVE" ? "MANAGING" : state;
  const replayPoint = replay[replayIndex];

  const executeCommand = (value: string) => {
    if (!value.trim()) return;
    onCommand(value);
  };

  return (
    <main className="terminal-v5">
      <header className="terminal-header">
        <div className="terminal-brand">
          <div className="terminal-logo">N</div>
          <div><b>NINE</b><span>XAUUSD AUTONOMOUS INTELLIGENCE TERMINAL</span></div>
        </div>
        <div className="terminal-symbol"><span>PRIMARY INSTRUMENT</span><b>XAUUSD</b><small>GOLD / USD</small></div>
        <div className="terminal-quote">
          <strong>{n(price)}</strong>
          <span className={move >= 0 ? "terminal-positive" : "terminal-negative"}>{Number.isFinite(move) ? (move >= 0 ? "+" : "") + move.toFixed(2) + "%" : "—"}</span>
        </div>
        <div className="terminal-feed">
          <i className={degraded ? "feed-dot degraded" : "feed-dot"} />
          <span>{degraded ? "DATA DEGRADED" : "LIVE VALIDATED"}</span>
          <button onClick={onRefresh} type="button" title="Refresh"><RefreshCw size={15}/></button>
          {user && <button onClick={onLogout} type="button" title="Exit">EXIT</button>}
        </div>
      </header>

      <div className="terminal-status-strip">
        <span><i/> PAPER LOOP <b>{state}</b></span>
        <span>SESSION <b>{decision?.session ?? "—"}</b></span>
        <span>PHASE <b>{decision?.sessionPhase ?? "—"}</b></span>
        <span>POSITION <b>{openPosition ? openPosition.side : "NONE"}</b></span>
        <span>LIVE BROKER <b className="terminal-negative">LOCKED</b></span>
      </div>

      <section className="terminal-workspace">
        <aside className="terminal-rail terminal-left-rail">
          <div className="terminal-section-label">MARKET INTELLIGENCE</div>
          <section className="terminal-module">
            <div className="terminal-module-head"><span>MARKET STATE</span><Gauge size={15}/></div>
            {[
              ["SESSION", decision?.session ?? "—"],
              ["HTF BIAS", setup?.smc?.chartist?.higherTimeframeBias ?? "NONE"],
              ["TREND", setup?.technical?.trend ?? "—"],
              ["REGIME", setup?.technical?.volatility ?? setup?.smc?.volatilityState ?? "—"],
              ["PRICE ZONE", setup?.smc?.premiumDiscount ?? "—"],
              ["DATA", degraded ? "DEGRADED" : "VALIDATED"],
            ].map(([label,value]) => <div className="terminal-row" key={label}><span>{label}</span><b className={tone(String(value))}>{String(value)}</b></div>)}
          </section>

          <section className="terminal-module">
            <div className="terminal-module-head"><span>SMART MONEY</span><Sparkles size={15}/></div>
            {[
              ["LIQUIDITY SWEEP", setup?.smc?.liquiditySweep ? setup.smc.sweepDirection : "NONE"],
              ["MSS / CHoCH", setup?.smc?.marketStructureShift ? setup.smc.structureDirection : "NONE"],
              ["FVG", setup?.smc?.fairValueGap ? "DETECTED" : "NONE"],
              ["ORDER BLOCK", setup?.smc?.orderBlock ? "DETECTED" : "NONE"],
              ["DISPLACEMENT", setup?.smc?.displacement ? "DETECTED" : "NONE"],
            ].map(([label,value]) => <div className="terminal-row" key={label}><span>{label}</span><b className={tone(String(value))}>{String(value)}</b></div>)}
          </section>

          <section className="terminal-module">
            <div className="terminal-module-head"><span>SESSION MAP</span><Clock3 size={15}/></div>
            <div className="terminal-session-grid">
              <Metric label="ASIA" value={n(setup?.smc?.asiaHigh) + " / " + n(setup?.smc?.asiaLow")} />
              <Metric label="LONDON" value={n(setup?.smc?.londonHigh) + " / " + n(setup?.smc?.londonLow")} />
              <Metric label="PD HIGH" value={n(setup?.smc?.previousDayHigh)} />
              <Metric label="PD LOW" value={n(setup?.smc?.previousDayLow)} />
            </div>
          </section>

          <section className="terminal-module terminal-command">
            <div className="terminal-module-head"><span>COMMAND</span><Brain size={15}/></div>
            <form onSubmit={(e) => { e.preventDefault(); executeCommand(commandText); }}><input value={commandText} onChange={(e) => setCommandText(e.target.value)} placeholder="Ask NINE…" maxLength={500}/><button type="submit" disabled={commandBusy}><Zap size={14}/></button></form>
            <div className="terminal-chips">{["Analyze gold","Show market status","Analyze current setup"].map((item) => <button key={item} onClick={() => executeCommand(item)} type="button">{item}</button>)}</div>
            <button type="button" className={voiceOn ? "terminal-voice active" : "terminal-voice"} onClick={onVoice}>{voiceOn ? "LISTENING…" : "VOICE COMMAND"}</button>
          </section>
        </aside>

        <section className="terminal-main">
          <div className="terminal-main-head">
            <div>
              <span className="terminal-kicker">XAUUSD MARKET STRUCTURE ENGINE</span>
              <h1>{n(price)} <small>{Number.isFinite(move) ? (move >= 0 ? "+" : "") + move.toFixed(2) + "%" : "—"}</small></h1>
              <p>{setup?.technical?.structure ?? "Awaiting validated market structure."}</p>
            </div>
            <div className="terminal-action-state"><span className={tone(state)}>{state}</span><small>{degraded ? "LAST VALIDATED DATA" : "LIVE VALIDATED DATA"}</small></div>
          </div>

          <div className="terminal-tabs">
            {(["LIVE","REPLAY","ANALYTICS"] as const).map((item) => <button key={item} type="button" className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{item}</button>)}
          </div>

          {tab !== "ANALYTICS" && <section className="terminal-chart-module">
            <MiniChart candles={chart} setup={setup} streaming={!degraded} />
            {degraded && <div className="terminal-data-banner"><WifiOff size={14}/> LAST VALIDATED DATA · LIVE EXECUTION BLOCKED · RECONNECTING</div>}
          </section>}

          {tab === "REPLAY" && (
            <section className="terminal-module terminal-replay">
              <div className="terminal-module-head"><span>MARKET + LIFECYCLE REPLAY</span><span>{replay.length} events</span></div>
              <div className="terminal-replay-controls">
                <button type="button" onClick={() => setReplayPlaying(!replayPlaying)}>{replayPlaying ? <Pause size={14}/> : <Play size={14}/>} {replayPlaying ? "PAUSE" : "PLAY"}</button>
                <input type="range" min="0" max={Math.max(0,replay.length-1)} value={replayIndex} onChange={(e) => setReplayIndex(Number(e.target.value))}/>
                <span>{replayPoint ? new Date(replayPoint.timestamp).toLocaleTimeString() : "—"}</span>
              </div>
              <div className="terminal-replay-focus">{replayPoint ? <><b>{replayPoint.event}</b><span>{replayPoint.state}</span><p>{replayPoint.reason}</p></> : <span>No replay events recorded.</span>}</div>
              <div className="terminal-replay-list">{replay.slice(0,12).map((item,i) => <button key={item.timestamp + "-" + i} type="button" onClick={() => setReplayIndex(i)} className={i === replayIndex ? "selected" : ""}><time>{new Date(item.timestamp).toLocaleTimeString()}</time><b>{item.event}</b><span>{item.reason}</span></button>)}</div>
            </section>
          )}

          {tab === "LIVE" && (
            <>
              <section className="terminal-lifecycle">
                <div className="terminal-lifecycle-head"><span>AUTONOMOUS LIFECYCLE</span><b>{lifecycle}</b></div>
                <div className="terminal-progress"><i style={{ width: (progress*100) + "%" }}/></div>
                <div className="terminal-stages">{STATES.map((item) => {
                  const current = lifecycle === item || (item === "ENTERED" && lifecycle === "MANAGING");
                  const done = STATES.indexOf(item) < STATES.indexOf(lifecycle);
                  return <div key={item} className={current ? "current" : done ? "done" : ""}><i/ ><span>{item}</span></div>;
                })}</div>
              </section>

              <section className="terminal-intelligence-grid">
                <div className="terminal-module terminal-decision">
                  <div className="terminal-module-head"><span>NINE DECISION ENGINE</span><Brain size={15}/></div>
                  <div className="terminal-decision-top"><strong className={tone(setup?.direction ?? "NONE")}>{setup?.direction ?? "NONE"}</strong><span>{decision?.lifecycle ?? "WATCH"}</span></div>
                  <div className="terminal-decision-score"><b>{n(setup?.validation?.score,0)}/100</b><span>VALIDATION</span></div>
                  <div className="terminal-trade-grid">
                    <Metric label="ENTRY" value={n(setup?.entry)} />
                    <Metric label="STOP" value={n(setup?.stopLoss)} />
                    <Metric label="TARGET" value={n(setup?.takeProfit)} />
                    <Metric label="R:R" value={n(setup?.riskReward)} />
                  </div>
                  <div className="terminal-evidence">{(decision?.evidenceChain ?? []).slice(0,6).map((item:any,i:number)=><div key={item.id ?? i}><i/> <b>{item.source ?? "EVIDENCE"}</b><span>{item.evidence ?? item.signal ?? "Validated evidence."}</span></div>)}</div>
                </div>

                <div className="terminal-module terminal-sentinel">
                  <div className="terminal-module-head"><span>SENTINEL EXECUTION GATE</span><ShieldCheck size={15}/></div>
                  <div className={"terminal-gate " + (sentinel?.approved ? "approved" : "blocked")}><b>{sentinel?.approved ? "APPROVED" : "BLOCKED"}</b><span>PAPER EXECUTION ONLY</span></div>
                  <div className="terminal-checks">
                    {["marketData","dataQuality","crossTimeframe","microstructure","marketState","risk","setup"].map((key) => <div key={key}><span>{key}</span><b>{setup?.validation?.checks?.[key] === true ? "PASS" : "BLOCK"}</b></div>)}
                  </div>
                  <p>{sentinel?.reason ?? "Sentinel authorization unavailable."}</p>
                  <div className="terminal-lock"><LockKeyhole size={13}/> LIVE BROKER HARD LOCKED</div>
                </div>

                <div className="terminal-module terminal-agents">
                  <div className="terminal-module-head"><span>AGENT SYNTHESIS</span><Activity size={15}/></div>
                  {(dashboard?.orchestration?.agentReports ?? []).slice(0,3).map((agent:any,i:number)=><div className="terminal-agent" key={agent.id ?? i}><div><b>{agent.name ?? agent.agent ?? "AGENT"}</b><span>{agent.status ?? "—"}</span></div><p>{agent.summary ?? "No validated report."}</p></div>)}
                  <div className="terminal-atlas"><span>ATLAS</span><b>{atlas?.bias ?? "NEUTRAL"}</b><p>{atlas?.summary ?? "Macro/news context unavailable."}</p></div>
                </div>
              </section>

              <section className="terminal-position-grid">
                <div className="terminal-module terminal-position">
                  <div className="terminal-module-head"><span>PAPER POSITION</span><CircleDollarSign size={15}/></div>
                  {openPosition ? <div className="terminal-position-body">
                    <div className="terminal-position-direction"><strong className={tone(openPosition.side)}>{openPosition.side}</strong><span>{openPosition.id}</span></div>
                    <div className="terminal-trade-grid">
                      <Metric label="ENTRY" value={n(openPosition.entryPrice)} />
                      <Metric label="CURRENT" value={n(price)} />
                      <Metric label="STOP" value={n(openPosition.stopLoss)} />
                      <Metric label="TARGET" value={n(openPosition.takeProfit)} />
                      <Metric label="QTY" value={n(openPosition.quantity,4)} />
                      <Metric label="P&L" value={n(openPosition.unrealizedPnl ?? openPosition.realizedPnl)} />
                    </div>
                  </div> : <div className="terminal-empty-state"><Target size={18}/><b>NO OPEN PAPER POSITION</b><span>{loop?.entry?.message ?? "Waiting for a validated Sentinel-approved setup."}</span></div>}
                </div>

                <div className="terminal-module terminal-account">
                  <div className="terminal-module-head"><span>PAPER ACCOUNT</span><Gauge size={15}/></div>
                  <div className="terminal-account-grid">
                    <Metric label="EQUITY" value={n(account?.equity)} />
                    <Metric label="BALANCE" value={n(account?.balance)} />
                    <Metric label="REALIZED" value={n(account?.realizedPnl)} />
                    <Metric label="UNREALIZED" value={n(account?.unrealizedPnl)} />
                    <Metric label="DAILY P&L" value={n(account?.dailyPnl)} />
                    <Metric label="DRAWDOWN" value={pct(account?.drawdownPercent)} />
                  </div>
                </div>
              </section>

              <section className="terminal-module terminal-history">
                <div className="terminal-module-head"><span>STATE + EVENT LEDGER</span><span>{replay.length} records</span></div>
                <div className="terminal-history-list">{replay.slice(0,8).map((item,i)=><div key={item.timestamp + "-" + i}><time>{new Date(item.timestamp).toLocaleTimeString()}</time><b>{item.event}</b><span>{item.reason}</span></div>)}</div>
              </section>
            </>
          )}

          {tab === "ANALYTICS" && (
            <section className="terminal-analytics">
              <div className="terminal-analytics-hero"><span>RESEARCH / PAPER PERFORMANCE</span><strong>{analytics.closedTrades} CLOSED TRADES</strong><p>Descriptive paper-account analytics only. No performance guarantee or live-trading authorization.</p></div>
              <div className="terminal-analytics-grid">
                <Metric label="WIN RATE" value={pct(analytics.winRate)} />
                <Metric label="NET P&L" value={n(analytics.netPnl)} />
                <Metric label="EXPECTANCY" value={n(analytics.expectancy)} />
                <Metric label="PROFIT FACTOR" value={analytics.profitFactor === Infinity ? "∞" : n(analytics.profitFactor)} />
                <Metric label="BEST TRADE" value={n(analytics.bestTrade)} />
                <Metric label="WORST TRADE" value={n(analytics.worstTrade)} />
                <Metric label="LOSS STREAK" value={String(analytics.maxConsecutiveLosses)} />
                <Metric label="OPEN" value={String(analytics.openTrades)} />
              </div>
              <div className="terminal-research-actions">
                <button type="button" onClick={onRunBacktest} disabled={backtestBusy}>{backtestBusy ? "RUNNING REPLAY…" : "RUN HISTORICAL BACKTEST"}</button>
                <button type="button" onClick={onRunResearch} disabled={researchBusy}>{researchBusy ? "RESEARCHING…" : "RUN RESEARCH MATRIX"}</button>
              </div>
              {backtestError && <div className="terminal-error"><AlertTriangle size={14}/>{backtestError}</div>}
              {researchError && <div className="terminal-error"><AlertTriangle size={14}/>{researchError}</div>}
              {backtest && <div className="terminal-result"><b>BACKTEST</b><span>{backtest.totalTrades} trades · {pct(backtest.winRate)} · P&L {n(backtest.netPnl)} · DD {pct(backtest.maxDrawdown)}</span></div>}
              {research && <div className="terminal-result"><b>RESEARCH</b><span>{research.qualification ?? research.quality?.state ?? "COMPLETED"} · evidence {n(research.evidenceScore,0)}/100</span></div>}
            </section>
          )}
        </section>

        <aside className="terminal-rail terminal-right-rail">
          <div className="terminal-section-label">NINE CONTROL</div>
          <section className="terminal-module terminal-setup">
            <div className="terminal-module-head"><span>SETUP ENGINE</span><Target size={15}/></div>
            <div className={"terminal-setup-state " + tone(setup?.direction ?? "NONE")}>{setup?.direction ?? "NONE"}</div>
            <div className="terminal-life-chip">{decision?.lifecycle ?? "WATCH"} · {decision?.session ?? "OFF_SESSION"}</div>
            <div className="terminal-trade-grid"><Metric label="ENTRY" value={n(setup?.entry)} /><Metric label="STOP" value={n(setup?.stopLoss)} /><Metric label="TARGET" value={n(setup?.takeProfit)} /><Metric label="R:R" value={n(setup?.riskReward)} /></div>
            <div className="terminal-score"><span>VALIDATION</span><b>{n(setup?.validation?.score,0)}/100</b></div>
            {(setup?.validation?.blockers ?? []).slice(0,4).map((item:string,i:number)=><div className="terminal-blocker" key={i}><AlertTriangle size={12}/>{item}</div>)}
          </section>

          <section className="terminal-module terminal-position-mini">
            <div className="terminal-module-head"><span>POSITION STATE</span><Radio size={15}/></div>
            <strong>{openPosition ? openPosition.side + " · MANAGING" : lifecycle}</strong>
            <div className="terminal-progress"><i style={{width:(progress*100)+"%"}}/></div>
            <p>{loop?.entry?.message ?? "No active paper position."}</p>
          </section>

          <section className="terminal-module">
            <div className="terminal-module-head"><span>RISK CONTROL</span><ShieldCheck size={15}/></div>
            <div className="terminal-row"><span>EXPOSURE</span><b>{pct(dashboard?.v27?.risk?.exposurePercent)}</b></div>
            <div className="terminal-row"><span>DRAWDOWN</span><b>{pct(dashboard?.v27?.risk?.drawdownPercent)}</b></div>
            <div className="terminal-row"><span>DAILY LIMIT</span><b>{pct(dashboard?.v27?.risk?.dailyLossLimitPercent)}</b></div>
            <div className="terminal-row"><span>EXECUTION</span><b className="terminal-positive">PAPER</b></div>
          </section>

          <section className="terminal-module terminal-news">
            <div className="terminal-module-head"><span>ATLAS · MACRO</span><Sparkles size={15}/></div>
            <div className={"terminal-macro " + tone(atlas?.bias ?? "NEUTRAL")}>{atlas?.bias ?? "NEUTRAL"}</div>
            <p>{atlas?.summary ?? "Macro/news context unavailable for this validated snapshot."}</p>
            {(atlas?.headlines ?? []).slice(0,4).map((h:any,i:number)=><div className="terminal-headline" key={i}><b>{h.sentiment ?? "—"}</b><span>{h.title ?? "Untitled headline"}</span></div>)}
          </section>

          <section className="terminal-module terminal-lock-module">
            <div className="terminal-module-head"><span>SAFETY</span><LockKeyhole size={15}/></div>
            <div className="terminal-hard-lock"><LockKeyhole size={16}/><b>LIVE BROKER LOCKED</b><span>Sentinel-only · Paper execution</span></div>
          </section>
        </aside>
      </section>

      <footer className="terminal-footer">
        <span>NINE V5.0 · XAUUSD AUTONOMOUS INTELLIGENCE TERMINAL</span>
        <span>{feed?.provider ?? "PROVIDER"} · {degraded ? "LAST VALIDATED" : "LIVE VALIDATED"}</span>
        <span><LockKeyhole size={12}/> LIVE BROKER HARD LOCKED</span>
      </footer>

      {!user && (
        <div className="terminal-auth-overlay">
          <form className="terminal-auth" onSubmit={onLogin}>
            <div className="terminal-logo">N</div>
            <span>SECURE ACCESS</span>
            <h2>Authenticate NINE</h2>
            <p>Market intelligence remains protected. Commands and paper execution require authentication.</p>
            <input value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} placeholder="Admin email" type="email" required />
            <input value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} placeholder="Password" type="password" required />
            {loginError && <div className="terminal-error"><AlertTriangle size={14}/>{loginError}</div>}
            <button type="submit">AUTHENTICATE</button>
          </form>
        </div>
      )}

      {loading && <div className="terminal-loading"><div className="terminal-logo">N</div><span>INITIALIZING XAUUSD INTELLIGENCE TERMINAL…</span></div>}
    </main>
  );
}
