import { marketFeedStatus, runtimeSafety } from "./runtime";
import { reconcilePaperState, type PaperReconciliation } from "./paperReconciliation";
import { getPaperAccount } from "./paperTrading";
import type { MarketSnapshot } from "./types";

export type PaperValidationStatus = "READY" | "DEGRADED" | "BLOCKED";

export interface PaperValidationCheck {
  id: string;
  status: "PASS" | "WARN" | "BLOCK";
  detail: string;
}

export interface PaperValidationReport {
  status: PaperValidationStatus;
  checkedAt: number;
  liveTradingLocked: boolean;
  paperTradingEnabled: boolean;
  checks: PaperValidationCheck[];
  reconciliation: PaperReconciliation;
  account: ReturnType<typeof getPaperAccount>;
  methodology: {
    executionMode: "PAPER_ONLY";
    liveBrokerCalls: false;
    performanceClaim: "NONE";
  };
}

function check(
  id: string,
  status: PaperValidationCheck["status"],
  detail: string,
): PaperValidationCheck {
  return { id, status, detail };
}

export function runPaperValidation(
  market: MarketSnapshot | null = null,
): PaperValidationReport {
  const checkedAt = Date.now();
  const safety = runtimeSafety();
  const reconciliation = reconcilePaperState();
  const account = getPaperAccount();

  const checks: PaperValidationCheck[] = [
    check(
      "LIVE_LOCK",
      safety.liveTradingEnabled ? "BLOCK" : "PASS",
      safety.liveTradingEnabled
        ? "Live trading is enabled; final paper validation is blocked."
        : "Live trading is hard-locked.",
    ),
    check(
      "PAPER_MODE",
      safety.paperTradingEnabled ? "PASS" : "BLOCK",
      safety.paperTradingEnabled
        ? "Paper trading is enabled."
        : "Paper trading is unavailable.",
    ),
    check(
      "RECONCILIATION",
      reconciliation.healthy
        ? "PASS"
        : reconciliation.issues.some((item) => item.severity === "ERROR")
          ? "BLOCK"
          : "WARN",
      reconciliation.healthy
        ? `Paper state reconciled with score ${reconciliation.score}/100.`
        : `Paper reconciliation reported ${reconciliation.issues.length} issue(s), score ${reconciliation.score}/100.`,
    ),
    check(
      "ACCOUNT_GEOMETRY",
      Number.isFinite(account.balance) &&
        Number.isFinite(account.equity) &&
        account.balance >= 0 &&
        account.equity >= 0
        ? "PASS"
        : "BLOCK",
      Number.isFinite(account.balance) &&
        Number.isFinite(account.equity) &&
        account.balance >= 0 &&
        account.equity >= 0
        ? "Paper account balances are finite and non-negative."
        : "Paper account balance/equity validation failed.",
    ),
  ];

  if (market) {
    const feed = marketFeedStatus(market);
    checks.push(
      check(
        "MARKET_FEED",
        feed.tradingAllowed ? "PASS" : "WARN",
        feed.reason,
      ),
    );
  } else {
    checks.push(
      check(
        "MARKET_FEED",
        "WARN",
        "No live market snapshot supplied; paper validation remains execution-safety focused.",
      ),
    );
  }

  const hasBlock = checks.some((item) => item.status === "BLOCK");
  const hasWarn = checks.some((item) => item.status === "WARN");

  return {
    status: hasBlock
      ? "BLOCKED"
      : hasWarn
        ? "DEGRADED"
        : "READY",
    checkedAt,
    liveTradingLocked: !safety.liveTradingEnabled,
    paperTradingEnabled: safety.paperTradingEnabled,
    checks,
    reconciliation,
    account,
    methodology: {
      executionMode: "PAPER_ONLY",
      liveBrokerCalls: false,
      performanceClaim: "NONE",
    },
  };
}
