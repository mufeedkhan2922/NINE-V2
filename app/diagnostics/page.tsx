"use client";

import { useEffect, useState } from "react";

type Diagnostic = any;

function fmt(v: any, digits = 2) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
}

export default function DiagnosticsPage() {
  const [symbol, setSymbol] = useState("XAUUSD");
  const [data, setData] = useState<Diagnostic | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`/api/nine/diagnostics?symbol=${symbol}`, { cache: "no-store" });
      setData(await res.json());
    } catch (error) {
      setData({ ok: false, explanation: { decision: "BLOCKED", headline: String(error), blockers: [], warnings: [], evidence: [] } });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [symbol]);

  const e = data?.explanation;
  return (
    <main style={{ minHeight: "100vh", background: "#07100d", color: "#e8f0ed", padding: 28, fontFamily: "system-ui, sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 24 }}>
          <div>
            <div style={{ color: "#8df0bd", fontSize: 11, letterSpacing: 2 }}>NINE V2.10</div>
            <h1 style={{ margin: "6px 0", fontSize: 30 }}>Why is NINE blocked?</h1>
            <p style={{ color: "#9aa9a3", margin: 0 }}>A transparent decision, risk, market, Atlas and provider explanation.</p>
          </div>
          <select value={symbol} onChange={(x) => setSymbol(x.target.value)} style={{ padding: "10px 12px", background: "#0d1a16", color: "inherit", border: "1px solid #263c35", borderRadius: 8 }}>
            <option>XAUUSD</option><option>NIFTY</option><option>BANKNIFTY</option>
          </select>
        </div>

        {loading && <div style={{ padding: 18, border: "1px solid #263c35", borderRadius: 10 }}>Loading validated diagnostics…</div>}
        {e && <div style={{ display: "grid", gap: 14 }}>
          <section style={{ padding: 20, border: "1px solid #263c35", borderRadius: 12 }}>
            <div style={{ color: e.decision === "PAPER_READY" ? "#8df0bd" : "#f1cb77", fontSize: 11, letterSpacing: 1.5 }}>{e.decision}</div>
            <h2 style={{ margin: "8px 0" }}>{e.headline}</h2>
            <div>Confidence: <b>{fmt(e.confidence, 0)}%</b></div>
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            {[
              ["Market", e.market?.state, e.market?.dataState],
              ["Cross-timeframe", e.crossTimeframe?.valid ? "PASS" : "BLOCK", `Score ${fmt(e.crossTimeframe?.score,0)}`],
              ["Atlas", e.atlas?.status, e.atlas?.relevance],
              ["Sentinel", e.sentinel?.approved ? "APPROVED" : "BLOCKED", `${e.sentinel?.checksPassed ?? 0}/${e.sentinel?.checksTotal ?? 0} checks`],
              ["Paper", e.paper?.allowed ? "READY" : "BLOCKED", e.paper?.reason],
            ].map(([title, value, sub]) => (
              <div key={title} style={{ padding: 15, border: "1px solid #263c35", borderRadius: 10 }}>
                <small style={{ color: "#7f9089" }}>{title}</small><div style={{ marginTop: 8, fontWeight: 800 }}>{value}</div><div style={{ color: "#9aa9a3", fontSize: 12, marginTop: 5 }}>{sub}</div>
              </div>
            ))}
          </section>

          <section style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div style={{ padding: 16, border: "1px solid #263c35", borderRadius: 10 }}>
              <h3>Blocking reasons</h3>
              {(e.blockers ?? []).length ? e.blockers.map((x: any, i: number) => <div key={i} style={{ padding: "9px 0", borderTop: "1px solid #182821" }}><b>{x.title}</b><div style={{ color: "#ff9a9a", fontSize: 12 }}>{x.detail}</div></div>) : <div style={{ color: "#8df0bd" }}>No blocking reasons.</div>}
            </div>
            <div style={{ padding: 16, border: "1px solid #263c35", borderRadius: 10 }}>
              <h3>Warnings & evidence</h3>
              {[...(e.warnings ?? []), ...(e.evidence ?? [])].map((x: any, i: number) => <div key={i} style={{ padding: "9px 0", borderTop: "1px solid #182821" }}><b>{x.title}</b><div style={{ color: "#9aa9a3", fontSize: 12 }}>{x.detail}</div></div>)}
            </div>
          </section>

          <section style={{ padding: 16, border: "1px solid #263c35", borderRadius: 10 }}>
            <h3>Atlas instrument impact</h3>
            <p style={{ color: "#9aa9a3" }}>{e.atlas?.impact}</p>
            <div style={{ color: "#cbd7d2", fontSize: 12 }}>Macro bias: {e.atlas?.bias} · Events: {e.atlas?.events} · Relevant headlines: {e.atlas?.supportingHeadlines?.length ?? 0}</div>
            {(e.atlas?.supportingHeadlines ?? []).map((h: string, i: number) => <div key={i} style={{ marginTop: 8, color: "#9aa9a3" }}>• {h}</div>)}
          </section>

          {data?.runtime?.provider && <section style={{ padding: 16, border: "1px solid #263c35", borderRadius: 10 }}>
            <h3>Provider diagnostics</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10 }}>
              <div>Provider<br/><b>{data.runtime.provider.provider ?? "—"}</b></div>
              <div>Configured<br/><b>{data.runtime.provider.configured ? "YES" : "NO"}</b></div>
              <div>Rate limit<br/><b>{data.runtime.provider.rateLimited ? "ACTIVE" : "CLEAR"}</b></div>
              <div>Requests/min<br/><b>{data.runtime.provider.requestsLastMinute ?? "—"}</b></div>
            </div>
          </section>}
        </div>}
      </div>
    </main>
  );
}
