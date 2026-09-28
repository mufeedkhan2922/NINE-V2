"use client";

import { BrainCircuit, Gauge, History, ShieldCheck, Target, Waves } from "lucide-react";

export function XAUV5Intelligence({ intelligence }: { intelligence?: any }) {
  const v = intelligence;
  if (!v) return null;
  const consensus = v.strategyConsensus;
  const learning = v.learning;
  const regime = v.regimeEngine;
  const color = v.action === "PAPER_READY" ? "ready" : v.action === "BLOCKED" ? "blocked" : "watch";

  return (
    <section className={`xau-v5-intelligence ${color}`}>
      <div className="xau-v5-head">
        <div>
          <div className="xau-v5-kicker"><BrainCircuit size={13} /> V5.5 AUTONOMOUS INTELLIGENCE</div>
          <h2>Decision Fusion</h2>
          <p>Regime-aware strategy selection + walk-forward learning + Chartist + Atlas + Sentinel</p>
        </div>
        <div className="xau-v5-action"><span />{v.action}<small>{v.direction} · {v.confidence}% confidence</small></div>
      </div>

      <div className="xau-v5-metrics">
        <div><span>REGIME</span><b>{v.regime ?? "UNKNOWN"}</b><small>{regime?.confidence ?? 0}% classification confidence</small></div>
        <div><span>TOP SETUP</span><b>{regime?.topSetup?.strategyName ?? "—"}</b><small>{regime?.topSetup ? `#${regime.topSetup.rank} · ${regime.topSetup.finalScore}/100` : "No ranked setup"}</small></div>
        <div><span>STRATEGIES</span><b>{consensus?.alignedStrategies ?? 0} / {consensus?.activeStrategies ?? 0}</b><small>aligned / active</small></div>
        <div><span>CONSENSUS</span><b>{consensus?.direction ?? "NONE"}</b><small>{consensus?.score ?? 0}/100 score</small></div>
        <div><span>LEARNING</span><b>{learning?.bestStrategyName ?? "—"}</b><small>{learning?.bestRobustnessScore ?? 0}/100 robustness</small></div>
      </div>

      <div className="xau-v5-grid">
        <div className="xau-v5-panel">
          <header><Waves size={13} /> REGIME ENGINE</header>
          <div className="xau-v55-regime"><b>{regime?.regime ?? "UNKNOWN"}</b><span>{regime?.confidence ?? 0}%</span></div>
          <p>Trend strength: {regime?.features?.trendScore ?? 0}/100</p>
          <p>Volatility ratio: {regime?.features?.volatilityRatio?.toFixed?.(2) ?? "—"}×</p>
          <p>Efficiency: {regime?.features?.directionalEfficiency?.toFixed?.(2) ?? "—"}</p>
          <p>Sweep: {regime?.features?.sweepDetected ? "DETECTED" : "NONE"} · MSS: {regime?.features?.structureShiftDetected ? "CONFIRMED" : "NONE"}</p>
          <small>{(regime?.preferredFamilies ?? []).join(" · ") || "No preferred families"}</small>
        </div>

        <div className="xau-v5-panel">
          <header><Target size={13} /> SETUP RANKING</header>
          {(regime?.rankedSetups ?? []).slice(0, 6).map((candidate: any) => (
            <div className="xau-v55-rank" key={candidate.strategyId}>
              <span>#{candidate.rank}</span>
              <strong>{candidate.strategyName}</strong>
              <em>{candidate.finalScore}</em>
              <small>{candidate.fit}</small>
            </div>
          ))}
        </div>

        <div className="xau-v5-panel">
          <header><Target size={13} /> STRATEGY FUSION</header>
          {(consensus?.candidates ?? []).slice(0, 5).map((candidate: any) => (
            <div className="xau-v5-row" key={candidate.strategyId}>
              <span>{candidate.strategyName}</span><b>{candidate.direction}</b><em>{candidate.score}</em>
            </div>
          ))}
        </div>

        <div className="xau-v5-panel">
          <header><History size={13} /> LEARNING STATE</header>
          <p>{learning?.totalEvaluatedSignals ?? 0} evaluated signals</p>
          <p>{learning?.strategies?.length ?? 0} strategies measured</p>
          <p>{learning?.robust ? "Positive expectancy + profit factor" : "Robustness not yet established"}</p>
          <p>{learning?.targetReached ? "Target threshold reached in measured sample" : "Target threshold not reached"}</p>
        </div>

        <div className="xau-v5-panel">
          <header><Gauge size={13} /> EVIDENCE CHAIN</header>
          {(v.evidence ?? []).slice(0, 5).map((item: any, index: number) => (
            <div className="xau-v5-evidence" key={`${item.source}-${index}`}><span>{item.source}</span><p>{item.statement}</p></div>
          ))}
        </div>

        <div className="xau-v5-panel">
          <header><ShieldCheck size={13} /> SENTINEL AUTHORITY</header>
          <p>{v.executionAuthority}</p>
          <p>Mode: {v.executionMode}</p>
          <p>{v.blockers?.length ? `${v.blockers.length} blocker(s) active` : "No V5 blocker"} </p>
          <p>{v.warnings?.length ? `${v.warnings.length} warning(s)` : "No warnings"}</p>
        </div>
      </div>
    </section>
  );
}
