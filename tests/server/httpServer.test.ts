import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../../src/server/httpServer";
import { createMemoryRateLimitStore } from "../../src/server/rateLimit";
import { readPortablePublicSnapshot, type PortablePublicSnapshot, type PortableSnapshotDb } from "../../src/db/portablePublicSnapshotRepository";
import { accepted, job, plan, NOW } from "../helpers/portablePublicSnapshotFixture";

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
  function createTestServer(overrides: { checkDatabaseReadiness?: () => Promise<boolean>; readPortableSnapshot?: () => Promise<PortablePublicSnapshot> } = {}) {
    const staticRoot = mkdtempSync(resolve(tmpdir(), "job-finder-http-"));
    writeFileSync(resolve(staticRoot, "index.html"), "<div id=\"root\"></div>", "utf8");
    writeFileSync(resolve(staticRoot, "logo.png"), Buffer.from([137, 80, 78, 71]));
    writeFileSync(resolve(staticRoot, "logo.webp"), Buffer.from("RIFF-test-WEBP"));
    writeFileSync(resolve(staticRoot, "font.woff2"), Buffer.from("wOF2"));
    mkdirSync(resolve(staticRoot, "assets"));
    writeFileSync(resolve(staticRoot, "assets/App-DZA08wpL.js"), 'console.log("职位");\n'.repeat(100));
    writeFileSync(resolve(staticRoot, "assets/App-BLE5E0kn.css"), ".card { color: black; }\n".repeat(100));

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
        manualCrawlRequest: {
          create: async () => ({ id: "crawl-1" }),
          findMany: async () => []
        },
        recruitmentSource: { findMany: async () => [] }
      },
      checkDatabaseReadiness: overrides.checkDatabaseReadiness ?? (async () => true),
      ...(overrides.readPortableSnapshot ? { readPortableSnapshot: overrides.readPortableSnapshot } : {}),
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

  function rawRequest(port: number, path: string, headers: Record<string, string> = {}, method = "GET", body?: string) {
    return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }));
      });
      request.on("error", reject);
      request.end(body);
    });
  }

  async function publicSnapshot() {
    const evidence = accepted();
    const transaction = {
      crawlBatchSourceResult: { findMany: async () => [evidence.result] },
      lifecycleSetEvidenceMember: { findMany: async () => evidence.members },
      job: { findMany: async () => [job()] }
    };
    return readPortablePublicSnapshot({ $transaction: async (work) => work(transaction) } as PortableSnapshotDb, { currentTime: NOW }, [plan]);
  }

  it.each(["identity", "gzip"])("exposes public GET app duration including delayed reads and %s encoding", async encoding => {
    const snapshot = await publicSnapshot();
    const address = await listen(createTestServer({readPortableSnapshot: async () => {
      await new Promise(resolve => setTimeout(resolve, 20));
      return snapshot;
    }}));
    for (const path of ["/api/search?city=上海", "/api/coverage"]) {
      const result = await rawRequest(address.port, encodeURI(path), {"x-job-search-consent": "accepted", "accept-encoding": encoding});
      expect(result.status).toBe(200);
      const timing = String(result.headers["server-timing"]);
      expect(timing).toMatch(/^app;dur=\d+\.\d(?:, [A-Za-z]+;dur=\d+\.\d)*$/);
      const stages = Object.fromEntries(timing.split(", ").map(stage => {
        const [name, duration] = stage.split(";dur=");
        return [name, Number(duration)];
      }));
      expect(stages.app).toBeGreaterThanOrEqual(15);
      expect(stages.read).toBeGreaterThanOrEqual(15);
      expect(stages.project).toBeGreaterThanOrEqual(0);
      expect(stages.JSON).toBeGreaterThanOrEqual(0);
      expect(stages.gzip === undefined).toBe(encoding === "identity");
      expect(JSON.parse((encoding === "gzip" ? gunzipSync(result.body) : result.body).toString())).toHaveProperty("companies");
    }
    const staticResponse = await rawRequest(address.port, "/logo.png");
    expect(staticResponse.headers["server-timing"]).toBeUndefined();
    const postResponse = await rawRequest(address.port, "/api/feedback", {"content-type": "application/json", "x-job-search-consent": "accepted"}, "POST", JSON.stringify({issueType: "OTHER", description: "test"}));
    expect(postResponse.headers["server-timing"]).toBeUndefined();
  });

  it("only exposes finite numeric stages from the fixed timing allowlist", async () => {
    const snapshot = await publicSnapshot();
    const read = Object.assign(async () => snapshot, {readWithStatus: async (_finished?: Promise<void>, _check?: string, record?: (phase: string, duration: number) => void) => {
      record?.("versionSQL", 12.5);
      record?.("txAcquire", Number.NaN);
      record?.("cacheClone", -1);
      record?.("private-id-and-sql", 1);
      return {snapshot, snapshotRefresh: {state: "CURRENT" as const, version: "a".repeat(64)}};
    }});
    const address = await listen(createTestServer({readPortableSnapshot: read}));
    const response = await rawRequest(address.port, "/api/coverage", {"x-job-search-consent": "accepted"});
    expect(response.headers["server-timing"]).toContain("versionSQL;dur=12.5");
    expect(response.headers["server-timing"]).not.toMatch(/private|NaN|txAcquire|cacheClone|desc=/);
  });

  it("serves local redesign logo and font assets with their correct MIME types", async () => {
    const address = await listen(createTestServer());
    const logo = await rawRequest(address.port, "/logo.png");
    const font = await rawRequest(address.port, "/font.woff2");
    expect(logo.status).toBe(200); expect(logo.headers["content-type"]).toBe("image/png");
    expect(font.status).toBe(200); expect(font.headers["content-type"]).toBe("font/woff2");
    expect(logo.body).toEqual(Buffer.from([137, 80, 78, 71])); expect(font.body.toString()).toBe("wOF2");
  });

  it("serves the lossless WebP logo sheet with image MIME for GET and HEAD", async () => {
    const address = await listen(createTestServer());
    const image = await rawRequest(address.port, "/logo.webp");
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/webp");
    expect(image.body.toString()).toBe("RIFF-test-WEBP");
    const head = await rawRequest(address.port, "/logo.webp", {}, "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("image/webp");
    expect(head.body.length).toBe(0);
  });

  it("negotiates static JS/CSS encoding, immutable caching and bodyless revalidation over HTTP", async () => {
    const address = await listen(createTestServer());
    for (const path of ["/assets/App-DZA08wpL.js", "/assets/App-BLE5E0kn.css?v=1"]) {
      const plain = await rawRequest(address.port, path);
      const compressed = await rawRequest(address.port, path, { "accept-encoding": "gzip" });
      expect(plain.status).toBe(200);
      expect(compressed.status).toBe(200);
      expect(compressed.headers).toMatchObject({ "content-encoding": "gzip", vary: "Accept-Encoding", "cache-control": "public, max-age=31536000, immutable", etag: plain.headers.etag });
      expect(compressed.headers["content-length"]).toBe(String(compressed.body.length));
      expect(gunzipSync(compressed.body)).toEqual(plain.body);
      for (const method of ["GET", "HEAD"]) {
        const cached = await rawRequest(address.port, path, { "accept-encoding": "gzip", "if-none-match": plain.headers.etag! }, method);
        expect(cached.status).toBe(304);
        expect(cached.body.length).toBe(0);
        expect(cached.headers).toMatchObject({ etag: plain.headers.etag, vary: "Accept-Encoding", "cache-control": "public, max-age=31536000, immutable" });
        expect(cached.headers["content-length"]).toBeUndefined();
      }
      const head = await rawRequest(address.port, path, { "accept-encoding": "gzip" }, "HEAD");
      expect(head.headers["content-length"]).toBe(compressed.headers["content-length"]);
      expect(head.headers["content-encoding"]).toBe("gzip");
      expect(head.body.length).toBe(0);
    }
  });

  it("revalidates HTML and stable assets while preserving admin noindex and static routing boundaries", async () => {
    const address = await listen(createTestServer());
    for (const path of ["/", "/index.html", "/admin", "/admin/settings", "/logo.webp", "/font.woff2"]) {
      const first = await rawRequest(address.port, path, { "accept-encoding": "gzip" });
      expect(first.status).toBe(200);
      expect(first.headers["cache-control"]).toBe("no-cache");
      expect(first.headers["content-encoding"]).toBeUndefined();
      const revalidated = await rawRequest(address.port, path, { "if-none-match": first.headers.etag! });
      expect(revalidated.status).toBe(304);
      expect(revalidated.body.length).toBe(0);
      if (path.startsWith("/admin")) expect(revalidated.headers["x-robots-tag"]).toBe("noindex, nofollow");
    }
    for (const path of ["/missing.js", "/assets", "/%2e%2e/package.json", "/..%2fpackage.json"]) {
      const result = await rawRequest(address.port, path, { "accept-encoding": "gzip", "if-none-match": "*" });
      expect(result.status).toBe(404);
      expect(result.headers.etag).toBeUndefined();
      expect(result.headers["cache-control"]).toBeUndefined();
    }
    const post = await rawRequest(address.port, "/assets/App-DZA08wpL.js", {}, "POST");
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
    expect(post.headers.etag).toBeUndefined();
  });

  it("compresses only negotiated public search/coverage JSON with correct raw wire lengths and identical decoded bytes", async () => {
    const snapshot = await publicSnapshot();
    let reads = 0;
    const address = await listen(createTestServer({ readPortableSnapshot: async () => { reads++; return snapshot; } }));
    for (const path of ["/api/search?city=%E4%B8%8A%E6%B5%B7", "/api/coverage"]) {
      const headers = { "x-job-search-consent": "accepted" };
      const plain = await rawRequest(address.port, path, headers);
      const compressed = await rawRequest(address.port, path, { ...headers, "accept-encoding": "gzip" });
      expect([plain.status, compressed.status]).toEqual([200, 200]);
      expect(plain.headers["content-encoding"]).toBeUndefined();
      expect(compressed.headers["content-encoding"]).toBe("gzip");
      for (const response of [plain, compressed]) {
        expect(response.headers.vary).toBe("Accept-Encoding");
        expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
        expect(response.headers["content-length"]).toBe(String(response.body.length));
        expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
      }
      expect(gunzipSync(compressed.body)).toEqual(plain.body);
    }
    expect(reads).toBe(4);
  });

  it("preserves consent, errors, non-GET and sensitive routes without compression", async () => {
    let reads = 0;
    const address = await listen(createTestServer({ readPortableSnapshot: async () => { reads++; return publicSnapshot(); } }));
    const acceptedHeaders = { "accept-encoding": "gzip", "x-job-search-consent": "accepted" };
    const responses = [
      await rawRequest(address.port, "/api/search?city=Shanghai", { "accept-encoding": "gzip" }),
      await rawRequest(address.port, "/api/search?limit=999", acceptedHeaders),
      await rawRequest(address.port, "/api/search", acceptedHeaders, "POST"),
      await rawRequest(address.port, "/api/coverage", acceptedHeaders, "HEAD"),
      await rawRequest(address.port, "/admin/api/dashboard", acceptedHeaders),
      await rawRequest(address.port, "/api/feedback", { ...acceptedHeaders, "content-type": "application/json" }, "POST", JSON.stringify({ issueType: "PRIVACY_EXPORT", contact: "private@example.test", description: "导出我的反馈" })),
      await rawRequest(address.port, "/healthz", acceptedHeaders)
    ];
    expect(responses.map((response) => response.status)).toEqual([403, 400, 404, 404, 401, 201, 200]);
    for (const response of responses) expect(response.headers["content-encoding"]).toBeUndefined();
    expect(reads).toBe(0);
  });

  it("keeps the public search rate limit and retry-after unchanged for gzip requests", async () => {
    const snapshot = await publicSnapshot();
    let reads = 0;
    const address = await listen(createTestServer({ readPortableSnapshot: async () => { reads++; return snapshot; } }));
    const headers = { "accept-encoding": "gzip", "x-job-search-consent": "accepted" };
    for (let index = 0; index < 30; index++) {
      const response = await rawRequest(address.port, "/api/search?city=Shanghai", headers);
      expect(response.status).toBe(200);
      expect(response.headers["content-encoding"]).toBe("gzip");
    }
    const limited = await rawRequest(address.port, "/api/search?city=Shanghai", headers);
    expect(limited.status).toBe(429);
    expect(limited.headers["content-encoding"]).toBeUndefined();
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    expect(JSON.parse(limited.body.toString())).toMatchObject({ error: "RATE_LIMITED" });
    expect(reads).toBe(30);
  });

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

  it("routes GET /readyz through deployment readiness", async () => {
    const address = await listen(createTestServer({ checkDatabaseReadiness: async () => false }));
    const response = await fetch(`http://127.0.0.1:${address.port}/readyz`);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ ok: false });
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
