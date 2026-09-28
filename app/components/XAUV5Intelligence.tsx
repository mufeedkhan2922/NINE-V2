"use client";

import { BrainCircuit, Gauge, History, ShieldCheck, Target } from "lucide-react";

export function XAUV5Intelligence({ intelligence }: { intelligence?: any }) {
  const v = intelligence;
  if (!v) return null;
  const consensus = v.strategyConsensus;
  const learning = v.learning;
  const color = v.action === "PAPER_READY" ? "ready" : v.action === "BLOCKED" ? "blocked" : "watch";

  return (
    <section className={`xau-v5-intelligence ${color}`}>
      <div className="xau-v5-head">
        <div>
          <div className="xau-v5-kicker"><BrainCircuit size={13} /> V5 AUTONOMOUS INTELLIGENCE</div>
          <h2>Decision Fusion</h2>
          <p>Strategy consensus + walk-forward learning + Chartist + Atlas + Sentinel</p>
        </div>
        <div className="xau-v5-action"><span />{v.action}<small>{v.direction} · {v.confidence}% confidence</small></div>
      </div>

      <div className="xau-v5-metrics">
        <div><span>REGIME</span><b>{v.regime}</b></div>
        <div><span>STRATEGIES</span><b>{consensus?.alignedStrategies ?? 0} / {consensus?.activeStrategies ?? 0}</b><small>aligned / active</small></div>
        <div><span>CONSENSUS</span><b>{consensus?.direction ?? "NONE"}</b><small>{consensus?.score ?? 0}/100 score</small></div>
        <div><span>LEARNING</span><b>{learning?.bestStrategyName ?? "—"}</b><small>{learning?.bestRobustnessScore ?? 0}/100 robustness</small></div>
        <div><span>PAPER EDGE</span><b>{learning?.bestWinRate != null ? `${learning.bestWinRate.toFixed(1)}%` : "—"}</b><small>measured walk-forward</small></div>
      </div>

      <div className="xau-v5-grid">
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
