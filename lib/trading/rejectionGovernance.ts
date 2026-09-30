import { createHash } from "node:crypto";
import { db, transaction } from "./db";
import { getRejectionQualityDecision, type RejectionQualityDecision } from "./counterfactualReplay";

export type RejectionGovernanceStatus =
  | "PROTECTIVE"
  | "SHADOW_REVIEW"
  | "NEUTRAL";

export interface RejectionGovernanceDecision {
  status: RejectionGovernanceStatus;
  executable: false;
  observations: number;
  winRateLower95: number;
  expectancyR: number;
  reason: string;
}

export interface RejectionGovernanceInput {
  symbol: string;
  blocker: string;
  session: string;
  regime: string;
  side: "LONG" | "SHORT";
}

function normalize(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "_");
}

function persist(
  input: RejectionGovernanceInput,
  quality: RejectionQualityDecision,
): void {
  const blocker = normalize(input.blocker);
  const id = createHash("sha256")
    .update([
      "rejection-governance",
      input.symbol,
      blocker,
      input.session,
      input.regime,
      input.side,
    ].join("|"))
    .digest("hex")
    .slice(0, 24);

  const governanceStatus =
    quality.status === "VALIDATED"
      ? "PROTECTIVE"
      : quality.status === "COSTLY"
        ? "SHADOW_REVIEW"
        : "NEUTRAL";

  transaction(() => {
    db.prepare(
      `INSERT INTO rejection_governance_memory
        (id,symbol,blocker,session,regime,side,observations,win_rate_lower_95,expectancy_r,quality_status,governance_status,reason,source,created_at,reviewed_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(symbol,blocker,session,regime,side)
       DO UPDATE SET
         observations=excluded.observations,
         win_rate_lower_95=excluded.win_rate_lower_95,
         expectancy_r=excluded.expectancy_r,
         quality_status=excluded.quality_status,
         governance_status=excluded.governance_status,
         reason=excluded.reason,
         source=excluded.source,
         created_at=excluded.created_at`,
    ).run(
      id,
      input.symbol,
      blocker,
      input.session,
      input.regime,
      input.side,
      quality.observations,
      quality.winRateLower95,
      quality.expectancyR,
      quality.status,
      governanceStatus,
      quality.reason,
      "REJECTION_GOVERNANCE_SHADOW",
      Date.now(),
      null,
    );
  });
}

export function auditRejectionGovernance(
  input: RejectionGovernanceInput,
): RejectionGovernanceDecision {
  const quality = getRejectionQualityDecision(
    input.symbol,
    input.blocker,
    input.session,
    input.regime,
    input.side,
  );

  persist(input, quality);

  if (quality.status === "VALIDATED") {
    return {
      status: "PROTECTIVE",
      executable: false,
      observations: quality.observations,
      winRateLower95: quality.winRateLower95,
      expectancyR: quality.expectancyR,
      reason: "Replay evidence supports the existing rejection. No executable change is permitted.",
    };
  }

  if (quality.status === "COSTLY") {
    return {
      status: "SHADOW_REVIEW",
      executable: false,
      observations: quality.observations,
      winRateLower95: quality.winRateLower95,
      expectancyR: quality.expectancyR,
      reason: "Replay evidence suggests this blocker may reject profitable setups. Create a shadow correction candidate only; never weaken the live blocker automatically.",
    };
  }

  return {
    status: "NEUTRAL",
    executable: false,
    observations: quality.observations,
    winRateLower95: quality.winRateLower95,
    expectancyR: quality.expectancyR,
    reason: "Insufficient rejection-quality evidence for governance review.",
  };
}

export function getRejectionGovernanceDecision(
  input: RejectionGovernanceInput,
): RejectionGovernanceDecision {
  const row = db.prepare(
    `SELECT governance_status AS governanceStatus,observations,win_rate_lower_95 AS winRateLower95,expectancy_r AS expectancyR,reason
     FROM rejection_governance_memory
     WHERE symbol=? AND blocker=? AND session=? AND regime=? AND side=?
     LIMIT 1`,
  ).get(
    input.symbol,
    normalize(input.blocker),
    input.session,
    input.regime,
    input.side,
  ) as any;

  if (!row) {
    return auditRejectionGovernance(input);
  }

  return {
    status: row.governanceStatus as RejectionGovernanceStatus,
    executable: false,
    observations: Number(row.observations),
    winRateLower95: Number(row.winRateLower95),
    expectancyR: Number(row.expectancyR),
    reason: String(row.reason),
  };
}

export function rejectionGovernanceSummary(symbol = "XAUUSD") {
  return db.prepare(
    `SELECT blocker,session,regime,side,observations,
            ROUND(win_rate_lower_95,4) AS winRateLower95,
            ROUND(expectancy_r,4) AS expectancyR,
            quality_status AS qualityStatus,
            governance_status AS governanceStatus,
            created_at AS createdAt
     FROM rejection_governance_memory
     WHERE symbol=?
     ORDER BY observations DESC,created_at DESC`,
  ).all(symbol) as Array<Record<string, unknown>>;
}
