// @vitest-environment node
import { createServer } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { deliverOpsAlerts } from "../../src/server/alertDelivery";
import type { OpsAlert } from "../../src/server/opsMonitoring";

const alerts: OpsAlert[] = [{
  code: "WEBSITE_DOWN",
  severity: "critical",
  message: "The public website health check failed.",
  metadata: { statusCode: 503 }
}];

const openServers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => {
    server.close();
    await once(server, "close");
  }));
});

describe("operations alert delivery", () => {
  it("skips network access when there are no alerts", async () => {
    const result = await deliverOpsAlerts([], {
      endpoint: undefined,
      fetch: async () => { throw new Error("must not fetch"); }
    });

    expect(result).toEqual({ state: "SKIPPED", alertCount: 0 });
  });

  it("requires a configured webhook when an alert exists", async () => {
    await expect(deliverOpsAlerts(alerts, { endpoint: undefined }))
      .rejects.toThrow(/webhook.*required/i);
  });

  it("posts a bounded versioned payload to a real local receiver", async () => {
    let request: { method: string | undefined; contentType: string | undefined; body: string } | undefined;
    const server = createServer((incoming, response) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        request = {
          method: incoming.method,
          contentType: incoming.headers["content-type"],
          body: Buffer.concat(chunks).toString("utf8")
        };
        response.statusCode = 204;
        response.end();
      });
    });
    openServers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("local receiver did not expose a port");

    const result = await deliverOpsAlerts(alerts, {
      endpoint: `http://127.0.0.1:${address.port}/alerts`,
      allowInsecureHttp: true,
      now: () => new Date("2026-07-14T00:00:00.000Z")
    });

    expect(result).toEqual({ state: "DELIVERED", alertCount: 1 });
    expect(request).toMatchObject({ method: "POST", contentType: "application/json" });
    expect(JSON.parse(request!.body)).toEqual({
      schemaVersion: 1,
      emittedAt: "2026-07-14T00:00:00.000Z",
      alertCount: 1,
      alerts
    });
  });

  it("rejects credentials and plaintext remote webhooks", async () => {
    await expect(deliverOpsAlerts(alerts, { endpoint: "https://user:secret@alerts.example.test/hook" }))
      .rejects.toThrow(/credentials/i);
    await expect(deliverOpsAlerts(alerts, { endpoint: "http://alerts.example.test/hook" }))
      .rejects.toThrow(/https/i);
  });

  it("fails closed without leaking the endpoint or response body", async () => {
    const endpoint = "https://alerts.example.test/private-token";
    await expect(deliverOpsAlerts(alerts, {
      endpoint,
      fetch: async () => new Response("receiver-secret", { status: 503 })
    })).rejects.toSatisfy((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return /rejected/i.test(message) && !message.includes(endpoint) && !message.includes("receiver-secret");
    });
  });
});
