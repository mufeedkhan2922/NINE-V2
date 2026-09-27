import { createHash } from "node:crypto";
import type { AtlasContext, MarketSnapshot, PaperAccount, SentinelDecision, TradingSetup, TradeDirection } from "./types";

export type XAUSetupLifecycle = "WATCH" | "FORMING" | "PAPER_READY" | "BLOCKED" | "EXPIRED" | "PAPER_ACTIVE" | "PAPER_CLOSED";
export type XAUEventType = "SESSION_OPEN" | "LIQUIDITY_SWEEP" | "MSS" | "CHOCH" | "FVG" | "ORDER_BLOCK" | "SETUP_FORMED" | "SETUP_VALIDATED" | "SETUP_BLOCKED" | "SETUP_INVALIDATED";

export interface XAUEvent {
  id: string;
  type: XAUEventType;
  timestamp: number;
  price?: number;
  direction: TradeDirection;
  title: string;
  detail: string;
  source: "CHARTIST" | "NINE" | "ATLAS" | "SENTINEL" | "MARKET";
  importance: "LOW" | "MEDIUM" | "HIGH";
}

export interface XAUDebateMessage {
  agent: "CHARTIST" | "ATLAS" | "SENTINEL" | "NINE";
  stance: "SUPPORT" | "CHALLENGE" | "SYNTHESIS" | "BLOCK";
  message: string;
  evidence: string[];
}

export interface XAUSetupTracking {
  setupId: string;
  lifecycle: XAUSetupLifecycle;
  firstSeenAt: number;
  lastSeenAt: number;
  direction: TradeDirection;
  entry: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  ageSeconds: number;
  matchedPaperPositionId: string | null;
  paperPositionState: "NONE" | "OPEN" | "CLOSED";
  statusReason: string;
}

export interface XAUDecisionEngine {
  lifecycle: XAUSetupLifecycle;
  session: "ASIA" | "LONDON" | "NEW_YORK" | "OFF_SESSION";
  sessionPhase: string;
  sessionRule: string;
  events: XAUEvent[];
  debate: XAUDebateMessage[];
  evidenceChain: Array<{
    id: string;
    source: "MARKET" | "CHARTIST" | "ATLAS" | "SENTINEL" | "NINE" | "PAPER";
    claim: string;
    evidence: string;
    timestamp: number;
    strength: "LOW" | "MEDIUM" | "HIGH";
  }>;
  invalidation: { active: boolean; reason: string; price: number | null; direction: TradeDirection };
  tracking: XAUSetupTracking;
  generatedAt: number;
}

function sessionFor(timestamp: number): XAUDecisionEngine["session"] {
  const hour = new Date(timestamp).getUTCHours();
  if (hour < 7) return "ASIA";
  if (hour < 12) return "LONDON";
  if (hour < 21) return "NEW_YORK";
  return "OFF_SESSION";
}

function sessionRule(session: XAUDecisionEngine["session"]): string {
  if (session === "ASIA") return "Map range and liquidity; avoid forcing directional confirmation.";
  if (session === "LONDON") return "Prioritize Asia high/low sweeps and fresh displacement.";
  if (session === "NEW_YORK") return "Prioritize London liquidity interaction and confirmation around macro volatility.";
  return "Observation mode; wait for the next active XAUUSD session.";
}

function event(type: XAUEventType, timestamp: number, title: string, detail: string, direction: TradeDirection, source: XAUEvent["source"], importance: XAUEvent["importance"], price?: number): XAUEvent {
  const id = createHash("sha256").update(`${type}|${timestamp}|${title}|${price ?? ""}`).digest("hex").slice(0, 12);
  return { id, type, timestamp, title, detail, direction, source, importance, ...(price !== undefined ? { price } : {}) };
}

function setupId(setup: TradingSetup): string {
  return createHash("sha256").update([setup.symbol, setup.direction, setup.entry?.toFixed(2) ?? "NONE", setup.stopLoss?.toFixed(2) ?? "NONE", setup.takeProfit?.toFixed(2) ?? "NONE"].join("|")).digest("hex").slice(0, 16);
}

function buildEvents(market: MarketSnapshot, setup: TradingSetup, session: XAUDecisionEngine["session"]): XAUEvent[] {
  const chartist = setup.smc.chartist;
  const candles = market.timeframes?.["1min"]?.candles ?? market.candles ?? [];
  const latest = candles.at(-1);
  const events: XAUEvent[] = [];

  if (latest) events.push(event("SESSION_OPEN", latest.time, `${session} SESSION`, `XAUUSD session context: ${session}.`, "NONE", "MARKET", "LOW", latest.close));
  if (setup.smc.liquiditySweep) events.push(event("LIQUIDITY_SWEEP", latest?.time ?? setup.generatedAt, `${setup.smc.sweepDirection} LIQUIDITY SWEEP`, `Chartist detected a ${setup.smc.sweepDirection} liquidity sweep.`, setup.smc.sweepDirection, "CHARTIST", "HIGH", setup.smc.sweepDirection === "LONG" ? chartist?.liquidityLow ?? undefined : chartist?.liquidityHigh ?? undefined));
  if (setup.smc.marketStructureShift) events.push(event("MSS", latest?.time ?? setup.generatedAt, `${setup.smc.structureDirection} MSS`, `Market structure shifted toward ${setup.smc.structureDirection}.`, setup.smc.structureDirection, "CHARTIST", "HIGH"));
  if (chartist?.chochDirection && chartist.chochDirection !== "NONE") events.push(event("CHOCH", latest?.time ?? setup.generatedAt, `${chartist.chochDirection} CHoCH`, `Chartist detected a change of character toward ${chartist.chochDirection}.`, chartist.chochDirection, "CHARTIST", "HIGH"));
  for (const zone of (chartist?.fairValueGaps ?? []).slice(-3)) events.push(event("FVG", zone.createdAt, `${zone.direction} FVG`, `Fair value gap ${zone.low.toFixed(2)}–${zone.high.toFixed(2)}.`, zone.direction, "CHARTIST", "MEDIUM", (zone.high + zone.low) / 2));
  for (const zone of (chartist?.orderBlocks ?? []).slice(-3)) events.push(event("ORDER_BLOCK", zone.createdAt, `${zone.direction} ORDER BLOCK`, `Order block ${zone.low.toFixed(2)}–${zone.high.toFixed(2)}.`, zone.direction, "CHARTIST", "MEDIUM", (zone.high + zone.low) / 2));
  if (setup.direction !== "NONE") {
    const type = setup.validation.valid ? "SETUP_VALIDATED" : setup.validation.blockers.length ? "SETUP_BLOCKED" : "SETUP_FORMED";
    events.push(event(type, setup.generatedAt, type === "SETUP_VALIDATED" ? "SETUP VALIDATED" : type === "SETUP_BLOCKED" ? "SETUP BLOCKED" : "SETUP FORMED", setup.validation.valid ? "Validation checks passed for the current paper setup." : setup.validation.blockers.join(" · ") || "Directional setup is forming.", setup.direction, "NINE", setup.validation.valid ? "HIGH" : "MEDIUM", setup.entry ?? undefined));
  }
  return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 14);
}

function buildDebate(setup: TradingSetup, atlas: AtlasContext | undefined, sentinel: SentinelDecision): XAUDebateMessage[] {
  const macro = atlas?.macroBias ?? "NEUTRAL";
  const macroSupports = setup.direction === "LONG" ? macro === "BULLISH" : setup.direction === "SHORT" ? macro === "BEARISH" : false;
  return [
    {
      agent: "CHARTIST",
      stance: setup.direction === "NONE" ? "CHALLENGE" : "SUPPORT",
      message: setup.direction === "NONE" ? "I do not have enough directional structure to promote a setup." : `I support ${setup.direction} because structure and SMC evidence align.`,
      evidence: [setup.technical.structure, `SMC ${setup.smc.structureDirection}`, setup.smc.liquiditySweep ? `${setup.smc.sweepDirection} sweep` : "No liquidity sweep", setup.smc.premiumDiscount],
    },
    {
      agent: "ATLAS",
      stance: macroSupports ? "SUPPORT" : "CHALLENGE",
      message: atlas?.sourceStatus === "UNAVAILABLE" ? "Macro evidence is unavailable, so I cannot confirm the directional thesis." : macroSupports ? `Macro bias ${macro} supports the ${setup.direction} thesis.` : `Macro bias ${macro} does not independently confirm the ${setup.direction} thesis.`,
      evidence: atlas?.headlines.slice(0, 2).map((h) => `${h.sentiment}: ${h.title}`) ?? [],
    },
    {
      agent: "SENTINEL",
      stance: sentinel.approved ? "SUPPORT" : "BLOCK",
      message: sentinel.approved ? "Risk and market gates are currently satisfied." : sentinel.reason,
      evidence: sentinel.checks.slice(0, 4),
    },
    {
      agent: "NINE",
      stance: sentinel.approved && setup.validation.valid ? "SYNTHESIS" : "BLOCK",
      message: sentinel.approved && setup.validation.valid ? `Synthesis: ${setup.direction} remains a paper-ready hypothesis, subject to live invalidation.` : "Synthesis: keep the setup in observation/block state until the missing gates are resolved.",
      evidence: [`Confidence ${setup.confidence}%`, `Validation ${setup.validation.score}/100`, ...setup.validation.blockers.slice(0, 2)],
    },
  ];
}

function buildEvidence(market: MarketSnapshot, setup: TradingSetup, atlas: AtlasContext | undefined, sentinel: SentinelDecision, events: XAUEvent[], tracking: XAUSetupTracking) {
  const now = Date.now();
  return [
    { id: "market-price", source: "MARKET" as const, claim: "Current XAUUSD price is validated.", evidence: `Price ${market.price.toFixed(2)} from ${market.priceSource ?? "validated snapshot"}; candle age ${market.marketState?.latestCandleAgeSeconds?.toFixed(1) ?? "—"}s.`, timestamp: market.timestamp, strength: market.tradingAllowed ? "HIGH" as const : "MEDIUM" as const },
    { id: "chartist-structure", source: "CHARTIST" as const, claim: "Structure evidence supports the current setup state.", evidence: `${setup.technical.structure}; MSS ${setup.smc.marketStructureShift ? "confirmed" : "not confirmed"}; liquidity sweep ${setup.smc.liquiditySweep ? setup.smc.sweepDirection : "none"}.`, timestamp: setup.generatedAt, strength: setup.smc.marketStructureShift ? "HIGH" as const : "MEDIUM" as const },
    { id: "atlas-context", source: "ATLAS" as const, claim: "Macro context was considered independently.", evidence: atlas?.summary ?? "Macro context unavailable.", timestamp: atlas?.generatedAt ?? now, strength: atlas?.sourceStatus === "LIVE" ? "MEDIUM" as const : "LOW" as const },
    { id: "sentinel-gate", source: "SENTINEL" as const, claim: "Execution authority remains isolated to Sentinel.", evidence: sentinel.approved ? "Sentinel approved paper execution." : `Sentinel blocked execution: ${sentinel.reason}`, timestamp: now, strength: "HIGH" as const },
    { id: "paper-tracking", source: "PAPER" as const, claim: "The current setup is tracked against the paper account.", evidence: tracking.matchedPaperPositionId ? `Matched paper position ${tracking.matchedPaperPositionId}.` : "No matching paper position.", timestamp: tracking.lastSeenAt, strength: tracking.matchedPaperPositionId ? "HIGH" as const : "MEDIUM" as const },
    ...events.slice(0, 3).map((item) => ({ id: `event-${item.id}`, source: item.source, claim: item.title, evidence: item.detail, timestamp: item.timestamp, strength: item.importance === "HIGH" ? "HIGH" as const : "MEDIUM" as const })),
  ];
}

export function buildXAUDecisionEngine(market: MarketSnapshot, setup: TradingSetup, atlas: AtlasContext | undefined, sentinel: SentinelDecision, account: PaperAccount, tracking: XAUSetupTracking): XAUDecisionEngine {
  const session = sessionFor(market.timestamp);
  const events = buildEvents(market, setup, session);
  const invalidated = setup.direction !== "NONE" && setup.stopLoss !== null && ((setup.direction === "LONG" && market.price <= setup.stopLoss) || (setup.direction === "SHORT" && market.price >= setup.stopLoss));
  if (invalidated) events.unshift(event("SETUP_INVALIDATED", market.timestamp, "SETUP INVALIDATED", "Price crossed the setup invalidation level.", setup.direction, "NINE", "HIGH", setup.stopLoss ?? undefined));

  const matchedPosition = tracking.matchedPaperPositionId
    ? account.positions.find((position) => position.id === tracking.matchedPaperPositionId)
    : undefined;
  const lifecycle: XAUSetupLifecycle = invalidated
    ? "EXPIRED"
    : matchedPosition?.status === "OPEN"
      ? "PAPER_ACTIVE"
      : tracking.paperPositionState === "CLOSED"
        ? "PAPER_CLOSED"
        : setup.direction === "NONE"
          ? "WATCH"
          : !setup.validation.valid
            ? "FORMING"
            : !sentinel.approved
              ? "BLOCKED"
              : "PAPER_READY";
  const nextTracking: XAUSetupTracking = {
    ...tracking,
    lifecycle,
    paperPositionState: matchedPosition?.status === "OPEN" ? "OPEN" : tracking.paperPositionState,
    ageSeconds: Math.max(0, Math.round((Date.now() - tracking.firstSeenAt) / 1000)),
    statusReason: invalidated ? "Price crossed the setup invalidation level." : tracking.matchedPaperPositionId ? "A paper position matches the current setup geometry." : lifecycle === "PAPER_READY" ? "Setup passed validation and Sentinel approval." : lifecycle === "FORMING" ? "Directional structure exists but validation is incomplete." : lifecycle === "BLOCKED" ? sentinel.reason : "No validated directional setup.",
  };
  void account;
  return {
    lifecycle,
    session,
    sessionPhase: lifecycle === "PAPER_ACTIVE" ? "MANAGING" : lifecycle === "PAPER_CLOSED" ? "RECORDED" : lifecycle === "PAPER_READY" ? "CONFIRMATION" : setup.direction === "NONE" ? "RANGE MAPPING" : "VALIDATION",
    sessionRule: sessionRule(session),
    events,
    debate: buildDebate(setup, atlas, sentinel),
    evidenceChain: buildEvidence(market, setup, atlas, sentinel, events, nextTracking),
    invalidation: { active: invalidated, reason: invalidated ? "Stop-loss invalidation level was crossed." : setup.direction === "NONE" ? "No directional thesis is active." : setup.direction === "LONG" ? `Long thesis invalidates at ${setup.stopLoss?.toFixed(2) ?? "—"}.` : `Short thesis invalidates at ${setup.stopLoss?.toFixed(2) ?? "—"}.`, price: setup.stopLoss, direction: setup.direction },
    tracking: nextTracking,
    generatedAt: Date.now(),
  };
}

export function createSetupTracking(setup: TradingSetup, account: PaperAccount, existing?: XAUSetupTracking): XAUSetupTracking {
  const id = setupId(setup);
  const now = Date.now();
  const matched = account.positions.find((position) => position.status === "OPEN" && position.symbol === setup.symbol && ((setup.direction === "LONG" && position.side === "BUY") || (setup.direction === "SHORT" && position.side === "SELL")) && Math.abs(position.entryPrice - (setup.entry ?? position.entryPrice)) <= Math.max(0.5, Math.abs(setup.entry ?? position.entryPrice) * 0.0008));
  if (existing?.setupId === id) return {
    ...existing,
    lastSeenAt: now,
    matchedPaperPositionId: matched?.id ?? existing.matchedPaperPositionId,
    paperPositionState: matched ? "OPEN" : existing.paperPositionState,
  };
  return { setupId: id, lifecycle: setup.direction === "NONE" ? "WATCH" : setup.validation.valid ? "PAPER_READY" : "FORMING", firstSeenAt: now, lastSeenAt: now, direction: setup.direction, entry: setup.entry, stopLoss: setup.stopLoss, takeProfit: setup.takeProfit, ageSeconds: 0, matchedPaperPositionId: matched?.id ?? null, paperPositionState: matched ? "OPEN" : "NONE", statusReason: "Setup tracking initialized." };
}
