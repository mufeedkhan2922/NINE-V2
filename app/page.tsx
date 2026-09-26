"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, Brain, CircleDollarSign, LogOut, Mic, MicOff, Radio, Shield, TrendingUp, X, Zap } from "lucide-react";
import CityScene from "./city-scene";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type Position = { id: string; symbol: string; side: "BUY" | "SELL"; quantity: number; entryPrice: number; stopLoss: number; takeProfit: number; status: "OPEN" | "CLOSED"; realizedPnl?: number };
type Dashboard = { ok: boolean; error?: string; feed?: any; runtime?: any; market: any; orchestration: any; v26?: any; account: any; chart?: Candle[]; events?: any[]; orders?: any[] };
type User = { id: string; email: string; role: string } | null;
type SpeechRecognitionLike = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((event: any) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;
declare global { interface Window { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor } }

const agents = [
  { id: "market", name: "ATLAS", subtitle: "MACRO + NEWS + EVENTS", icon: TrendingUp },
  { id: "analysis", name: "CHARTIST", subtitle: "MTF + SMC + STRUCTURE", icon: Brain },
  { id: "risk", name: "SENTINEL", subtitle: "RISK + EXECUTION GATE", icon: Shield },
];

function fmt(value: unknown, digits = 2) { return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "—"; }
function signed(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—"; }
function PriceChart({ candles }: { candles: Candle[] }) {
  if (!candles.length) return <div className="chart-empty">Waiting for validated market candles…</div>;
  const width = 640, height = 150, pad = 8;
  const min = Math.min(...candles.map((c) => c.low));
  const max = Math.max(...candles.map((c) => c.high));
  const span = Math.max(max - min, 0.000001);
  const points = candles.map((c, i) => `${pad + (i / Math.max(candles.length - 1, 1)) * (width - pad * 2)},${height - pad - ((c.close - min) / span) * (height - pad * 2)}`).join(" ");
  return <svg className="price-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-label="Live price chart"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

export default function Home() {
  const [selected, setSelected] = useState("central");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [user, setUser] = useState<User>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [login, setLogin] = useState({ email: "", password: "" });
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [voiceOn, setVoiceOn] = useState(false);
  const [voiceText, setVoiceText] = useState("");
  const [actionMessage, setActionMessage] = useState("Awaiting validated market data");
  const [commandBusy, setCommandBusy] = useState(false);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [backtest, setBacktest] = useState<any>(null);
  const recognition = useRef<SpeechRecognitionLike | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/nine/dashboard", { cache: "no-store" });
      const data = await response.json();
      setDashboard(data);
      setActionMessage(data.orchestration?.commandSummary ?? data.error ?? "Awaiting validated market data");
    } catch {
      setActionMessage("Dashboard feed unavailable");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" }).then((r) => r.json()).then((data) => setUser(data.user ?? null)).finally(() => setAuthChecked(true));
    void load();
    const es = new EventSource("/api/stream/market");
    es.addEventListener("market", (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setDashboard((current) => ({ ...(current ?? {}), ok: true, market: data.market, feed: data.feed, runtime: data.runtime, orchestration: data.orchestration, account: data.account, orders: data.orders, chart: data.chart }));
        setLoading(false);
      } catch { setActionMessage("Received an invalid market frame."); }
    });
    es.addEventListener("error", () => setActionMessage("Live stream reconnecting…"));
    return () => { es.close(); recognition.current?.stop(); };
  }, [load]);

  const sendCommand = async (text: string) => {
    if (commandBusy || !user) return;
    setCommandBusy(true); setActionMessage("NINE is processing the command…");
    try {
      const response = await fetch("/api/nine/command", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      const data = await response.json();
      if (response.status === 401) setUser(null);
      setActionMessage(data.message ?? data.error ?? "Command completed.");
      await load();
    } catch { setActionMessage("Command endpoint unavailable."); }
    finally { setCommandBusy(false); }
  };

  const startVoice = () => {
    if (!user) { setLoginError("Login is required for voice commands."); return; }
    const Constructor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Constructor) { setActionMessage("Voice recognition is not available in this browser."); return; }
    recognition.current?.stop();
    const instance = new Constructor();
    instance.lang = "en-US"; instance.interimResults = true; instance.continuous = false;
    instance.onresult = (event) => { const transcript = Array.from(event.results).map((result: any) => result[0]?.transcript ?? "").join(" ").trim(); setVoiceText(transcript); if (event.results[event.results.length - 1]?.isFinal) void sendCommand(transcript); };
    instance.onend = () => setVoiceOn(false); instance.onerror = () => { setVoiceOn(false); setActionMessage("Voice recognition stopped."); };
    recognition.current = instance; setVoiceText(""); setVoiceOn(true); instance.start();
  };
  const stopVoice = () => { recognition.current?.stop(); setVoiceOn(false); };

  const loginSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoginError("");
    const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(login) });
    const data = await response.json();
    if (!response.ok) { setLoginError(data.error ?? "Login failed."); return; }
    setUser(data.user); setLogin({ ...login, password: "" });
  };
  const logout = async () => { await fetch("/api/auth/logout", { method: "POST" }); setUser(null); setActionMessage("Signed out. Dashboard remains read-only."); };
  const runBacktest = async () => {
    if (!user) { setLoginError("Login is required for backtesting."); return; }
    setBacktestBusy(true); setActionMessage("Running replay on validated 1-minute candles…");
    try {
      const response = await fetch("/api/backtest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initialBalance: 10000, riskPercent: 0.5 }) });
      const data = await response.json(); if (response.status === 401) setUser(null); setBacktest(data.result ?? null); setActionMessage(data.error ?? "Backtest complete.");
    } catch { setActionMessage("Backtest endpoint unavailable."); }
    finally { setBacktestBusy(false); }
  };

  const setup = dashboard?.orchestration?.setup;
  const market = dashboard?.market;
  const sentinel = dashboard?.orchestration?.sentinel;
  const account = dashboard?.account;
  const atlas = dashboard?.orchestration?.atlas;
  const chartist = setup?.smc?.chartist;
  const openPositions: Position[] = useMemo(() => account?.positions?.filter((p: Position) => p.status === "OPEN") ?? [], [account]);
  const feed = dashboard?.feed;
  const risk = sentinel?.risk;

  if (!authChecked) return <main className="nine-shell"><div className="loading-screen">INITIALIZING NINE V2.5…</div></main>;

  return <main className="nine-shell">
    <div className="city-layer"><CityScene selected={selected} onSelect={setSelected} /></div>
    <header className="topbar">
      <div className="brand"><div className="brand-mark">N</div><div><div className="brand-name">NINE</div><div className="brand-subtitle">AI TRADING DESK / V2.5 INTELLIGENCE</div></div></div>
      <div className="system-status"><span className={`status-dot ${dashboard?.ok === false ? "bad" : ""}`} /> {feed?.connection === "CONNECTED" ? "LIVE DATA CONNECTED" : feed?.connection === "DEGRADED" ? "DATA DEGRADED" : "DATA DISCONNECTED"}</div>
      <div className="top-actions"><div className="top-time">{market?.symbol ?? "XAUUSD"} · {feed?.provider ?? "—"} · {new Date().toLocaleTimeString()}</div>{user && <button className="logout-button" onClick={logout}><LogOut size={12}/> SIGN OUT</button>}</div>
    </header>

    <section className="left-panel glass-panel">
      <div className="panel-label">NINE COMMAND CENTER</div><h1>Trading<br/><span>intelligence.</span></h1>
      <p>Market data → Chartist → Atlas → Sentinel. Every execution path is gated by validated data and risk controls.</p>
      <div className="command-status"><div className="command-icon"><Zap size={17}/></div><div><strong>STATUS</strong><small>{loading ? "Connecting…" : actionMessage}</small></div></div>
      <div className="voice-row"><button className={`voice-button ${voiceOn ? "active" : ""}`} onClick={voiceOn ? stopVoice : startVoice}>{voiceOn ? <MicOff size={15}/> : <Mic size={15}/>} {voiceOn ? "STOP VOICE" : "VOICE COMMAND"}</button><button className="refresh-button" onClick={() => void load()}><Activity size={15}/></button></div>
      {voiceText && <div className="voice-transcript">“{voiceText}”</div>}
      <div className="command-actions"><button className="command-button" onClick={() => void sendCommand("paper trade XAUUSD")} disabled={commandBusy || !user || !sentinel?.approved}>PAPER EXECUTE · {sentinel?.approved ? "SENTINEL OPEN" : "SENTINEL CLOSED"}</button><button className="close-button" onClick={() => void sendCommand("close all positions")} disabled={commandBusy || !user || openPositions.length === 0}><X size={13}/> CLOSE ALL PAPER</button></div>
      <button className="backtest-button" onClick={() => void runBacktest()} disabled={backtestBusy || !user}>{backtestBusy ? "REPLAY RUNNING…" : "RUN PAPER REPLAY / BACKTEST"}</button>
      {backtest && <div className="backtest-box"><div className="validation-title">LAST REPLAY</div><div className="backtest-grid"><span>TRADES <b>{backtest.totalTrades}</b></span><span>WIN RATE <b>{fmt(backtest.winRate, 1)}%</b></span><span>NET P&L <b>{fmt(backtest.netPnl)}</b></span><span>DD <b>{fmt(backtest.maxDrawdown, 1)}%</b></span></div></div>}
      <div className="safety-strip"><span>LIVE TRADING</span><b>{dashboard?.runtime?.liveTradingEnabled ? "ENABLED" : "HARD LOCKED"}</b></div>
      {dashboard?.v26 && <div className="v26-box">
        <div className="validation-title">V2.6 INTELLIGENCE CORE</div>
        <div className="backtest-grid">
          <span>BRAIN <b>{dashboard.v26.brain.action}</b></span>
          <span>SETUP <b>{dashboard.v26.setup.lifecycle}</b></span>
          <span>CONFLUENCE <b>{dashboard.v26.setup.confluenceScore}%</b></span>
          <span>HEALTH <b>{dashboard.v26.marketHealth.state}</b></span>
        </div>
        <small>{dashboard.v26.brain.rationale}</small>
      </div>}
    </section>

    <section className="dashboard-panel glass-panel">
      <div className="dashboard-head"><div><div className="panel-label">LIVE INTELLIGENCE · SSE</div><div className="price-line">{fmt(market?.price, 2)} <span>{signed(market?.changePercent)}</span></div></div><div className={`decision ${setup?.status?.toLowerCase() ?? "watching"}`}>{setup?.status ?? "WATCHING"}</div></div>
      <PriceChart candles={dashboard?.chart ?? []}/>
      <div className="metrics"><div><span>BIAS</span><strong>{setup?.marketBias ?? "—"}</strong></div><div><span>CONFIDENCE</span><strong>{setup ? `${setup.confidence}%` : "—"}</strong></div><div><span>R:R</span><strong>{fmt(setup?.riskReward)}</strong></div><div><span>ATR</span><strong>{fmt(setup?.technical?.atr)}</strong></div></div>
      <div className="trade-plan"><div><span>ENTRY</span><strong>{fmt(setup?.entry)}</strong></div><div><span>STOP</span><strong>{fmt(setup?.stopLoss)}</strong></div><div><span>TARGET</span><strong>{fmt(setup?.takeProfit)}</strong></div></div>
      <div className="validation"><div className="validation-title">ENGINE VALIDATION · {setup?.validation?.score ?? 0}%</div><div className="checks">{Object.entries(setup?.validation?.checks ?? {}).map(([key, value]) => <span key={key} className={value ? "pass" : "fail"}>{value ? "✓" : "×"} {key}</span>)}</div></div>
      <div className="sentinel-box"><div><b>SENTINEL 2.5</b><span>{sentinel?.approved ? "EXECUTION GATE OPEN" : "EXECUTION GATE CLOSED"}</span></div><p>{sentinel?.reason ?? "Waiting for validated market data."}</p>{risk && <div className="risk-mini"><span>DAILY {fmt(risk.dailyLossPercent)}%</span><span>DD {fmt(risk.drawdownPercent)}%</span><span>EXP {fmt(risk.exposurePercent)}%</span><span>OPEN {risk.openPositions}</span></div>}</div>
      <div className="intel-grid"><div><div className="validation-title">CHARTIST</div><p>{chartist ? `${chartist.session} · ${setup?.smc?.premiumDiscount} · HTF ${chartist.higherTimeframeBias} · MSS ${chartist.mssDirection} · CHoCH ${chartist.chochDirection} · ${chartist.confluenceScore}% confluence` : "—"}</p></div><div><div className="validation-title">ATLAS</div><p>{atlas?.summary ?? "News/macro source unavailable."}</p><div className="source-badge">SOURCE {atlas?.sourceStatus ?? "—"}</div></div></div>
      {atlas?.macroEvents?.length > 0 && <div className="events-box"><div className="validation-title">UPCOMING MACRO EVENTS</div>{atlas.macroEvents.slice(0, 4).map((event: any, index: number) => <div className="event-row" key={`${event.title}-${index}`}><b>{event.impact ?? "UNKNOWN"}</b><span>{event.title}</span><small>{event.country ?? "GLOBAL"}</small></div>)}</div>}
      {openPositions.length > 0 && <div className="positions"><div className="validation-title">OPEN PAPER POSITIONS</div>{openPositions.map((position) => <div className="position-row" key={position.id}><span className={position.side === "BUY" ? "buy" : "sell"}>{position.side}</span><b>{position.quantity}</b><span>@ {fmt(position.entryPrice)}</span><span>SL {fmt(position.stopLoss)}</span><span>TP {fmt(position.takeProfit)}</span></div>)}</div>}
    </section>

    <section className="right-panel"><div className="panel-label">AGENT NETWORK</div><div className="agent-list">{agents.map((agent) => { const Icon = agent.icon; const report = dashboard?.orchestration?.agentReports?.find((item: any) => item.id === agent.name); return <button key={agent.id} className={`agent-card ${selected === agent.id ? "active" : ""}`} onClick={() => setSelected(agent.id)}><div className="agent-icon"><Icon size={17}/></div><div className="agent-copy"><strong>{agent.name}</strong><span>{agent.subtitle}</span></div><span className={`agent-online ${report?.status === "BLOCKED" ? "blocked" : ""}`}>●</span></button>; })}</div></section>

    <section className="bottom-dock"><div><span className="footer-dot"/> PAPER <b>${fmt(account?.equity)}</b></div><div>REALIZED <b>${fmt(account?.realizedPnl)}</b></div><div>OPEN <b>{openPositions.length}</b></div><div><CircleDollarSign size={13}/> DAILY P&L <b>{fmt(account?.dailyRealizedPnl)}</b></div><div><Radio size={13}/> {feed?.tradingAllowed ? "TRADING GATES OPEN" : "TRADING GATES CLOSED"}</div></section>
    <div className="selected-building"><span>MODE</span><strong>{selected === "central" ? "NINE CENTRAL" : selected.toUpperCase()}</strong></div>

    {!user && <div className="auth-overlay"><form className="auth-card glass-panel" onSubmit={loginSubmit}><div className="brand-mark">N</div><div className="panel-label">NINE SECURE ACCESS</div><h2>Sign in to control NINE</h2><p>Market intelligence remains visible, while commands, backtests and trading actions require an authenticated session.</p><input value={login.email} onChange={(e) => setLogin({ ...login, email: e.target.value })} placeholder="Admin email" type="email" autoComplete="username" required/><input value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} placeholder="Password" type="password" autoComplete="current-password" required/>{loginError && <div className="login-error">{loginError}</div>}<button className="login-button" type="submit">AUTHENTICATE</button></form></div>}
  </main>;
}
