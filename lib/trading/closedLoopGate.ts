import { db } from "./db";
import { contextKey, type TradeContext } from "./rootCauseLearning";

export interface ClosedLoopGateDecision {
  blocked: boolean;
  ruleId: string | null;
  status: "ACTIVE_BLOCK" | "SHADOW" | "RELEASED" | "NONE";
  reason: string;
  oosObservations: number;
  oosFailureRateLower95: number;
  oosExpectancyR: number;
}

export function getClosedLoopDecision(
  symbol: string,
  context: TradeContext,
): ClosedLoopGateDecision {
  const key = contextKey(context);
  const row = db.prepare(
    "SELECT id,status,cause,oos_observations,oos_failure_rate_lower_95,oos_expectancy_r,reason,expires_at FROM closed_loop_rules WHERE symbol=? AND context_key=? ORDER BY updated_at DESC LIMIT 1",
  ).get(symbol, key) as any;

  if (!row) {
    return {
      blocked: false,
      ruleId: null,
      status: "NONE",
      reason: "No closed-loop rule matches the current context.",
      oosObservations: 0,
      oosFailureRateLower95: 0,
      oosExpectancyR: 0,
    };
  }

  if (Number(row.expires_at) <= Date.now()) {
    return {
      blocked: false,
      ruleId: String(row.id),
      status: "NONE",
      reason: "Closed-loop rule expired and requires fresh validation.",
      oosObservations: Number(row.oos_observations),
      oosFailureRateLower95: Number(row.oos_failure_rate_lower_95),
      oosExpectancyR: Number(row.oos_expectancy_r),
    };
  }

  const status = row.status as ClosedLoopGateDecision["status"];
  const blocked = status === "ACTIVE_BLOCK";
  return {
    blocked,
    ruleId: String(row.id),
    status,
    reason: blocked
      ? `Closed-loop block: ${row.cause}; OOS observations=${row.oos_observations}; lower95=${row.oos_failure_rate_lower_95}; expectancyR=${row.oos_expectancy_r}. ${row.reason}`
      : String(row.reason),
    oosObservations: Number(row.oos_observations),
    oosFailureRateLower95: Number(row.oos_failure_rate_lower_95),
    oosExpectancyR: Number(row.oos_expectancy_r),
  };
}
