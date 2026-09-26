import { getLiveMarketSnapshot } from "@/lib/trading/market";
import { getPaperAccount } from "@/lib/trading/paperTrading";
import { orchestrateNINE } from "@/lib/trading/orchestrator";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const encoder = new TextEncoder();
  const intervalMs = Math.max(2500, Math.min(Number(process.env.NINE_STREAM_INTERVAL_MS ?? 4000), 15000));
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = async () => {
        if (closed) return;
        try {
          const market = await getLiveMarketSnapshot("XAUUSD");
          const account = getPaperAccount(market.price);
          const orchestration = await orchestrateNINE(market, account);
          controller.enqueue(encoder.encode(`event: market\ndata: ${JSON.stringify({ market, orchestration, account, chart: market.timeframes?.["1min"]?.candles.slice(-80) ?? [], ts: Date.now() })}\n\n`));
        } catch (error) {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: error instanceof Error ? error.message : "Market stream error" })}\n\n`));
        }
      };
      await send();
      const timer = setInterval(() => void send(), intervalMs);
      const abort = () => { closed = true; clearInterval(timer); try { controller.close(); } catch {} };
      request.signal.addEventListener("abort", abort, { once: true });
      controller.enqueue(encoder.encode(`: connected ${Date.now()}\n\n`));
    },
    cancel() { /* client disconnected */ },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" } });
}
