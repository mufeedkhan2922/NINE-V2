import { AtlasContext, AtlasMacroEvent, MarketSnapshot, MarketBias } from "./types";

type NewsItem = { headline?: string; category?: string; source?: string; url?: string; datetime?: number };
type AtlasRuntimeState = {
  newsCache: { items: NewsItem[]; expiresAt: number } | null;
  calendarCache: { items: AtlasMacroEvent[]; expiresAt: number } | null;
  newsError: string | null;
  calendarError: string | null;
  lastNewsAt: number | null;
  lastCalendarAt: number | null;
};

const globalAtlas = globalThis as typeof globalThis & { __nineAtlasState?: AtlasRuntimeState };
const state: AtlasRuntimeState = globalAtlas.__nineAtlasState ?? {
  newsCache: null,
  calendarCache: null,
  newsError: null,
  calendarError: null,
  lastNewsAt: null,
  lastCalendarAt: null,
};
globalAtlas.__nineAtlasState = state;

function classify(title: string): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const t = title.toLowerCase();
  const bullish = ["surge", "rally", "higher", "gains", "bullish", "safe haven", "rate cut", "dovish", "weak dollar", "falling yields", "geopolitical risk", "war risk"].some((x) => t.includes(x));
  const bearish = ["slump", "falls", "lower", "losses", "bearish", "rate hike", "hawkish", "strong dollar", "rising yields", "selloff"].some((x) => t.includes(x));
  return bullish && !bearish ? "BULLISH" : bearish && !bullish ? "BEARISH" : "NEUTRAL";
}

async function fetchFinnhubNews(): Promise<NewsItem[]> {
  if (state.newsCache && state.newsCache.expiresAt > Date.now()) return state.newsCache.items;
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) {
    state.newsError = "FINNHUB_API_KEY is missing.";
    return [];
  }
  try {
    const results = await Promise.all(["forex", "general"].map(async (category) => {
      const url = new URL("https://finnhub.io/api/v1/news");
      url.searchParams.set("category", category);
      url.searchParams.set("token", key);
      const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
      if (!response.ok) throw new Error(`Finnhub ${category} news HTTP ${response.status}.`);
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    }));
    const deduped = new Map<number | string, NewsItem>();
    for (const item of results.flat()) {
      const normalized: NewsItem = {
        headline: String(item?.headline ?? ""),
        source: String(item?.source ?? "Finnhub"),
        url: typeof item?.url === "string" ? item.url : undefined,
        datetime: Number.isFinite(Number(item?.datetime)) ? Number(item.datetime) : undefined,
        category: typeof item?.category === "string" ? item.category : undefined,
      };
      if (normalized.headline) deduped.set(normalized.datetime ?? normalized.headline, normalized);
    }
    const items = [...deduped.values()].sort((a, b) => (b.datetime ?? 0) - (a.datetime ?? 0)).slice(0, 20);
    state.newsCache = { items, expiresAt: Date.now() + 60_000 };
    state.lastNewsAt = Date.now();
    state.newsError = items.length ? null : "Finnhub returned no validated headlines.";
    return items;
  } catch (error) {
    state.newsError = error instanceof Error ? error.message : "Finnhub news request failed.";
    return [];
  }
}

async function fetchEconomicCalendar(): Promise<AtlasMacroEvent[]> {
  if (state.calendarCache && state.calendarCache.expiresAt > Date.now()) return state.calendarCache.items;
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) {
    state.calendarError = "FINNHUB_API_KEY is missing.";
    return [];
  }
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const future = new Date(now.getTime() + 72 * 60 * 60 * 1000);
  const to = future.toISOString().slice(0, 10);
  try {
    const url = new URL("https://finnhub.io/api/v1/calendar/economic");
    url.searchParams.set("from", from);
    url.searchParams.set("to", to);
    url.searchParams.set("token", key);
    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`Finnhub economic calendar HTTP ${response.status}.`);
    const data = await response.json();
    const events = Array.isArray(data?.economicCalendar) ? data.economicCalendar : [];
    const items = events.slice(0, 50).map((event: any) => ({
      title: String(event.event ?? event.title ?? "Economic event"),
      country: typeof event.country === "string" ? event.country : undefined,
      impact: event.impact === "high" ? "HIGH" : event.impact === "medium" ? "MEDIUM" : event.impact === "low" ? "LOW" : "UNKNOWN",
      actual: event.actual == null ? null : String(event.actual),
      forecast: event.estimate == null ? null : String(event.estimate),
      previous: event.prev == null ? null : String(event.prev),
      time: event.time == null ? undefined : String(event.time),
    })) as AtlasMacroEvent[];
    state.calendarCache = { items, expiresAt: Date.now() + 120_000 };
    state.lastCalendarAt = Date.now();
    state.calendarError = items.length ? null : "Finnhub returned no upcoming economic events.";
    return items;
  } catch (error) {
    state.calendarError = error instanceof Error ? error.message : "Finnhub economic calendar request failed.";
    return [];
  }
}

export function atlasHealth() {
  const headlinesCached = state.newsCache?.items.length ?? 0;
  const eventsCached = state.calendarCache?.items.length ?? 0;
  return {
    configured: Boolean(process.env.FINNHUB_API_KEY),
    newsCached: headlinesCached,
    eventsCached,
    lastNewsAt: state.lastNewsAt,
    lastCalendarAt: state.lastCalendarAt,
    newsError: state.newsError,
    calendarError: state.calendarError,
  };
}

export async function buildAtlasContext(market: MarketSnapshot): Promise<AtlasContext> {
  const [raw, macroEvents] = await Promise.all([fetchFinnhubNews(), fetchEconomicCalendar()]);
  const headlines = raw.map((item) => ({
    title: String(item.headline ?? "Untitled"),
    source: String(item.source ?? "Market news"),
    url: item.url,
    sentiment: classify(String(item.headline ?? "")),
    publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : undefined,
  }));
  const bullish = headlines.filter((x) => x.sentiment === "BULLISH").length;
  const bearish = headlines.filter((x) => x.sentiment === "BEARISH").length;
  const dailyBias: MarketBias = market.changePercent > 0.25 ? "BULLISH" : market.changePercent < -0.25 ? "BEARISH" : "NEUTRAL";
  const newsBias: MarketBias = bullish > bearish ? "BULLISH" : bearish > bullish ? "BEARISH" : "NEUTRAL";
  const macroBias: MarketBias = headlines.length ? (newsBias === dailyBias || dailyBias === "NEUTRAL" ? newsBias : "NEUTRAL") : "NEUTRAL";
  const highImpactCount = macroEvents.filter((event) => event.impact === "HIGH").length;
  const hasAnyValidatedData = headlines.length > 0 || macroEvents.length > 0;
  const summary = hasAnyValidatedData
    ? `Atlas sees ${macroBias.toLowerCase()} context from ${headlines.length} validated headlines and ${macroEvents.length} upcoming economic events. ${highImpactCount} event(s) are marked high impact.`
    : "Atlas has no validated news or economic-calendar data available. NINE will not infer or fabricate macro conditions.";
  const errors = [state.newsError, state.calendarError].filter((value): value is string => Boolean(value));
  return {
    headlineCount: headlines.length,
    bullish,
    bearish,
    neutral: headlines.length - bullish - bearish,
    headlines,
    macroBias,
    summary,
    generatedAt: Date.now(),
    macroEvents,
    sourceStatus: !process.env.FINNHUB_API_KEY ? "UNAVAILABLE" : hasAnyValidatedData ? (errors.length ? "LIMITED" : "LIVE") : "LIMITED",
    freshnessSeconds: hasAnyValidatedData ? 0 : null,
    errors,
  };
}
