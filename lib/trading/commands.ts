export type CommandAction = "ANALYZE" | "OPEN_PAPER" | "CLOSE_ALL" | "UNKNOWN";

export function classifyCommand(text: string): CommandAction {
  const value = text.toLowerCase().trim();
  if (value.includes("close all") || value.includes("close positions") || value.includes("exit all")) return "CLOSE_ALL";
  if (value === "paper trade" || value === "paper trade xauusd" || value === "paper trade nifty" || value === "paper trade banknifty") return "OPEN_PAPER";
  if ((value.includes("paper") || value.includes("simulate")) && (value.includes("buy") || value.includes("sell") || value.includes("trade") || value.includes("long") || value.includes("short") || value.includes("execute"))) return "OPEN_PAPER";
  if (value.includes("analy") || value.includes("xau") || value.includes("gold") || value.includes("market") || value.includes("status")) return "ANALYZE";
  return "UNKNOWN";
}
