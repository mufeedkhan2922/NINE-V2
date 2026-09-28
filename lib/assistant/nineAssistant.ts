import { randomUUID } from "node:crypto";
import { db } from "../trading/db";
import { getStoreSnapshot } from "../trading/store";
import { runtimeDiagnostics } from "../trading/runtime";
import { getLiveMarketSnapshot } from "../trading/market";
import { getPaperAccount } from "../trading/paperTrading";
import { orchestrateNINE } from "../trading/orchestrator";
import { createSetupTracking } from "../trading/xauDecisionEngine";
import { buildV5Intelligence } from "../trading/v5Intelligence";
import { getKronosForecast } from "../trading/kronosForecast";
import { generateGeminiReply, geminiConfigured, sanitizeGeminiReply } from "./geminiProvider";
import { executePaperSetup, closePaperPosition } from "../trading/paperTrading";
import {
  claimPendingAssistantAction,
  createPendingAssistantAction,
  getLatestPendingAssistantAction,
  resolvePendingAssistantAction,
} from "./pendingActions";

export type AssistantIntent =
  | "GENERAL_CHAT"
  | "SYSTEM_STATUS"
  | "TRADING_STATUS"
  | "PAPER_PERFORMANCE"
  | "OPEN_POSITIONS"
  | "RISK_STATUS"
  | "HELP"
  | "TRADE_ACTION";

export type AssistantActionStatus = "NONE" | "CONFIRM_REQUIRED" | "BLOCKED";

type AssistantActionResult = {
  ok: boolean;
  message: string;
  actionId?: string;
  actionStatus: AssistantActionStatus;
  evidence: Array<{ label: string; value: string }>;
};

export interface AssistantResponse {
  ok: boolean;
  intent: AssistantIntent;
  message: string;
  actionStatus: AssistantActionStatus;
  evidence: Array<{ label: string; value: string }>;
  timestamp: number;
}

const init = globalThis as typeof globalThis & { __nineAssistantReady?: boolean };
if (!init.__nineAssistantReady) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assistant_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      intent TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS assistant_messages_session_idx
      ON assistant_messages(session_id, created_at DESC);
  `);
  init.__nineAssistantReady = true;
}

function fmt(value: unknown, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "—";
}

function pct(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}%` : "—";
}

function classify(input: string): AssistantIntent {
  const q = input.toLowerCase().trim();
  if (!q) return "GENERAL_CHAT";
  if (/\b(help|what can you do|commands|capabilities)\b/.test(q)) return "HELP";
  if (/\b(open position|open trade|positions|position)\b/.test(q)) return "OPEN_POSITIONS";
  if (/\b(performance|p&l|pnl|profit|loss|win rate|winrate|paper performance)\b/.test(q)) return "PAPER_PERFORMANCE";
  if (/\b(risk|drawdown|exposure|risk status|sentinel)\b/.test(q)) return "RISK_STATUS";
  if (/\b(buy|sell|long|short|enter|exit|trade|place order|execute|close all)\b/.test(q)) return "TRADE_ACTION";
  if (/\b(status|health|system|runtime|nine status|are you running)\b/.test(q)) return "SYSTEM_STATUS";
  if (/\b(analyze|analyse|xauusd|gold|market|setup|regime|kronos|signal|chart)\b/.test(q)) return "TRADING_STATUS";
  return "GENERAL_CHAT";
}
function record(sessionId: string, role: "user" | "assistant", content: string, intent?: AssistantIntent) {
  db.prepare(
    `INSERT INTO assistant_messages (id, session_id, role, content, intent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(`AST-${randomUUID()}`, sessionId, role, content, intent ?? null, Date.now());
}

async function executeConfirmedAssistantAction(
  sessionId: string,
  actionId?: string,
): Promise<AssistantActionResult> {
  const pending = claimPendingAssistantAction(sessionId, actionId);
  if (!pending) {
    return {
      ok: false,
      message: "There is no active confirmed action. Ask me to trade again if you want a fresh confirmation.",
      actionStatus: "BLOCKED",
      evidence: [{ label: "EXECUTION", value: "BLOCKED" }],
    };
  }

  try {
    const market = await getLiveMarketSnapshot("XAUUSD");
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);

    if (pending.action === "OPEN_PAPER") {
      if (market.symbol !== "XAUUSD") {
        throw new Error("Assistant execution is restricted to XAUUSD.");
      }
      if (!orchestration.sentinel.approved) {
        throw new Error(`Sentinel blocked the confirmed action: ${orchestration.sentinel.reason}`);
      }
      if (!orchestration.setup.validation.valid) {
        throw new Error("The setup is no longer valid. Confirmation must be repeated on a fresh setup.");
      }

      const result = executePaperSetup(orchestration, market);
      if (!result.ok) {
        resolvePendingAssistantAction(pending.id, "FAILED", result.message);
        return {
          ok: false,
          message: `Confirmed paper trade was rejected: ${result.message}`,
          actionId: pending.id,
          actionStatus: "BLOCKED",
          evidence: [
            { label: "SENTINEL", value: orchestration.sentinel.approved ? "APPROVED" : "BLOCKED" },
            { label: "EXECUTION", value: "PAPER ONLY" },
          ],
        };
      }

      resolvePendingAssistantAction(pending.id, "EXECUTED", result.message);
      return {
        ok: true,
        message: `Confirmed. ${result.message}`,
        actionId: pending.id,
        actionStatus: "NONE",
        evidence: [
          { label: "ACTION", value: "OPEN_PAPER" },
          { label: "SYMBOL", value: "XAUUSD" },
          { label: "ORDER", value: result.orderId ?? "—" },
          { label: "POSITION", value: result.position?.id ?? "—" },
          { label: "SENTINEL", value: "APPROVED" },
          { label: "EXECUTION", value: "PAPER ONLY" },
        ],
      };
    }

    if (!orchestration.sentinel.approved) {
      throw new Error(`Sentinel blocked close-all: ${orchestration.sentinel.reason}`);
    }

    const openPositions = account.positions.filter(
      (position) => position.status === "OPEN" && position.symbol === "XAUUSD",
    );

    if (!openPositions.length) {
      resolvePendingAssistantAction(pending.id, "EXECUTED", "No open XAUUSD paper positions were found.");
      return {
        ok: true,
        message: "Confirmed. There are no open XAUUSD paper positions to close.",
        actionId: pending.id,
        actionStatus: "NONE",
        evidence: [
          { label: "ACTION", value: "CLOSE_ALL" },
          { label: "POSITIONS", value: "0" },
          { label: "SENTINEL", value: "APPROVED" },
          { label: "EXECUTION", value: "PAPER ONLY" },
        ],
      };
    }

    const results = openPositions.map((position) =>
      closePaperPosition(position.id, market.price),
    );
    const closed = results.filter((result) => result.ok).length;
    const failed = results.length - closed;
    const message = `Confirmed. Closed ${closed} of ${results.length} XAUUSD paper position(s).${failed ? ` ${failed} position(s) were not closed.` : ""}`;
    resolvePendingAssistantAction(
      pending.id,
      failed ? "FAILED" : "EXECUTED",
      message,
    );

    return {
      ok: failed === 0,
      message,
      actionId: pending.id,
      actionStatus: failed ? "BLOCKED" : "NONE",
      evidence: [
        { label: "ACTION", value: "CLOSE_ALL" },
        { label: "CLOSED", value: String(closed) },
        { label: "FAILED", value: String(failed) },
        { label: "SENTINEL", value: "APPROVED" },
        { label: "EXECUTION", value: "PAPER ONLY" },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Confirmed action failed.";
    resolvePendingAssistantAction(pending.id, "FAILED", message);
    return {
      ok: false,
      message,
      actionId: pending.id,
      actionStatus: "BLOCKED",
      evidence: [{ label: "EXECUTION", value: "BLOCKED" }],
    };
  }
}

function requestAssistantAction(
  sessionId: string,
  text: string,
): AssistantResponse {
  const normalized = text.toLowerCase();
  const action = /\b(close all|close positions|exit all)\b/.test(normalized)
    ? "CLOSE_ALL"
    : "OPEN_PAPER";
  const pending = createPendingAssistantAction(sessionId, action, text);
  const label = action === "CLOSE_ALL" ? "CLOSE ALL XAUUSD PAPER POSITIONS" : "OPEN XAUUSD PAPER POSITION";
  const message = `I can prepare ${label}. This does not execute anything yet. Confirm within 90 seconds and I will refresh the market, rerun Sentinel, and use the paper execution gate. Action ID: ${pending.id}`;
  record(sessionId, "assistant", message, "TRADE_ACTION");
  return {
    ok: true,
    intent: "TRADE_ACTION",
    message,
    actionStatus: "CONFIRM_REQUIRED",
    evidence: [
      { label: "ACTION", value: action },
      { label: "SYMBOL", value: "XAUUSD" },
      { label: "CONFIRMATION", value: "REQUIRED" },
      { label: "EXPIRY", value: "90 SECONDS" },
      { label: "AUTHORITY", value: "SENTINEL ONLY" },
      { label: "EXECUTION", value: "PAPER ONLY" },
    ],
    timestamp: Date.now(),
  };
}

async function answerXAUStatus(sessionId: string): Promise<AssistantResponse> {
  const now = Date.now();
  try {
    const market = await getLiveMarketSnapshot("XAUUSD");
    const account = getPaperAccount(market.price);
    const orchestration = await orchestrateNINE(market, account);
    const tracking = createSetupTracking(orchestration.setup, account);
    const kronos = await getKronosForecast(market, "5min");
    const intelligence = buildV5Intelligence(market, orchestration, account, tracking, kronos);
    const setup = orchestration.setup;
    const direction = intelligence.direction;
    const regime = intelligence.regime;
    const topSetup = intelligence.recommendedStrategyId ?? "—";
    const evidence: Array<{ label: string; value: string }> = [
      { label: "VERSION", value: intelligence.version },
      { label: "SYMBOL", value: "XAUUSD" },
      { label: "PRICE", value: Number.isFinite(market.price) ? market.price.toFixed(2) : "—" },
      { label: "REGIME", value: regime },
      { label: "DIRECTION", value: direction },
      { label: "CONFIDENCE", value: `${intelligence.confidence}%` },
      { label: "TOP SETUP", value: topSetup },
      { label: "SENTINEL", value: orchestration.sentinel.approved ? "APPROVED" : "BLOCKED" },
      { label: "KRONOS", value: kronos.status === "LIVE" ? `${kronos.model} LIVE` : "UNAVAILABLE" },
      { label: "KRONOS CALIBRATION", value: intelligence.kronosCalibration.report.state },
    ];
    const message = direction === "NONE"
      ? `XAUUSD is in observation mode. Regime: ${regime}. The current setup has no validated direction; Sentinel remains ${orchestration.sentinel.approved ? "approved for the paper gate" : "blocked"}.`
      : `XAUUSD analysis: ${direction} direction, ${regime} regime, ${intelligence.confidence}% intelligence confidence. Setup validation is ${setup.validation.valid ? "valid" : "not valid"} and Sentinel is ${orchestration.sentinel.approved ? "approved" : "blocking"} execution. This is paper-trading intelligence, not a live order.`;
    const response: AssistantResponse = { ok: true, intent: "TRADING_STATUS", message, actionStatus: "NONE", evidence, timestamp: now };
    record(sessionId, "assistant", message, "TRADING_STATUS");
    return response;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "XAUUSD intelligence is unavailable.";
    const response: AssistantResponse = {
      ok: false,
      intent: "TRADING_STATUS",
      message: `XAUUSD intelligence is unavailable. No market number or signal was invented. Reason: ${reason}`,
      actionStatus: "BLOCKED",
      evidence: [{ label: "SYMBOL", value: "XAUUSD" }, { label: "PRICE", value: "—" }, { label: "EXECUTION", value: "PAPER ONLY" }],
      timestamp: now,
    };
    record(sessionId, "assistant", response.message, "TRADING_STATUS");
    return response;
  }
}
export async function answerAssistant(input: string, sessionId = "default"): Promise<AssistantResponse> {
  const text = input.trim();
  const intent = classify(text);
  const now = Date.now();

  if (!text) {
    return {
      ok: false, intent, message: "I’m ready. Tell me what you want me to do.",
      actionStatus: "NONE", evidence: [], timestamp: now,
    };
  }

  record(sessionId, "user", text, intent);

  if (intent === "TRADING_STATUS") return answerXAUStatus(sessionId);

  const store = getStoreSnapshot();
  const account = store.account;
  const diagnostics = runtimeDiagnostics();
  const positions = account.positions.filter((p) => p.status === "OPEN");
  const evidence: Array<{ label: string; value: string }> = [
    { label: "VERSION", value: diagnostics.version },
    { label: "MODE", value: diagnostics.liveTradingEnabled ? "LIVE UNLOCKED" : "PAPER" },
  ];

  let message = "";
  let actionStatus: AssistantActionStatus = "NONE";

  switch (intent) {
    case "HELP":
      message = "I’m NINE Assistant. I can report system health, paper performance, positions and risk, explain the trading workstation, and route XAUUSD analysis requests. Any trade action requires explicit confirmation and Sentinel approval; I cannot bypass that control.";
      break;

    case "SYSTEM_STATUS":
      evidence.push(
        { label: "DATABASE", value: "ONLINE" },
        { label: "PAPER TRADING", value: diagnostics.paperTradingEnabled ? "ENABLED" : "DISABLED" },
        { label: "MARKET FEED", value: diagnostics.provider.configured ? "CONFIGURED" : "UNCONFIGURED" },
        { label: "KRONOS", value: diagnostics.kronosConfigured ? "CONFIGURED" : "UNAVAILABLE" },
      );
      message = diagnostics.warnings.length
        ? `NINE is online. Current runtime is ${diagnostics.version}. I have ${diagnostics.warnings.length} runtime warning(s): ${diagnostics.warnings.join(" ")}`
        : `NINE is online and runtime ${diagnostics.version} reports no configured-system warnings.`;
      break;

    case "PAPER_PERFORMANCE":
      evidence.push(
        { label: "BALANCE", value: `$${fmt(account.balance)}` },
        { label: "EQUITY", value: `$${fmt(account.equity)}` },
        { label: "REALIZED P&L", value: `$${fmt(account.realizedPnl)}` },
        { label: "UNREALIZED P&L", value: `$${fmt(account.unrealizedPnl)}` },
        { label: "DAILY P&L", value: `$${fmt(account.dailyRealizedPnl)}` },
      );
      message = `Paper account: equity $${fmt(account.equity)}, realized P&L $${fmt(account.realizedPnl)}, unrealized P&L $${fmt(account.unrealizedPnl)}, daily realized P&L $${fmt(account.dailyRealizedPnl)}.`;
      break;

    case "OPEN_POSITIONS":
      evidence.push({ label: "OPEN POSITIONS", value: String(positions.length) });
      for (const position of positions.slice(0, 5)) {
        evidence.push({
          label: position.symbol,
          value: `${position.side} ${fmt(position.quantity, 3)} @ ${fmt(position.entryPrice)} | SL ${fmt(position.stopLoss)} | TP ${fmt(position.takeProfit)}`,
        });
      }
      message = positions.length
        ? `There are ${positions.length} open paper position(s). I have shown the current position geometry above.`
        : "There are no open paper positions.";
      break;

    case "RISK_STATUS": {
      const openRisk = positions.reduce((sum, p) => {
        const distance = Math.abs(p.entryPrice - p.stopLoss);
        return sum + distance * p.quantity;
      }, 0);
      const equity = Math.max(account.equity, 0);
      const riskPercent = equity > 0 ? (openRisk / equity) * 100 : null;
      evidence.push(
        { label: "OPEN RISK", value: `$${fmt(openRisk)}` },
        { label: "RISK / EQUITY", value: pct(riskPercent) },
        { label: "PEAK EQUITY", value: `$${fmt(account.peakEquity)}` },
      );
      message = `Current paper risk estimate is $${fmt(openRisk)} across ${positions.length} open position(s). This is a geometry estimate, not a broker risk calculation.`;
      break;
    }


    case "TRADE_ACTION":
      return requestAssistantAction(sessionId, text);

    case "GENERAL_CHAT":
    default: {
      const recent = getAssistantHistory(sessionId, 8).map((item: any) => `${item.role.toUpperCase()}: ${String(item.content)}`);
      const gemini = await generateGeminiReply(text, recent);
      if (gemini?.text) {
        message = sanitizeGeminiReply(gemini.text);
        evidence.push(
          { label: "AI PROVIDER", value: "GEMINI" },
          { label: "MODEL", value: gemini.model },
        );
      } else {
        message = geminiConfigured()
          ? "Gemini is configured but unavailable right now. NINE's deterministic assistant remains online."
          : "I’m NINE Assistant. Ask me about system status, paper performance, positions, risk, or XAUUSD intelligence. Gemini is not configured yet.";
        evidence.push({ label: "AI PROVIDER", value: geminiConfigured() ? "GEMINI UNAVAILABLE" : "DETERMINISTIC" });
      }
      break;
    }
  }

  record(sessionId, "assistant", message, intent);

  return { ok: true, intent, message, actionStatus, evidence, timestamp: now };
}

export function getAssistantHistory(sessionId = "default", limit = 30) {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return db.prepare(
    `SELECT id, role, content, intent, created_at AS createdAt
     FROM assistant_messages WHERE session_id = ?
     ORDER BY created_at DESC LIMIT ?`,
  ).all(sessionId, safeLimit).reverse();
}
