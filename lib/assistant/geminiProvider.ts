const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const DEFAULT_MODEL = "gemini-3.8-flash";
const DEFAULT_TIMEOUT_MS = 20_000;

export type GeminiReply = {
  text: string;
  model: string;
  interactionId: string | null;
};

export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export function geminiModel(): string {
  return process.env.NINE_GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export function buildGeminiSystemInstruction(): string {
  return [
    "You are NINE, a concise personal assistant inside an XAUUSD paper-trading workstation.",
    "You may explain software, workflows, general concepts, and the information explicitly supplied by the workstation.",
    "Never invent market prices, signals, positions, account values, broker state, news, or trading metrics.",
    "Never place, authorize, or imply authorization for a trade. Trade actions are handled only by NINE's deterministic confirmation and Sentinel safety gates.",
    "The live broker is locked. The execution mode is paper-only.",
    "When workstation evidence is unavailable, say that it is unavailable instead of guessing.",
    "Do not expose secrets, API keys, session identifiers, internal credentials, or security controls.",
    "Keep responses direct and useful.",
  ].join("\n");
}

function extractOutputText(payload: any): string {
  if (typeof payload?.output_text === "string") return payload.output_text.trim();

  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const parts: string[] = [];
  for (const step of steps) {
    const content = Array.isArray(step?.content) ? step.content : [];
    for (const item of content) {
      if (typeof item?.text === "string") parts.push(item.text);
    }
  }
  return parts.join("\n").trim();
}

function abortSignal(timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

export async function generateGeminiReply(
  input: string,
  context: string[] = [],
): Promise<GeminiReply | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || !input.trim()) return null;

  const timeoutMs = Math.max(
    3_000,
    Math.min(Number(process.env.NINE_GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS), 60_000),
  );
  const recentContext = context
    .filter((item) => item.trim())
    .slice(-8)
    .map((item) => item.slice(0, 2_000))
    .join("\n");

  const prompt = recentContext
    ? `Recent conversation context:\n${recentContext}\n\nUser:\n${input.trim()}`
    : input.trim();

  const { signal, cleanup } = abortSignal(timeoutMs);
  try {
    const response = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        model: geminiModel(),
        input: prompt,
        system_instruction: buildGeminiSystemInstruction(),
        generation_config: {
          max_output_tokens: Number(process.env.NINE_GEMINI_MAX_OUTPUT_TOKENS ?? 600),
          thinking_level: "low",
        },
        store: false,
      }),
      signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const text = extractOutputText(payload);
    if (!text) return null;

    return {
      text,
      model: geminiModel(),
      interactionId: typeof payload?.id === "string" ? payload.id : null,
    };
  } catch {
    return null;
  } finally {
    cleanup();
  }
}

export function sanitizeGeminiReply(text: string): string {
  return text
    .replace(/(api[_ -]?key|secret|token)\s*[:=]\s*[^\s,;]+/gi, "$1: [REDACTED]")
    .trim()
    .slice(0, 6_000);
}
