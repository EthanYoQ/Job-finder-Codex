import type { Server } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server/httpServer";
import { createMemoryRateLimitStore } from "../../src/server/rateLimit";

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
  function createTestServer() {
    const staticRoot = mkdtempSync(resolve(tmpdir(), "job-finder-http-"));
    writeFileSync(resolve(staticRoot, "index.html"), "<div id=\"root\"></div>", "utf8");

    const db = {
      db: {
        job: {
          findMany: async () => [],
          update: async () => ({ id: "job-1" })
        },
        crawlObservation: { findFirst: async () => null },
        crawlBatchSourceResult: { findMany: async () => [] },
        company: { findMany: async () => [] },
        feedback: {
          create: async () => ({ id: "feedback-1" }),
          update: async () => ({ id: "feedback-1", status: "REVIEWED" }),
          findMany: async () => []
        },
        recommendedCompany: {
          create: async () => ({ id: "company-1" }),
          update: async () => ({ id: "company-1", status: "REVIEWED" }),
          findMany: async () => []
        },
        adminUser: { findUnique: async () => null },
        adminSession: {
          create: async () => ({}),
          findUnique: async () => null
        },
        adminAuditEvent: { create: async () => ({}) },
        manualCrawlRequest: { create: async () => ({ id: "crawl-1" }) },
        recruitmentSource: { findMany: async () => [] }
      },
      checkDatabaseReadiness: async () => true,
      rateLimitStore: createMemoryRateLimitStore()
    };

    return createServer(db, { staticRoot });
  }

  async function listen(server: Server) {
    openServers.add(server);

    return new Promise<{ port: number }>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => {
        const value = server.address();
        if (!value || typeof value === "string") {
          reject(new Error("expected TCP address"));
          return;
        }

        resolve({ port: value.port });
      });
    });
  }

  it("routes GET /healthz through the public API handler", async () => {
    const address = await listen(createTestServer());

    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("routes GET /livez through the public API handler", async () => {
    const address = await listen(createTestServer());
    const response = await fetch(`http://127.0.0.1:${address.port}/livez`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("serves privacy and terms as plain text documents before consent", async () => {
    const address = await listen(createTestServer());

    const response = await fetch(`http://127.0.0.1:${address.port}/privacy`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("隐私");
  });

  it("serves the admin SPA shell with noindex and protects admin APIs", async () => {
    const address = await listen(createTestServer());

    const adminPage = await fetch(`http://127.0.0.1:${address.port}/admin`);
    expect(adminPage.status).toBe(200);
    expect(adminPage.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const dashboard = await fetch(`http://127.0.0.1:${address.port}/admin/api/dashboard`);
    expect(dashboard.status).toBe(401);
    expect(dashboard.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("does not let direct clients bypass API rate limits with spoofed forwarded headers", async () => {
    const originalTrustedProxyCidrs = process.env.TRUSTED_PROXY_CIDRS;
    process.env.TRUSTED_PROXY_CIDRS = "";

    try {
      const address = await listen(createTestServer());
      const responses: number[] = [];

      for (let index = 0; index < 31; index += 1) {
        const response = await fetch(`http://127.0.0.1:${address.port}/api/feedback`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-job-search-consent": "accepted",
            "x-forwarded-for": `203.0.113.${index + 1}`
          },
          body: JSON.stringify({
            issueType: "职位信息有误",
            description: "测试反馈"
          })
        });
        responses.push(response.status);
      }

      expect(responses.slice(0, 30).every((status) => status === 201)).toBe(true);
      expect(responses[30]).toBe(429);
    } finally {
      if (originalTrustedProxyCidrs === undefined) {
        delete process.env.TRUSTED_PROXY_CIDRS;
      } else {
        process.env.TRUSTED_PROXY_CIDRS = originalTrustedProxyCidrs;
      }
    }
  });
});
