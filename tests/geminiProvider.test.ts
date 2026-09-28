import {
  buildGeminiSystemInstruction,
  geminiConfigured,
  geminiModel,
  sanitizeGeminiReply,
} from "../lib/assistant/geminiProvider";

export async function runGeminiProviderTest() {
  const instruction = buildGeminiSystemInstruction();
  if (!instruction.includes("Never invent market prices")) {
    throw new Error("Gemini safety instruction is missing.");
  }
  if (!instruction.includes("paper-only")) {
    throw new Error("Gemini execution boundary is missing.");
  }
  if (!geminiModel()) {
    throw new Error("Gemini model default is missing.");
  }
  const sanitized = sanitizeGeminiReply("API key: SECRET_VALUE");
  if (sanitized.includes("SECRET_VALUE")) {
    throw new Error("Gemini reply secret redaction failed.");
  }
  if (typeof geminiConfigured() !== "boolean") {
    throw new Error("Gemini configuration check failed.");
  }
  return true;
}
