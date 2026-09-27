"use client";

import { useState } from "react";

export default function BacktestPage() {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [timeframe, setTimeframe] = useState("5min");
  const [risk, setRisk] = useState("0.5");
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, timeframe, riskPercent: Number(risk), initialBalance: 10000 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Backtest failed");
      setResult(json);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const r = result?.result;
  const analytics = result?.v210?.analytics;
  const curve = analytics?.equityCurve ?? [];
  const maxBalance = Math.max(...curve.map((x: any) => x.balance), 10000);
  const minBalance = Math.min(...curve.map((x: any) => x.balance), 10000);

  return (
    <main style={{ minHeight: "100vh", background: "#07100d", color: "#e8f0ed", padding: 28, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}><div style={{ color: "#8df0bd", fontSize: 11, letterSpacing: 2 }}>NINE V2.10</div><h1 style={{ margin: "6px 0" }}>Backtest Intelligence</h1><p style={{ color: "#9aa9a3" }}>Configuration, equity curve, distribution, expectancy and trade reasoning.</p></div>
        <section style={{ display: "flex", flexWrap: "wrap", gap: 10, padding: 14, border: "1px solid #263c35", borderRadius: 10 }}>
          <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={s}><option>XAUUSD</option><option>NIFTY</option><option>BANKNIFTY</option></select>
          <select value={timeframe} onChange={e=>setTimeframe(e.target.value)} style={s}><option>1min</option><option>5min</option><option>15min</option><option>1h</option><option>4h</option><option>1day</option></select>
          <input value={risk} onChange={e=>setRisk(e.target.value)} type="number" step="0.1" min="0.1" max="1" style={s} />
          <button onClick={run} disabled={busy} style={{...s, cursor:"pointer", background:"#8df0bd", color:"#07100d", fontWeight:800}}>{busy ? "RUNNING…" : "RUN BACKTEST"}</button>
        </section>
        {error && <div style={{ marginTop:12, padding:12, border:"1px solid #633", color:"#ff9a9a", borderRadius:8 }}>{error}</div>}
        {r && <div style={{ display:"grid", gap:14, marginTop:14 }}>
          <section style={grid}>
            {[
              ["Trades", r.totalTrades],["Win rate", `${r.winRate.toFixed(1)}%`],["Net P&L", r.netPnl.toFixed(2)],["Max DD", `${r.maxDrawdown.toFixed(2)}%`],
              ["Profit factor", Number.isFinite(r.profitFactor)?r.profitFactor.toFixed(2):"∞"],["Expectancy", r.expectancy.toFixed(2)],["Avg win", r.averageWin.toFixed(2)],["Avg loss", r.averageLoss.toFixed(2)],
              ["W streak", r.winningStreak],["L streak", r.losingStreak],["Largest win", r.distribution.largestWin.toFixed(2)],["Largest loss", r.distribution.largestLoss.toFixed(2)]
            ].map(([a,b])=><div key={a} style={card}><small>{a}</small><b>{b}</b></div>)}
          </section>
          <section style={card}><h3>Equity curve</h3><div style={{height:180,display:"flex",alignItems:"end",gap:2,borderBottom:"1px solid #263c35"}}>{curve.map((p:any,i:number)=><div key={i} title={`Trade ${p.trade}: ${p.balance.toFixed(2)}`} style={{height:`${((p.balance-minBalance)/Math.max(1,maxBalance-minBalance))*100}%`,flex:1,minWidth:2,background:p.balance>=10000?"#3acb8f":"#e25555"}} />)}</div></section>
          <section style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div style={card}><h3>Win/loss distribution</h3>{(r.distribution?.buckets??[]).map((b:any)=><div key={b.label} style={row}><span>{b.label}</span><b>{b.count} · {b.pnl.toFixed(2)}</b></div>)}</div>
            <div style={card}><h3>Configuration</h3>{Object.entries(result.v210.configuration).map(([k,v])=><div key={k} style={row}><span>{k}</span><b>{String(v)}</b></div>)}</div>
          </section>
          <section style={card}><h3>Trade-by-trade reasoning</h3><div style={{overflowX:"auto"}}><table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}><thead><tr>{["Side","Entry","Exit","P&L","Entry reason","Exit reason"].map(x=><th key={x} style={{textAlign:"left",padding:8,borderBottom:"1px solid #263c35"}}>{x}</th>)}</tr></thead><tbody>{(r.trades??[]).map((t:any)=><tr key={t.id}><td style={{padding:8}}>{t.side}</td><td>{t.entryPrice.toFixed(2)}</td><td>{t.exitPrice.toFixed(2)}</td><td>{t.pnl.toFixed(2)}</td><td>{t.entryReason}</td><td>{t.exitReason}</td></tr>)}</tbody></table></div></section>
        </div>}
      </div>
    </main>
  );
}
const s: React.CSSProperties = { padding:"9px 11px", border:"1px solid #263c35", borderRadius:8, background:"#0d1a16", color:"#e8f0ed" };
const grid: React.CSSProperties = { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 };
const card: React.CSSProperties = { padding:15, border:"1px solid #263c35", borderRadius:10, background:"#0b1713" };
const row: React.CSSProperties = { display:"flex", justifyContent:"space-between", gap:10, padding:"8px 0", borderTop:"1px solid #182821", fontSize:12 };
