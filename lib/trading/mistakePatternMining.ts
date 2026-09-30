import { createHash } from "node:crypto";
import { db, transaction } from "./db";

export type MistakePatternStatus = "OBSERVE" | "PENALIZE" | "BLOCK";

export interface MistakePattern {
  id: string;
  symbol: string;
  session: string;
  regime: string;
  side: "LONG" | "SHORT";
  failureMode: string;
  contexts: number;
  strategies: number;
  observations: number;
  failures: number;
  wins: number;
  failureRate: number;
  failureRateLower95: number;
  expectancyR: number;
  severity: number;
  confidence: number;
  status: MistakePatternStatus;
}

function wilsonLower(wins: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = wins / n;
  const denominator = 1 + (z * z) / n;
  return (
    p + (z * z) / (2 * n) -
    z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)
  ) / denominator;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function patternId(symbol: string, session: string, regime: string, side: string, failureMode: string): string {
  return createHash("sha256")
    .update([symbol, session, regime, side, failureMode].join("|"))
    .digest("hex")
    .slice(0, 24);
}

function statusFor(observations: number, lower: number, expectancyR: number): MistakePatternStatus {
  if (observations >= 20 && lower >= 0.55 && expectancyR < -0.05) return "BLOCK";
  if (observations >= 10 && lower >= 0.45) return "PENALIZE";
  return "OBSERVE";
}

/**
 * Mines causal memory across strategies. A pattern only becomes systemic when
 * the same failure signature recurs across at least two distinct strategies.
 * This prevents one strategy's isolated losses from contaminating unrelated setups.
 */
export function mineMistakePatterns(symbol = "XAUUSD"): MistakePattern[] {
  const rows = db.prepare(`
    SELECT symbol,session,regime,side,failure_mode,
           COUNT(DISTINCT strategy) AS strategies,
           COUNT(*) AS contexts,
           SUM(observations) AS observations,
           SUM(failures) AS failures,
           SUM(wins) AS wins,
           SUM(expectancy_r * observations) AS expectancyTotal,
           SUM(severity * observations) AS severityTotal
    FROM causal_failure_memory
    WHERE symbol=?
      AND side IN ('LONG','SHORT')
      AND failure_mode NOT IN ('UNKNOWN')
    GROUP BY symbol,session,regime,side,failure_mode
    ORDER BY observations DESC
  `).all(symbol) as Array<any>;

  const patterns: MistakePattern[] = [];
  transaction(() => {
    for (const row of rows) {
      const observations = Number(row.observations);
      const failures = Number(row.failures);
      const wins = Number(row.wins);
      const expectancyR = observations > 0 ? Number(row.expectancyTotal) / observations : 0;
      const severity = observations > 0 ? Number(row.severityTotal) / observations : 0;
      const lower = wilsonLower(failures, observations);
      const strategies = Number(row.strategies);
      const status = strategies >= 2
        ? statusFor(observations, lower, expectancyR)
        : "OBSERVE";
      const pattern: MistakePattern = {
        id: patternId(row.symbol, row.session, row.regime, row.side, row.failure_mode),
        symbol: row.symbol,
        session: row.session,
        regime: row.regime,
        side: row.side,
        failureMode: row.failure_mode,
        contexts: Number(row.contexts),
        strategies,
        observations,
        failures,
        wins,
        failureRate: observations > 0 ? failures / observations : 0,
        failureRateLower95: lower,
        expectancyR,
        severity,
        confidence: Math.min(1, observations / 100) * Math.min(1, strategies / 2),
        status,
      };
      db.prepare(`
        INSERT INTO mistake_patterns
        (id,symbol,session,regime,side,failure_mode,contexts,strategies,observations,failures,wins,
         failure_rate,failure_rate_lower_95,expectancy_r,severity,confidence,status,source,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(symbol,session,regime,side,failure_mode) DO UPDATE SET
          contexts=excluded.contexts,
          strategies=excluded.strategies,
          observations=excluded.observations,
          failures=excluded.failures,
          wins=excluded.wins,
          failure_rate=excluded.failure_rate,
          failure_rate_lower_95=excluded.failure_rate_lower_95,
          expectancy_r=excluded.expectancy_r,
          severity=excluded.severity,
          confidence=excluded.confidence,
          status=excluded.status,
          source=excluded.source,
          updated_at=excluded.updated_at
      `).run(
        pattern.id,row.symbol,row.session,row.regime,row.side,row.failure_mode,
        pattern.contexts,strategies,observations,failures,wins,pattern.failureRate,
        lower,expectancyR,severity,pattern.confidence,status,"MISTAKE_PATTERN_MINER",Date.now()
      );
      patterns.push(pattern);
    }
  });
  return patterns;
}

export function getMistakePatternDecision(
  symbol: string,
  session: string,
  regime: string,
  side: "LONG" | "SHORT",
): { blocked: boolean; adjustment: number; observations: number; reason: string; patterns: string[] } {
  // Generalized contexts are deliberately weaker than exact matches. OFF/MIXED
  // patterns can inform a warning, but they must not silently become exact blockers.
  const exactRows = db.prepare(`
    SELECT * FROM mistake_patterns
    WHERE symbol=? AND side=? AND session=? AND regime=?
      AND status IN ('PENALIZE','BLOCK')
    ORDER BY failure_rate_lower_95 DESC, observations DESC
  `).all(symbol,side,session,regime) as Array<any>;

  const generalizedRows = exactRows.length ? [] : db.prepare(`
    SELECT * FROM mistake_patterns
    WHERE symbol=? AND side=?
      AND (session=? OR session='OFF')
      AND (regime=? OR regime='MIXED')
      AND status IN ('PENALIZE','BLOCK')
    ORDER BY failure_rate_lower_95 DESC, observations DESC
  `).all(symbol,side,session,regime) as Array<any>;

  const exact = exactRows.length > 0;
  const rows = exact ? exactRows : generalizedRows.filter((r) =>
    Number(r.observations) >= 40 &&
    Number(r.strategies) >= 3 &&
    Number(r.failure_rate_lower_95) >= 0.65
  );

  if (!rows.length) {
    return { blocked:false, adjustment:0, observations:0, reason:"No sufficiently validated recurring mistake pattern for this context.", patterns:[] };
  }

  const blockers = exact
    ? rows.filter((r) => r.status === "BLOCK" && Number(r.strategies) >= 2)
    : [];
  const penalty = rows
    .filter((r) => r.status === "PENALIZE")
    .reduce((sum, r) => sum + Math.min(4, Number(r.failure_rate_lower_95) * 4) * (exact ? 1 : 0.5), 0);

  return {
    blocked: blockers.length > 0,
    adjustment: Number(-Math.min(6, penalty).toFixed(2)),
    observations: rows.reduce((sum, r) => sum + Number(r.observations), 0),
    reason: blockers.length
      ? `Recurring cross-strategy mistake pattern persists: ${blockers.map((r) => r.failure_mode).join(", ")}.`
      : `Recurring mistake patterns reduce confidence: ${rows.map((r) => r.failure_mode).join(", ")}.`,
    patterns: rows.map((r) => String(r.failure_mode)),
  };
}

export function mistakePatternResearchSummary(symbol = "XAUUSD"): Record<string, unknown> {
  const rows = db.prepare(`
    SELECT failure_mode AS failureMode,status,
           COUNT(*) AS patterns,
           SUM(strategies) AS strategyCoverage,
           SUM(observations) AS observations,
           ROUND(AVG(failure_rate),4) AS failureRate,
           ROUND(AVG(expectancy_r),4) AS expectancyR
    FROM mistake_patterns
    WHERE symbol=?
    GROUP BY failure_mode,status
    ORDER BY observations DESC
  `).all(symbol) as Array<Record<string, unknown>>;
  return { version:"0.5.28", symbol, rows, generatedAt:Date.now() };
}

export function normalizeMistakeStrategy(value: string): string {
  return normalize(value);
}
