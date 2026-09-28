import { answerAssistant, getAssistantHistory } from "../lib/assistant/nineAssistant";

export function runNineAssistantTest() {
  const session = `test-${Date.now()}`;
  const status = answerAssistant("NINE status", session);
  if (!status.ok || status.intent !== "SYSTEM_STATUS") throw new Error("NINE assistant status routing failed.");
  if (!status.message.includes("NINE is online")) throw new Error("NINE assistant status response failed.");

  const performance = answerAssistant("paper performance", session);
  if (performance.intent !== "PAPER_PERFORMANCE") throw new Error("NINE assistant performance routing failed.");

  const trade = answerAssistant("buy gold", session);
  if (trade.intent !== "TRADE_ACTION" || trade.actionStatus !== "CONFIRM_REQUIRED") {
    throw new Error("NINE assistant trade safety boundary failed.");
  }

  const history = getAssistantHistory(session, 10);
  if (history.length < 6) throw new Error("NINE assistant history persistence failed.");

  return true;
}
