import type {
  AtlasContext,
  DecisionExplanation,
  DecisionExplanationItem,
  NINEOrchestration,
} from "./types";

function item(code: string, severity: DecisionExplanationItem["severity"], title: string, detail: string, source: DecisionExplanationItem["source"]): DecisionExplanationItem {
  return { code, severity, title, detail, source };
}

export function buildDecisionExplanation(orchestration: NINEOrchestration): DecisionExplanation {
  const setup = orchestration.setup;
  const feed = orchestration.marketHealth?.feed;
  const blockers: DecisionExplanationItem[] = [];
  const warnings: DecisionExplanationItem[] = [];
  const evidence: DecisionExplanationItem[] = [];

  for (const reason of orchestration.sentinel.blockers ?? []) {
    blockers.push(item("SENTINEL_BLOCK", "BLOCK", "Sentinel execution gate", reason.replace(/^BLOCK:\s*/i, ""), "SENTINEL"));
  }
  for (const blocker of setup.validation.blockers) {
    if (!blockers.some((b) => b.detail === blocker)) blockers.push(item("ENGINE_VALIDATION", "BLOCK", "Trading engine validation", blocker, "NINE"));
  }
  for (const blocker of orchestration.marketHealth?.blockers ?? []) {
    if (!blockers.some((b) => b.detail === blocker)) blockers.push(item("MARKET_HEALTH", "BLOCK", "Market health", blocker, "MARKET"));
  }
  for (const warning of setup.validation.warnings) warnings.push(item("SETUP_WARNING", "WARNING", "Setup warning", warning, "CHARTIST"));

  const crossValid = setup.validation.checks.crossTimeframe;
  if (crossValid) evidence.push(item("CROSS_TF_PASS", "INFO", "Cross-timeframe validation", "Required cross-timeframe validation passed.", "CHARTIST"));
  else blockers.push(item("CROSS_TF_BLOCK", "BLOCK", "Cross-timeframe validation", "Cross-timeframe validation did not pass.", "CHARTIST"));

  const atlas: AtlasContext | undefined = orchestration.atlas;
  const keywords = atlas?.headlines.filter((h) => {
    const t = h.title.toLowerCase();
    if (setup.symbol === "XAUUSD") return /gold|usd|dollar|fed|fomc|inflation|yield|treasury|rate|geopolit|war|oil/.test(t);
    if (setup.symbol === "BANKNIFTY") return /bank|rbi|rate|credit|financial|nifty|india/.test(t);
    return /india|nifty|rbi|economy|inflation|rate|market/.test(t);
  }).slice(0, 5).map((h) => h.title) ?? [];

  const relevance: DecisionExplanation["atlas"]["relevance"] =
    atlas?.sourceStatus === "UNAVAILABLE" ? "UNAVAILABLE" :
    keywords.length >= 2 ? "HIGH" : keywords.length === 1 ? "MEDIUM" : "LOW";

  const impact = atlas?.sourceStatus === "UNAVAILABLE"
    ? "Atlas has no live source data; no news-based directional claim is made."
    : keywords.length
      ? `Atlas found ${keywords.length} instrument-relevant headline(s); this is context and does not override technical or Sentinel gates.`
      : "No instrument-specific headline relevance was detected in the available Atlas feed.";

  if (atlas?.sourceStatus === "UNAVAILABLE") warnings.push(item("ATLAS_UNAVAILABLE", "WARNING", "Atlas unavailable", "News and macro context is unavailable; NINE does not fabricate an Atlas signal.", "ATLAS"));
  else evidence.push(item("ATLAS_CONTEXT", "INFO", "Atlas context", impact, "ATLAS"));

  const risk = orchestration.sentinel.risk;
  if (risk) {
    const riskDetail = `Risk ${risk.riskPercent.toFixed(2)}% / max ${risk.maxRiskPercent.toFixed(2)}%; projected loss ${risk.projectedLoss.toFixed(2)}; exposure ${risk.exposurePercent.toFixed(2)}%; daily loss ${risk.dailyLossPercent.toFixed(2)}%; drawdown ${risk.drawdownPercent.toFixed(2)}%.`;
    if (orchestration.sentinel.approved) evidence.push(item("RISK_PASS", "INFO", "Risk controls passed", riskDetail, "SENTINEL"));
    else blockers.push(item("RISK_BLOCK", "BLOCK", "Risk controls", riskDetail, "SENTINEL"));
  }

  const checks = orchestration.sentinel.checks ?? [];
  const checksPassed = checks.filter((c) => !c.startsWith("BLOCK:")).length;
  const decision: DecisionExplanation["decision"] =
    orchestration.sentinel.approved && setup.direction !== "NONE" ? "PAPER_READY" :
    setup.direction === "NONE" ? "WATCHING" : "BLOCKED";

  const headline = decision === "PAPER_READY"
    ? `NINE has a ${setup.direction} paper-ready setup after Sentinel approval.`
    : decision === "WATCHING"
      ? "NINE is watching because no executable direction is confirmed."
      : `NINE is blocked: ${orchestration.sentinel.reason}`;

  const marketState = orchestration.marketAssessment?.marketState ?? (feed?.tradingAllowed ? "OPEN" as const : "UNKNOWN" as const);
  const dataState = orchestration.marketAssessment?.dataState ?? (setup.validation.checks.marketData ? "LIVE" as const : "UNKNOWN" as const);

  return {
    decision,
    headline,
    confidence: Math.max(0, Math.min(100, setup.confidence)),
    blockers,
    warnings,
    evidence,
    market: {
      state: marketState,
      dataState,
      tradingPermission: orchestration.marketAssessment?.tradingPermission ?? (feed?.tradingAllowed ? "ALLOWED" : "BLOCKED"),
      reasons: orchestration.marketAssessment?.reasons ?? orchestration.marketHealth?.blockers ?? [],
      warnings: orchestration.marketAssessment?.warnings ?? setup.validation.warnings,
    },
    crossTimeframe: {
      score: crossValid ? 100 : 0,
      valid: crossValid,
      issues: crossValid ? [] : ["Cross-timeframe validation did not pass."],
      warnings: [],
    },
    atlas: {
      status: atlas?.sourceStatus ?? "UNAVAILABLE",
      bias: atlas?.macroBias ?? "NEUTRAL",
      relevance,
      impact,
      supportingHeadlines: keywords,
      events: atlas?.macroEvents?.length ?? 0,
      errors: atlas?.errors ?? [],
    },
    sentinel: {
      approved: orchestration.sentinel.approved,
      reason: orchestration.sentinel.reason,
      blockers: orchestration.sentinel.blockers ?? [],
      checksPassed,
      checksTotal: checks.length,
    },
    paper: {
      allowed: decision === "PAPER_READY",
      reason: decision === "PAPER_READY"
        ? "Paper execution is permitted by the final NINE/Sentinel gate."
        : "Paper execution is blocked until all required gates pass.",
      mode: "PAPER",
    },
  };
}
