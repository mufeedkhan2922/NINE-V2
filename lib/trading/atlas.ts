import { AtlasContext, MarketSnapshot, MarketBias } from "./types";

let newsCache: { items: NewsItem[]; expiresAt: number } | null = null;

type NewsItem = { headline?: string; category?: string; source?: string; url?: string; datetime?: number; sentiment?: string };

function classify(title: string): "BULLISH" | "BEARISH" | "NEUTRAL" {
  const t = title.toLowerCase();
  const bullish = ["surge","rally","higher","gains","bullish","safe haven","rate cut","dovish","weak dollar","falling yields","geopolitical risk","war risk"].some((x) => t.includes(x));
  const bearish = ["slump","falls","lower","losses","bearish","rate hike","hawkish","strong dollar","rising yields","selloff"].some((x) => t.includes(x));
  return bullish && !bearish ? "BULLISH" : bearish && !bullish ? "BEARISH" : "NEUTRAL";
}

async function fetchFinnhubNews(): Promise<NewsItem[]> {
  if (newsCache && newsCache.expiresAt > Date.now()) return newsCache.items;
  const key = process.env.FINNHUB_API_KEY;
  if (!key) return [];
  const url = new URL("https://finnhub.io/api/v1/news");
  url.searchParams.set("category", "forex");
  url.searchParams.set("token", key);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return [];
  const data = await response.json();
  const items = Array.isArray(data) ? data.slice(0, 12) : [];
  newsCache = { items, expiresAt: Date.now() + 30_000 };
  return items;
}

export async function buildAtlasContext(market: MarketSnapshot): Promise<AtlasContext> {
  const raw = await fetchFinnhubNews().catch(() => []);
  const headlines = raw.map((item) => ({
    title: String(item.headline ?? "Untitled"), source: String(item.source ?? "Market news"), url: item.url, sentiment: classify(String(item.headline ?? "")), publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : undefined,
  }));
  const bullish = headlines.filter((x) => x.sentiment === "BULLISH").length;
  const bearish = headlines.filter((x) => x.sentiment === "BEARISH").length;
  const dailyBias = market.changePercent > 0.25 ? "BULLISH" : market.changePercent < -0.25 ? "BEARISH" : "NEUTRAL";
  const newsBias: MarketBias = bullish > bearish ? "BULLISH" : bearish > bullish ? "BEARISH" : "NEUTRAL";
  const macroBias: MarketBias = newsBias === "NEUTRAL" ? dailyBias : newsBias === dailyBias || dailyBias === "NEUTRAL" ? newsBias : "NEUTRAL";
  const summary = `Atlas sees ${macroBias.toLowerCase()} macro context from ${headlines.length} recent forex headlines and a ${market.changePercent.toFixed(2)}% move versus the previous-day close.`;
  return { headlineCount: headlines.length, bullish, bearish, neutral: headlines.length - bullish - bearish, headlines, macroBias, summary, generatedAt: Date.now() };
}
