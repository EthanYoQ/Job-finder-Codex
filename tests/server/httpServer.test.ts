import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server/httpServer";

const openServers = new Set<Server>();

afterEach(async () => {
  await Promise.all(
    Array.from(openServers, (server) =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      })
    )
  );
  openServers.clear();
});

describe("http server", () => {
  it("routes GET /healthz through the public API handler", async () => {
    const server = createServer({
      db: {
        job: { findMany: async () => [] },
        crawlObservation: { findFirst: async () => null },
        company: { findMany: async () => [] },
        feedback: { create: async () => ({ id: "feedback-1" }) },
        recommendedCompany: { create: async () => ({ id: "company-1" }) }
      }
    });
    openServers.add(server);

    const address = await new Promise<{ port: number }>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const value = server.address();
        if (!value || typeof value === "string") {
          reject(new Error("expected TCP address"));
          return;
        }

        resolve({ port: value.port });
      });
    });

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
