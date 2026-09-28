import { answerAssistant, getAssistantHistory } from "../lib/assistant/nineAssistant";

export async function runNineAssistantTest() {
  const session = `test-${Date.now()}`;
  const status = await answerAssistant("NINE status", session);
  if (!status.ok || status.intent !== "SYSTEM_STATUS") throw new Error("NINE assistant status routing failed.");
  if (!status.message.includes("NINE is online")) throw new Error("NINE assistant status response failed.");

  const performance = await answerAssistant("paper performance", session);
  if (performance.intent !== "PAPER_PERFORMANCE") throw new Error("NINE assistant performance routing failed.");

  const trade = await answerAssistant("buy gold", session);
  if (trade.intent !== "TRADE_ACTION" || trade.actionStatus !== "CONFIRM_REQUIRED") {
    throw new Error("NINE assistant trade safety boundary failed.");
  }
  if (!trade.message.includes("Confirm within 90 seconds")) {
    throw new Error("NINE assistant confirmation workflow was not created.");
  }

  const cancelled = await answerAssistant("cancel", session);
  if (cancelled.intent !== "TRADE_ACTION" || cancelled.actionStatus !== "NONE" || !cancelled.message.includes("Cancelled action")) {
    throw new Error("NINE assistant cancellation workflow failed.");
  }

  const trading = await answerAssistant("analyze XAUUSD", session);\n  if (trading.intent !== "TRADING_STATUS") throw new Error("NINE assistant XAUUSD routing failed.");\n\n  const history = getAssistantHistory(session, 10);
  if (history.length < 6) throw new Error("NINE assistant history persistence failed.");

  return true;
}
