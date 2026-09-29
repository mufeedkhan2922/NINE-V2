import fs from "node:fs";
import { fetchProviderHistoricalCandles } from "../lib/trading/provider";
import { runBacktest, type RejectedSignal } from "../lib/trading/backtest";
import { runResearchCycle } from "../lib/trading/autonomousResearch";
import { evaluateRejectedTrade } from "../lib/trading/counterfactual";
import { db, transaction } from "../lib/trading/db";
import type { Candle } from "../lib/trading/types";

const START = process.env.NINE_LEARNING_START ?? "2026-08-01";
const END = process.env.NINE_LEARNING_END ?? "2026-09-29";
const CHUNK_DAYS = 10;

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

function persistCounterfactuals(items: Array<{ signal: RejectedSignal; result: ReturnType<typeof evaluateRejectedTrade> }>) {
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
  const researchTelemetry: { rejectedSignals: RejectedSignal[] } = { rejectedSignals: [] };

  const baseline = runBacktest(candles, 10_000, 0.5, undefined, false, {
    research: researchTelemetry,
  });

  const cycle = runResearchCycle(baseline.trades, candles);
  persistRules(cycle.rules);

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
    version: "0.5.16.1",
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
    ],
    baseline: {
      trades: baseline.totalTrades,
      wins: baseline.wins,
      losses: baseline.losses,
      winRate: baseline.winRate,
      netPnl: baseline.netPnl,
      profitFactor: baseline.averageLoss !== 0
        ? Number((Math.abs(baseline.averageWin / baseline.averageLoss) * (baseline.wins / Math.max(1, baseline.losses))).toFixed(2))
        : baseline.wins
          ? Number.POSITIVE_INFINITY
          : 0,
    },
    research: {
      findings: cycle.findings.length,
      rules: cycle.rules,
      nextAction: cycle.nextAction,
    },
    counterfactualSummary: {
      evaluated: counterfactuals.length,
      wouldHaveWon: counterfactuals.filter((item) => item.result.hypotheticalOutcome === "WOULD_HAVE_WON").length,
      wouldHaveLost: counterfactuals.filter((item) => item.result.hypotheticalOutcome === "WOULD_HAVE_LOST").length,
      unresolved: counterfactuals.filter((item) => item.result.hypotheticalOutcome === "UNRESOLVED").length,
    },
    warnings: [
      "Root-cause findings and learned rules remain research candidates until independent out-of-sample validation.",
      "Counterfactuals now represent actual signals rejected by the adaptive/persistent research gates; they remain hypothetical and do not represent executable fills.",
      "No live broker execution is enabled by this research cycle.",
    ],
  };

  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync("artifacts/xauusd-learning-cycle.json", JSON.stringify({ ...result, counterfactuals }, null, 2));
  fs.writeFileSync(
    "artifacts/xauusd-learning-cycle.md",
    [
      "# NINE XAUUSD Autonomous Learning Cycle",
      "",
      "Period: " + START + " to " + END,
      "Trades investigated: " + baseline.totalTrades,
      "Losses investigated: " + baseline.losses,
      "Root-cause findings: " + cycle.findings.length,
      "Rule candidates: " + cycle.rules.length,
      "Rejected signals evaluated: " + counterfactuals.length,
      "Would have won: " + counterfactuals.filter((item) => item.result.hypotheticalOutcome === "WOULD_HAVE_WON").length,
      "Would have lost: " + counterfactuals.filter((item) => item.result.hypotheticalOutcome === "WOULD_HAVE_LOST").length,
      "",
      "## Rule Candidates",
      "",
      ...cycle.rules.map((rule) =>
        "- " + rule.status +
        ": " + rule.strategy +
        " | " + rule.session +
        " | " + rule.side +
        " | " + rule.cause +
        " | observations=" + rule.observations +
        " | failures=" + rule.failures +
        " | failureRate=" + rule.failureRate +
        " | expectancyR=" + rule.expectancyR
      ),
      "",
      "## Safety",
      "",
      ...result.warnings.map((warning) => "- " + warning),
    ].join("\n"),
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
