import {
  AtlasContext,
  AtlasMacroEvent,
  MarketSnapshot,
  MarketBias,
} from "./types";

let newsCache: {
  items: NewsItem[];
  expiresAt: number;
} | null = null;

let calendarCache: {
  items: AtlasMacroEvent[];
  expiresAt: number;
} | null = null;

type NewsItem = {
  headline?: string;
  category?: string;
  source?: string;
  url?: string;
  datetime?: number;
  sentiment?: string;
};

function classify(
  title: string,
): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const t = title.toLowerCase();

  const bullish = [
    "surge",
    "rally",
    "higher",
    "gains",
    "bullish",
    "safe haven",
    "rate cut",
    "dovish",
    "weak dollar",
    "falling yields",
    "geopolitical risk",
    "war risk",
  ].some((x) => t.includes(x));

  const bearish = [
    "slump",
    "falls",
    "lower",
    "losses",
    "bearish",
    "rate hike",
    "hawkish",
    "strong dollar",
    "rising yields",
    "selloff",
  ].some((x) => t.includes(x));

  return bullish && !bearish
    ? "BULLISH"
    : bearish && !bullish
      ? "BEARISH"
      : "NEUTRAL";
}

async function fetchFinnhubNews(): Promise<NewsItem[]> {
  if (
    newsCache &&
    newsCache.expiresAt > Date.now()
  ) {
    return newsCache.items;
  }

  const key =
    process.env.FINNHUB_API_KEY;

  if (!key) return [];

  const url = new URL(
    "https://finnhub.io/api/v1/news",
  );

  url.searchParams.set(
    "category",
    "forex",
  );
  url.searchParams.set(
    "token",
    key,
  );

  try {
    const response = await fetch(
      url,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) return [];

    const data = await response.json();

    const items = Array.isArray(data)
      ? data.slice(0, 12)
      : [];

    newsCache = {
      items,
      expiresAt: Date.now() + 30_000,
    };

    return items;
  } catch {
    return [];
  }
}

async function fetchEconomicCalendar(): Promise<AtlasMacroEvent[]> {
  if (
    calendarCache &&
    calendarCache.expiresAt > Date.now()
  ) {
    return calendarCache.items;
  }

  const key =
    process.env.FINNHUB_API_KEY;

  if (!key) return [];

  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const future = new Date(
    now.getTime() + 48 * 60 * 60 * 1000,
  );
  const to = future.toISOString().slice(0, 10);

  const url = new URL(
    "https://finnhub.io/api/v1/calendar/economic",
  );

  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  url.searchParams.set("token", key);

  try {
    const response = await fetch(
      url,
      {
        cache: "no-store",
      },
    );

    if (!response.ok) return [];

    const data = await response.json();
    const events = Array.isArray(data?.economicCalendar)
      ? data.economicCalendar
      : [];

    const items: AtlasMacroEvent[] =
      events
        .slice(0, 30)
        .map((event: any) => ({
          title: String(
            event.event ??
              event.title ??
              "Economic event",
          ),
          country:
            typeof event.country === "string"
              ? event.country
              : undefined,
          impact:
            event.impact === "high"
              ? "HIGH"
              : event.impact === "medium"
                ? "MEDIUM"
                : event.impact === "low"
                  ? "LOW"
                  : "UNKNOWN",
          actual:
            event.actual == null
              ? null
              : String(event.actual),
          forecast:
            event.estimate == null
              ? null
              : String(event.estimate),
          previous:
            event.prev == null
              ? null
              : String(event.prev),
          time:
            event.time == null
              ? undefined
              : String(event.time),
        }));

    calendarCache = {
      items,
      expiresAt: Date.now() + 60_000,
    };

    return items;
  } catch {
    return [];
  }
}

export async function buildAtlasContext(
  market: MarketSnapshot,
): Promise<AtlasContext> {
  const [raw, macroEvents] =
    await Promise.all([
      fetchFinnhubNews(),
      fetchEconomicCalendar(),
    ]);

  const headlines = raw.map((item) => ({
    title: String(
      item.headline ??
        "Untitled",
    ),
    source: String(
      item.source ??
        "Market news",
    ),
    url: item.url,
    sentiment: classify(
      String(
        item.headline ??
          "",
      ),
    ),
    publishedAt:
      item.datetime
        ? new Date(
            item.datetime * 1000,
          ).toISOString()
        : undefined,
  }));

  const bullish =
    headlines.filter(
      (x) =>
        x.sentiment ===
        "BULLISH",
    ).length;

  const bearish =
    headlines.filter(
      (x) =>
        x.sentiment ===
        "BEARISH",
    ).length;

  const dailyBias: MarketBias =
    market.changePercent >
    0.25
      ? "BULLISH"
      : market.changePercent <
          -0.25
        ? "BEARISH"
        : "NEUTRAL";

  const newsBias: MarketBias =
    bullish > bearish
      ? "BULLISH"
      : bearish > bullish
        ? "BEARISH"
        : "NEUTRAL";

  const macroBias: MarketBias =
    newsBias === "NEUTRAL"
      ? dailyBias
      : newsBias ===
            dailyBias ||
          dailyBias ===
            "NEUTRAL"
        ? newsBias
        : "NEUTRAL";

  const highImpactCount =
    macroEvents.filter(
      (event) =>
        event.impact ===
        "HIGH",
    ).length;

  const summary =
    `Atlas sees ${macroBias.toLowerCase()} macro context from ${headlines.length} recent forex headlines and ${macroEvents.length} upcoming economic events. ` +
    `${highImpactCount} event(s) are marked high impact. ` +
    `Price is ${market.changePercent.toFixed(2)}% versus the previous-day close.`;

  return {
    headlineCount:
      headlines.length,
    bullish,
    bearish,
    neutral:
      headlines.length -
      bullish -
      bearish,
    headlines,
    macroBias,
    summary,
    generatedAt:
      Date.now(),
    macroEvents,
  };
}
