import type { OpsAlert } from "./opsMonitoring";

export interface AlertDeliveryOptions {
  endpoint: string | undefined;
  allowInsecureHttp?: boolean;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export interface AlertDeliveryResult {
  state: "SKIPPED" | "DELIVERED";
  alertCount: number;
}

const MAX_ALERTS_PER_DELIVERY = 100;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5_000;

export async function deliverOpsAlerts(
  alerts: readonly OpsAlert[],
  options: AlertDeliveryOptions
): Promise<AlertDeliveryResult> {
  if (alerts.length === 0) return { state: "SKIPPED", alertCount: 0 };
  if (alerts.length > MAX_ALERTS_PER_DELIVERY) throw new Error("Alert webhook payload exceeds the alert-count limit");

  const endpoint = parseAlertWebhookEndpoint(options.endpoint, options.allowInsecureHttp === true);
  const emittedAt = (options.now ?? (() => new Date()))();
  if (!Number.isFinite(emittedAt.getTime())) throw new Error("Alert webhook timestamp is invalid");

  let body: string;
  try {
    body = JSON.stringify({
      schemaVersion: 1,
      emittedAt: emittedAt.toISOString(),
      alertCount: alerts.length,
      alerts
    });
  } catch {
    throw new Error("Alert webhook payload is not serializable");
  }
  if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) {
    throw new Error("Alert webhook payload exceeds the byte limit");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10_000) {
    throw new Error("Alert webhook timeout must be an integer from 100 through 10000 milliseconds");
  }

  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch {
    throw new Error("Alert webhook delivery failed");
  }
  if (!response.ok) throw new Error("Alert webhook receiver rejected the delivery");
  return { state: "DELIVERED", alertCount: alerts.length };
}

function parseAlertWebhookEndpoint(raw: string | undefined, allowInsecureHttp: boolean): URL {
  if (!raw?.trim()) throw new Error("Alert webhook URL is required when alerts exist");
  if (raw.length > 2_048) throw new Error("Alert webhook URL exceeds the length limit");

  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new Error("Alert webhook URL is invalid");
  }
  if (endpoint.username || endpoint.password) throw new Error("Alert webhook URL must not contain credentials");
  if (endpoint.protocol !== "https:" && !(allowInsecureHttp && endpoint.protocol === "http:")) {
    throw new Error("Alert webhook URL must use HTTPS");
  }
  if (endpoint.hash) throw new Error("Alert webhook URL must not contain a fragment");
  return endpoint;
}
