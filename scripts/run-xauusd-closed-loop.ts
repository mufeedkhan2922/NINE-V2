import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest, type RejectedSignal } from "../lib/trading/backtest";
import { validateClosedLoopRules } from "../lib/trading/closedLoopLearning";
import { runResearchCycle } from "../lib/trading/autonomousResearch";
import { evaluateRejectedTrade } from "../lib/trading/counterfactual";
import { db, transaction } from "../lib/trading/db";
import type { Candle } from "../lib/trading/types";

const START = process.env.NINE_LEARNING_START ?? "2026-08-01";
const END = process.env.NINE_LEARNING_END ?? "2026-09-29";
const CHUNK_DAYS = 10;
const RULE_TTL_DAYS = 30;

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

async function fetchHistory(): Promise<Candle[]> {
  const start = new Date(START + "T00:00:00Z");
  const end = new Date(END + "T00:00:00Z");
  const map = new Map<number, Candle>();

  for (let cursor = start; cursor < end; cursor = addDays(cursor, CHUNK_DAYS)) {
    const to = addDays(cursor, CHUNK_DAYS) < end ? addDays(cursor, CHUNK_DAYS) : end;
    for (const candle of await fetchProviderHistoricalCandles("XAUUSD", "5min", iso(cursor), iso(to))) {
      map.set(candle.time, candle);
    }
  }

  return [...map.values()].sort((a, b) => a.time - b.time);
}

function persistClosedLoopRules(
  rules: ReturnType<typeof validateClosedLoopRules>["rules"],
) {
  const now = Date.now();
  const expiresAt = now + RULE_TTL_DAYS * 24 * 60 * 60 * 1000;

  transaction(() => {
    // A fresh validation cycle supersedes old active blocks. Rules reproduced below
    // are reinserted with fresh evidence; unreproduced blocks move to SHADOW so the
    // engine never carries an unverified block indefinitely.
    db.prepare(
      "UPDATE closed_loop_rules SET status='SHADOW', reason='Not reproduced by the latest independent validation cycle; awaiting fresh evidence.', updated_at=?, expires_at=? WHERE symbol=? AND status='ACTIVE_BLOCK'",
    ).run(now, now + 7 * 24 * 60 * 60 * 1000, "XAUUSD");

    const stmt = db.prepare(
      `INSERT OR REPLACE INTO closed_loop_rules (
        id,symbol,context_key,strategy,session,side,regime,cause,status,
        train_observations,train_failures,train_failure_rate,
        oos_observations,oos_failures,oos_wins,oos_failure_rate,
        oos_failure_rate_lower_95,oos_expectancy_r,counter_evidence,
        recent_failure_rate,reason,updated_at,expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );

    for (const rule of rules) {
      stmt.run(
        rule.id,
        "XAUUSD",
        rule.contextKey,
        rule.strategy,
        rule.session,
        rule.side,
        rule.regime,
        rule.cause,
        rule.status,
        rule.trainObservations,
        rule.trainFailures,
        rule.trainFailureRate,
        rule.oosObservations,
        rule.oosFailures,
        rule.oosWins,
        rule.oosFailureRate,
        rule.oosFailureRateLower95,
        rule.oosExpectancyR,
        rule.counterEvidence,
        rule.recentFailureRate,
        rule.reason,
        now,
        expiresAt,
      );
    }
  });
}

function persistRules(rules: ReturnType<typeof runResearchCycle>["rules"]) {
  transaction(() => {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO learned_rules (id,symbol,strategy,session,side,condition,cause,observations,failures,failure_rate,mean_severity,expectancy_r,failure_rate_lower_95,status,reason,source,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const rule of rules) {
      stmt.run(
        rule.id,
        "XAUUSD",
        rule.strategy,
        rule.session,
        rule.side,
        rule.condition,
        rule.cause,
        rule.observations,
        rule.failures,
        rule.failureRate,
        rule.meanSeverity,
        rule.expectancyR,
        rule.failureRateLower95,
        rule.status,
        rule.reason,
        "XAUUSD_RESEARCH",
        Date.now(),
      );
    }
  });
}

function persistCounterfactuals(
  items: Array<{ signal: RejectedSignal; result: ReturnType<typeof evaluateRejectedTrade> }>,
) {
  transaction(() => {
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO counterfactual_results (id,symbol,entry_time,side,outcome,hypothetical_pnl,max_favorable_r,max_adverse_r,horizon_candles,source,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    );

    for (const item of items) {
      stmt.run(
        item.signal.entryTime + ":" + item.signal.side + ":" + item.signal.index,
        "XAUUSD",
        item.signal.entryTime,
        item.signal.side,
        item.result.hypotheticalOutcome,
        item.result.hypotheticalPnl,
        item.result.maxFavorableR,
        item.result.maxAdverseR,
        item.result.horizonCandles,
        item.signal.rejectionReason,
        Date.now(),
      );
    }
  });
}

async function main() {
  if (!process.env.TWELVE_DATA_API_KEY) throw new Error("TWELVE_DATA_API_KEY is missing.");

  const candles = await fetchHistory();
  if (candles.length < 200) throw new Error(`Insufficient XAUUSD candles: ${candles.length}`);

  const researchTelemetry: { rejectedSignals: RejectedSignal[] } = { rejectedSignals: [] };

  // Baseline is intentionally unblocked so the learning system observes the raw strategy.
  const baseline = runBacktest(candles, 10_000, 0.5, undefined, false, {
    research: researchTelemetry,
    regimePolicyMode: "OFF",
    useClosedLoopLearning: false,
  });

  const research = runResearchCycle(baseline.trades, candles);
  persistRules(research.rules);

  // Independent 70/30 validation. Only rules that reproduce out of sample can become ACTIVE_BLOCK.
  const closedLoop = validateClosedLoopRules(baseline.trades, candles);
  persistClosedLoopRules(closedLoop.rules);

  const counterfactuals = researchTelemetry.rejectedSignals.map((signal) => ({
    signal,
    result: evaluateRejectedTrade(
      signal.entryTime,
      signal.side,
      signal.entryPrice,
      signal.stopLoss,
      signal.takeProfit,
      candles,
    ),
  }));
  persistCounterfactuals(counterfactuals);

  const result = {
    version: "0.5.17",
    instrument: "XAUUSD",
    timeframe: "5min",
    period: { start: START, end: END },
    architecture: [
      "0.5.11 persistent loss memory",
      "0.5.12 causal root-cause learning",
      "0.5.13 rejected-signal counterfactual analysis",
      "0.5.14 outcome-aware rule validation",
      "0.5.15 regime policy shadow layer",
      "0.5.16 autonomous research cycle",
      "0.5.17 closed-loop OOS validation + persistent future pre-trade blocking",
    ],
    baseline: {
      trades: baseline.totalTrades,
      wins: baseline.wins,
      losses: baseline.losses,
      winRate: baseline.winRate,
      netPnl: baseline.netPnl,
    },
    closedLoop: {
      trainStart: closedLoop.trainStart,
      trainEnd: closedLoop.trainEnd,
      oosStart: closedLoop.oosStart,
      oosEnd: closedLoop.oosEnd,
      rules: closedLoop.rules,
      activeBlocks: closedLoop.activeBlocks.length,
      shadowRules: closedLoop.shadowRules.length,
      releasedRules: closedLoop.releasedRules.length,
      nextAction: closedLoop.nextAction,
      ruleTtlDays: RULE_TTL_DAYS,
    },
    research: {
      findings: research.findings.length,
      rules: research.rules,
      nextAction: research.nextAction,
    },
    counterfactualSummary: {
      evaluated: counterfactuals.length,
      wouldHaveWon: counterfactuals.filter((item) => item.result.hypotheticalOutcome === "WOULD_HAVE_WON").length,
      wouldHaveLost: counterfactuals.filter((item) => item.result.hypotheticalOutcome === "WOULD_HAVE_LOST").length,
      unresolved: counterfactuals.filter((item) => item.result.hypotheticalOutcome === "UNRESOLVED").length,
    },
    safety: [
      "Closed-loop rules are never activated from training evidence alone.",
      "Activation requires independent OOS reproduction and negative OOS expectancy.",
      "Recent counter-evidence can move a rule to SHADOW/RELEASED instead of blocking.",
      "Persisted blocks expire after 30 days and require fresh validation.",
      "No live broker execution is enabled by this research cycle.",
    ],
  };

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-closed-loop-cycle.json", JSON.stringify({ ...result, counterfactuals }, null, 2));
  fs.writeFileSync(
    "artifacts/xauusd-closed-loop-cycle.md",
    [
      "# NINE XAUUSD Closed-Loop Learning Cycle",
      "",
      "Period: " + START + " to " + END,
      "Baseline trades: " + baseline.totalTrades,
      "Baseline losses: " + baseline.losses,
      "Root-cause findings: " + research.findings.length,
      "Closed-loop rules evaluated: " + closedLoop.rules.length,
      "Active future blocks: " + closedLoop.activeBlocks.length,
      "Shadow recovery rules: " + closedLoop.shadowRules.length,
      "Released rules: " + closedLoop.releasedRules.length,
      "",
      "## Closed-Loop Rules",
      "",
      ...closedLoop.rules.map((rule) =>
        "- " + rule.status +
        ": " + rule.strategy +
        " | " + rule.session +
        " | " + rule.side +
        " | " + rule.regime +
        " | " + rule.cause +
        " | train=" + rule.trainObservations +
        " | OOS=" + rule.oosObservations +
        " | OOS lower95=" + rule.oosFailureRateLower95 +
        " | OOS expectancyR=" + rule.oosExpectancyR +
        " | recentFailureRate=" + (rule.recentFailureRate ?? "n/a")
      ),
      "",
      "## Safety",
      "",
      ...result.safety.map((item) => "- " + item),
    ].join("\n"),
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
