import { createHash } from "node:crypto";
import { ExecutionRequest, ExecutionResult } from "./types";

export interface BrokerAdapter {
  readonly id: string;
  submitOrder(request: ExecutionRequest): Promise<ExecutionResult>;
  cancelOrder?(brokerOrderId: string): Promise<ExecutionResult>;
}

export class DisabledLiveBroker implements BrokerAdapter {
  readonly id = "disabled-live-broker";
  async submitOrder(request: ExecutionRequest): Promise<ExecutionResult> {
    return { accepted: false, mode: request.mode, status: "REJECTED", message: "Live broker execution is disabled.", timestamp: Date.now() };
  }
}

export class WebhookBrokerAdapter implements BrokerAdapter {
  readonly id = "webhook";
  async submitOrder(request: ExecutionRequest): Promise<ExecutionResult> {
    const endpoint = process.env.BROKER_EXECUTION_WEBHOOK_URL;
    const secret = process.env.BROKER_EXECUTION_WEBHOOK_SECRET;
    if (!endpoint || !secret) return { accepted: false, mode: "LIVE", status: "REJECTED", message: "Broker gateway configuration is incomplete.", timestamp: Date.now() };
    const idempotencyKey = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, "x-nine-adapter": this.id, "x-nine-idempotency-key": idempotencyKey }, body: JSON.stringify({ ...request, timestamp: Date.now() }), cache: "no-store", signal: controller.signal });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { accepted: false, mode: "LIVE", status: "REJECTED", message: `Broker gateway rejected the request (${response.status}).`, timestamp: Date.now() };
      return { accepted: true, mode: "LIVE", status: "SUBMITTED", message: "Order submitted to broker gateway.", brokerOrderId: typeof payload.orderId === "string" ? payload.orderId : undefined, timestamp: Date.now() };
    } catch (error) {
      return { accepted: false, mode: "LIVE", status: "REJECTED", message: error instanceof Error && error.name === "AbortError" ? "Broker gateway timed out after 8 seconds." : "Broker gateway request failed.", timestamp: Date.now() };
    } finally { clearTimeout(timeout); }
  }
}

export function getBrokerAdapter(): BrokerAdapter {
  return process.env.NINE_LIVE_TRADING_ENABLED === "true" ? new WebhookBrokerAdapter() : new DisabledLiveBroker();
}
