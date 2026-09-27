import type { AgentId, AtlasContext, MarketSnapshot, SentinelDecision, TradingSetup } from "./types";

export type NINEAgentId = AgentId | "QUANT" | "RESEARCHER" | "WATCHER";
export interface AgentMessage { agent: NINEAgentId; role: string; status: "ONLINE" | "DEGRADED" | "BLOCKED"; summary: string; evidence: string[]; confidence: number; generatedAt: number; }
export interface AgentOrchestration { messages: AgentMessage[]; selectedAgents: NINEAgentId[]; executionAuthority: "SENTINEL_ONLY"; decision: "PAPER_READY" | "WATCHING" | "BLOCKED"; blockers: string[]; generatedAt: number; }

function base(agent: NINEAgentId, role: string, summary: string, evidence: string[], confidence: number, status: AgentMessage["status"] = "ONLINE"): AgentMessage {
  return { agent, role, status, summary, evidence, confidence: Math.max(0, Math.min(99, Math.round(confidence))), generatedAt: Date.now() };
}

export function buildAgentOrchestration(market: MarketSnapshot, setup: TradingSetup, atlas: AtlasContext | undefined, sentinel: SentinelDecision): AgentOrchestration {
  void market;
  const messages: AgentMessage[] = [
    base("CHARTIST", "Technical / SMC analyst", `${setup.marketBias} technical context with ${setup.confidence}% setup confidence.`, [setup.technical.structure, `${setup.smc.premiumDiscount} pricing zone`, setup.smc.marketStructureShift ? `${setup.smc.structureDirection} MSS detected.` : "No confirmed MSS."], setup.confidence),
    base("ATLAS", "Macro / news analyst", atlas?.summary ?? "Macro feed unavailable.", atlas?.headlines.slice(0, 3).map((h) => `${h.sentiment}: ${h.title}`) ?? [], atlas?.sourceStatus === "LIVE" ? 75 : 40, atlas?.sourceStatus === "UNAVAILABLE" ? "DEGRADED" : "ONLINE"),
    base("SENTINEL", "Independent risk authorization", sentinel.reason, sentinel.checks, sentinel.approved ? 99 : 20, sentinel.approved ? "ONLINE" : "BLOCKED"),
  ];
  const blockers = sentinel.approved ? [] : [sentinel.reason];
  const decision = sentinel.approved && setup.validation.valid ? "PAPER_READY" : setup.direction === "NONE" ? "WATCHING" : "BLOCKED";
  return { messages, selectedAgents: ["CHARTIST", "ATLAS", "SENTINEL"], executionAuthority: "SENTINEL_ONLY", decision, blockers, generatedAt: Date.now() };
}

export function routeVoiceIntent(transcript: string): { intent: "ANALYZE_GOLD" | "STATUS" | "RESEARCH" | "RISK" | "UNKNOWN"; requiresSentinel: boolean } {
  const text = transcript.trim().toLowerCase();
  if (!text) return { intent: "UNKNOWN", requiresSentinel: false };
  if (/(analy[sz]e|check|look at).*(gold|xau|xauusd)/i.test(text) || /gold.*(analy[sz]e|setup|signal)/i.test(text)) return { intent: "ANALYZE_GOLD", requiresSentinel: false };
  if (/(status|system|health|paper account)/i.test(text)) return { intent: "STATUS", requiresSentinel: false };
  if (/(research|backtest|historical|walk.?forward|monte.?carlo)/i.test(text)) return { intent: "RESEARCH", requiresSentinel: false };
  if (/(risk|sentinel|safe|permission|can i trade)/i.test(text)) return { intent: "RISK", requiresSentinel: true };
  return { intent: "UNKNOWN", requiresSentinel: false };
}

export function buildSpokenResponse(intent: ReturnType<typeof routeVoiceIntent>["intent"], orchestration: AgentOrchestration): string {
  const sentinel = orchestration.messages.find((m) => m.agent === "SENTINEL");
  switch (intent) {
    case "ANALYZE_GOLD": return orchestration.decision === "PAPER_READY" ? "Gold has a validated paper setup. Sentinel has approved the current paper execution gate." : orchestration.decision === "WATCHING" ? "Gold is being watched. There is no validated setup right now." : `Gold is blocked. ${sentinel?.summary ?? "Sentinel has not approved the setup."}`;
    case "RISK": return sentinel?.summary ?? "Sentinel risk state is unavailable.";
    case "STATUS": return `NINE is ${orchestration.decision === "PAPER_READY" ? "paper ready" : orchestration.decision.toLowerCase()}. Sentinel remains the execution authority.`;
    case "RESEARCH": return "Research is available through the historical intelligence console. Research results do not authorize execution.";
    default: return "I understood the request, but I do not have a validated NINE command for it yet.";
  }
}