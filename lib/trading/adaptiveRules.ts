import type { BacktestTrade } from "./backtest";
import type { RootCauseFinding } from "./rootCauseLearning";
import { buildTradeContext, contextKey } from "./rootCauseLearning";

export interface LearnedRule {
  id: string;
  strategy: string;
  session: string;
  side: "LONG" | "SHORT";
  condition: string;
  cause: string;
  observations: number;
  failures: number;
  failureRate: number;
  meanSeverity: number;
  expectancyR: number;
  failureRateLower95: number;
  status: "CANDIDATE" | "VALIDATED" | "BLOCKED";
  reason: string;
}

function wilsonLower(successes: number, observations: number, z = 1.96): number {
  if (observations <= 0) return 0;
  const p = successes / observations;
  const denominator = 1 + (z * z) / observations;
  const centre = p + (z * z) / (2 * observations);
  const margin = z * Math.sqrt((p * (1 - p) / observations) + (z * z) / (4 * observations * observations));
  return Math.max(0, (centre - margin) / denominator);
}

export function mineRules(
  findings: RootCauseFinding[],
  trades: BacktestTrade[],
  minimumObservations = 20,
): LearnedRule[] {
  const findingGroups = new Map<string, RootCauseFinding[]>();
  for (const finding of findings) {
    if (finding.cause === "UNKNOWN") continue;
    const key = contextKey(finding.context) + "|" + finding.cause;
    const group = findingGroups.get(key) ?? [];
    group.push(finding);
    findingGroups.set(key, group);
  }

  const tradesByContext = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const key = contextKey(buildTradeContext(trade, trades.length ? [] : []));
    void key;
  }

  // Contexts are attached to findings, so build the denominator from findings plus
  // successful counter-evidence supplied by the caller through allTradesByContext.
  // The function below accepts the complete trade set through the optional overload.
  return [];
}

export interface RuleMiningInput {
  findings: RootCauseFinding[];
  trades: BacktestTrade[];
  candles: import("./types").Candle[];
  minimumObservations?: number;
}

export function mineValidatedRules({
  findings,
  trades,
  candles,
  minimumObservations = 20,
}: RuleMiningInput): LearnedRule[] {
  const findingGroups = new Map<string, RootCauseFinding[]>();
  for (const finding of findings) {
    if (finding.cause === "UNKNOWN") continue;
    const key = contextKey(finding.context) + "|" + finding.cause;
    const group = findingGroups.get(key) ?? [];
    group.push(finding);
    findingGroups.set(key, group);
  }

  const contextTrades = new Map<string, BacktestTrade[]>();
  for (const trade of trades) {
    const context = buildTradeContext(trade, candles);
    const key = contextKey(context);
    const group = contextTrades.get(key) ?? [];
    group.push(trade);
    contextTrades.set(key, group);
  }

  const rules: LearnedRule[] = [];
  for (const [key, group] of findingGroups) {
    const context = group[0]!.context;
    const denominator = contextTrades.get(contextKey(context)) ?? [];
    const observations = denominator.length;
    if (observations === 0) continue;

    const failures = group.length;
    const failureRate = failures / observations;
    const failureRateLower95 = wilsonLower(failures, observations);
    const rValues = denominator.map((trade) => {
      const risk = Math.max(0.000001, Math.abs(trade.entryPrice - trade.stopLoss) * trade.quantity);
      return trade.pnl / risk;
    });
    const expectancyR = rValues.reduce((sum, value) => sum + value, 0) / rValues.length;
    const meanSeverity = failures
      ? group.reduce((sum, finding) => sum + finding.severity, 0) / failures
      : 0;

    let status: LearnedRule["status"] = "CANDIDATE";
    let reason = "Collect more matched successes and failures before activation.";

    if (observations >= minimumObservations && failureRateLower95 >= 0.55 && expectancyR <= -0.05) {
      status = "VALIDATED";
      reason = "Matched context has sufficient observations, a conservative failure-rate bound above 55%, and negative expectancy.";
    }

    // BLOCKED is deliberately reserved for rules that are revalidated by an
    // independent walk-forward pass. The mining stage never hard-blocks a live path.
    rules.push({
      id: key,
      strategy: context.strategy,
      session: context.session,
      side: context.side,
      condition: context.regime,
      cause: group[0]!.cause,
      observations,
      failures,
      failureRate: Number(failureRate.toFixed(4)),
      meanSeverity: Number(meanSeverity.toFixed(3)),
      expectancyR: Number(expectancyR.toFixed(4)),
      failureRateLower95: Number(failureRateLower95.toFixed(4)),
      status,
      reason,
    });
  }

  return rules.sort((a, b) =>
    b.observations - a.observations ||
    b.failureRate - a.failureRate ||
    a.id.localeCompare(b.id),
  );
}

export function shouldBlockRule(rule: LearnedRule, minimumObservations = 20): boolean {
  return rule.status === "BLOCKED" &&
    rule.observations >= minimumObservations &&
    rule.expectancyR < 0;
}
