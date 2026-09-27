import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import { orchestrateNINE } from "@/lib/trading/orchestrator";
import { getOrders } from "@/lib/trading/orders";
import {
  marketFeedStatus,
  NINE_VERSION,
  runtimeSafety,
} from "@/lib/trading/runtime";
import type { MarketSymbol } from "@/lib/trading/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SYMBOLS: MarketSymbol[] = ["XAUUSD", "NIFTY", "BANKNIFTY"];

function requestedSymbol(request: Request): MarketSymbol {
  const value = new URL(request.url).searchParams.get("symbol")?.toUpperCase();
  return SYMBOLS.includes(value as MarketSymbol)
    ? (value as MarketSymbol)
    : "XAUUSD";
}

export async function GET(request: Request) {
  const symbol = requestedSymbol(request);
  const encoder = new TextEncoder();
  const intervalMs = Math.max(
    2500,
    Math.min(
      Number(process.env.NINE_STREAM_INTERVAL_MS ?? 4000),
      15000,
    ),
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      let inFlight = false;

      const send = async () => {
        if (closed || inFlight) return;
        inFlight = true;

        try {
          const market = await getLiveMarketSnapshot(symbol);
          const account = getPaperAccount(market.price);
          const orchestration = await orchestrateNINE(
            market,
            account,
          );

          controller.enqueue(
            encoder.encode(
              `event: market\ndata: ${JSON.stringify({
                version: NINE_VERSION,
                symbol,
                runtime: runtimeSafety(),
                market,
                feed: marketFeedStatus(market),
                orchestration,
                account,
                orders: getOrders(20),
                chart:
                  market.timeframes?.["1min"]?.candles.slice(-120) ??
                  [],
                ts: Date.now(),
              })}\n\n`,
            ),
          );
        } catch (error) {
          if (!closed) {
            controller.enqueue(
              encoder.encode(
                `event: market_error\ndata: ${JSON.stringify({
                  version: NINE_VERSION,
                  symbol,
                  runtime: runtimeSafety(),
                  feed: marketFeedStatus(null),
                  message:
                    error instanceof Error
                      ? error.message
                      : "Market stream error.",
                  events: [{
                    type: "MARKET_DEGRADED",
                    message: `Signal engine blocked: ${error instanceof Error ? error.message : "Market stream error."}`,
                    timestamp: Date.now(),
                  }],
                  ts: Date.now(),
                })}\n\n`,
              ),
            );
          }
        } finally {
          inFlight = false;
        }
      };

      await send();

      const timer = setInterval(() => void send(), intervalMs);
      const heartbeat = setInterval(() => {
        if (!closed) {
          controller.enqueue(
            encoder.encode(`: heartbeat ${Date.now()}\n\n`),
          );
        }
      }, 15000);

      const abort = () => {
        closed = true;
        clearInterval(timer);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Client already disconnected.
        }
      };

      request.signal.addEventListener("abort", abort, { once: true });

      if (!closed) {
        controller.enqueue(
          encoder.encode(`: connected ${Date.now()}\n\n`),
        );
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
