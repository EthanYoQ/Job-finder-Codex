import { createCipheriv } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createMokaSourceFetch,
  type MokaEncryptedResponse,
  type MokaHttpClient,
  type MokaHttpResponse
} from "../../src/crawler/mokaSourceFetch";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const aesIv = "de7c21ed8d6f50fe";
const necromancer = "6e9ecb8e9c6c1a5e";
const capturedAt = "2026-07-10T09:00:00.000Z";
const entryUrl = "https://app.mokahr.com/apply/beigene/98934?sourceToken=top-secret#/jobs";
const apiUrl = "https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2";

const plan: SourceCrawlPlan = {
  adapterId: "official-json",
  company: { id: "company-beigene", officialChineseName: "百济神州" },
  source: {
    id: "source-beigene-social",
    companyId: "company-beigene",
    kind: "SOCIAL",
    atsKind: "MOKA",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: entryUrl,
    officialChainEvidenceUrl: "https://www.beonemedicines.com.cn/careers/careers/"
  },
  json: {
    jobsPath: "data.jobs",
    fields: {
      sourceJobId: "id",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  }
};

function initHtml(): string {
  const value = JSON.stringify({
    aesIv,
    mode: "social",
    siteId: "98934",
    org: { id: "beigene", siteId: 98934 }
  }).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<input id="init-data" value="${value}">`;
}

function encryptedBody(payload: unknown): string {
  return encryptedPlain(JSON.stringify(payload));
}

function encryptedPlain(value: string): string {
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(necromancer), Buffer.from(aesIv));
  let data = cipher.update(value, "utf8", "base64");
  data += cipher.final("base64");
  const envelope: MokaEncryptedResponse = { data, necromancer };
  return JSON.stringify(envelope);
}

function response(body: string, kind: "entry" | "api", overrides: Partial<MokaHttpResponse> = {}): MokaHttpResponse {
  return {
    status: 200,
    body,
    finalUrl: kind === "entry" ? "https://app.mokahr.com/apply/beigene/98934#/jobs" : apiUrl,
    contentType: kind === "entry" ? "text/html; charset=utf-8" : "application/json",
    capturedAt,
    ...overrides
  };
}

function job(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    title: `Role ${id}`,
    locations: [{ cityName: "上海市", provinceName: "上海市", country: "中国" }],
    ...overrides
  };
}

function clientForPages(pages: unknown[]): { http: MokaHttpClient; rawBodies: string[] } {
  const rawBodies = pages.map((payload) => encryptedBody(payload));
  let apiIndex = 0;
  return {
    rawBodies,
    http: async (request) => request.method === "GET"
      ? response(initHtml(), "entry")
      : response(rawBodies[apiIndex++]!, "api")
  };
}

describe("Moka strict fetch evidence", () => {
  it("retains entry and every encrypted page while completeness remains manual", async () => {
    const firstJobs = Array.from({ length: 50 }, (_, index) => job(`job-${index}`));
    const { http, rawBodies } = clientForPages([
      { success: true, data: { jobStats: { total: 51 }, offset: 0, jobs: firstJobs } },
      { success: true, data: { jobStats: { total: 51 }, offset: 50, jobs: [job("job-50")] } }
    ]);

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 51,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        pagesVisited: 2
      },
      fetchEvidence: {
        captureTool: { name: "moka-http", version: "1" },
        fetchCounts: { rawCount: 51, parsedCount: 51, validCount: 51, parseDiscardCount: 0, validationDiscardCount: 0 }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected Moka evidence");
    expect(result.fetchEvidence.artifacts).toHaveLength(3);
    expect(result.fetchEvidence.artifacts[0]).toMatchObject({
      logicalKey: "moka-entry-0000",
      kind: "OFFICIAL_COMPANY_PAGE",
      body: initHtml()
    });
    expect(result.fetchEvidence.artifacts.slice(1).map((artifact) => artifact.body)).toEqual(rawBodies);
    expect(result.fetchEvidence.pages.map((page) => page.termination)).toEqual([
      "CONTINUE",
      "DECLARED_TOTAL_REACHED"
    ]);
    expect(result.fetchEvidence.pages.every((page) => page.declaredPages === null)).toBe(true);
    expect(result.fetchEvidence.declaredCompleteness).toMatchObject({
      artifactLogicalKey: "moka-page-0000",
      extractorLocator: expect.stringContaining("init:moka-entry-0000|decrypt:aes-128-cbc-v1|json:$.data.jobStats.total")
    });
  });

  it.each(["finalUrl", "contentType", "capturedAt"] as const)(
    "fails closed when injected entry metadata omits %s",
    async (field) => {
      const missing = response(initHtml(), "entry");
      delete missing[field];
      const result = await createMokaSourceFetch({
        http: async () => missing,
        now: () => new Date(capturedAt)
      })(plan);
      expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining("evidence metadata") });
    }
  );

  it.each([
    ["entry", "application/json"],
    ["api", "text/html; charset=utf-8"],
    ["entry", "application/octet-stream"],
    ["api", "text/plain"]
  ] as const)("fails closed when %s Content-Type is %s", async (target, contentType) => {
    const http: MokaHttpClient = async (request) => request.method === "GET"
      ? response(initHtml(), "entry", target === "entry" ? { contentType } : {})
      : response(
          encryptedBody({ success: true, data: { jobStats: { total: 1 }, jobs: [job("job-1")] } }),
          "api",
          target === "api" ? { contentType } : {}
        );
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining("Content-Type") });
  });

  it.each([
    ["entry host", "entry", "https://evil.example/apply/beigene/98934", capturedAt],
    ["entry path", "entry", "https://app.mokahr.com/apply/other/00000", capturedAt],
    ["API host", "api", "https://evil.example/api/outer/ats-apply/website/jobs/v2", capturedAt],
    ["API path", "api", "https://app.mokahr.com/api/other", capturedAt],
    ["captured before crawl", "entry", "https://app.mokahr.com/apply/beigene/98934", "2026-07-10T08:59:59.000Z"],
    ["captured in future", "entry", "https://app.mokahr.com/apply/beigene/98934", "2026-07-10T09:10:01.000Z"]
  ] as const)("fails closed for invalid response metadata: %s", async (_label, target, finalUrl, responseTime) => {
    let nowCalls = 0;
    const now = () => new Date(nowCalls++ === 0 ? capturedAt : "2026-07-10T09:10:00.000Z");
    const http: MokaHttpClient = async (request) => request.method === "GET"
      ? response(initHtml(), "entry", target === "entry" ? { finalUrl, capturedAt: responseTime } : {})
      : response(
          encryptedBody({ success: true, data: { jobStats: { total: 1 }, jobs: [job("job-1")] } }),
          "api",
          target === "api" ? { finalUrl, capturedAt: responseTime } : {}
        );
    const result = await createMokaSourceFetch({ http, now })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringMatching(/final URL|captured time/i) });
  });

  it.each(["entry", "api"] as const)("rejects a non-default :444 %s final URL origin", async (target) => {
    const finalUrl = target === "entry"
      ? "https://app.mokahr.com:444/apply/beigene/98934"
      : "https://app.mokahr.com:444/api/outer/ats-apply/website/jobs/v2";
    const http: MokaHttpClient = async (request) => request.method === "GET"
      ? response(initHtml(), "entry", target === "entry" ? { finalUrl } : {})
      : response(
          encryptedBody({ success: true, data: { jobStats: { total: 1 }, jobs: [job("job-1")] } }),
          "api",
          target === "api" ? { finalUrl } : {}
        );
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining("final URL") });
  });

  it("fails closed when response captured times decrease across pages", async () => {
    const pageBodies = [
      encryptedBody({ success: true, data: { jobStats: { total: 51 }, jobs: Array.from({ length: 50 }, (_, index) => job(`job-${index}`)) } }),
      encryptedBody({ success: true, data: { jobStats: { total: 51 }, jobs: [job("job-50")] } })
    ];
    let apiIndex = 0;
    let nowCalls = 0;
    const result = await createMokaSourceFetch({
      now: () => new Date(nowCalls++ === 0 ? capturedAt : "2026-07-10T09:10:00.000Z"),
      http: async (request) => request.method === "GET"
        ? response(initHtml(), "entry", { capturedAt })
        : response(pageBodies[apiIndex]!, "api", {
            capturedAt: apiIndex++ === 0 ? "2026-07-10T09:00:02.000Z" : "2026-07-10T09:00:01.000Z"
          })
    })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringMatching(/captured time.*non-decreasing/i) });
  });

  it.each([
    ["$.data.total", { total: 1, jobs: [job("job-1")] }],
    ["$.data.count", { count: 1, jobs: [job("job-1")] }]
  ])("binds official total to the actual %s path and raw artifact key", async (jsonPath, data) => {
    const { http } = clientForPages([{ success: true, data }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.fetchEvidence?.declaredCompleteness) throw new Error("Expected total evidence");
    const locator = result.fetchEvidence.declaredCompleteness.extractorLocator;
    expect(locator).toContain("raw:moka-page-0000");
    expect(locator).toContain("request:offset=0,limit=50");
    expect(locator).toContain(`json:${jsonPath}`);
    expect(result.fetchEvidence.artifacts[1]?.extractorLocator).toBe(locator);
  });

  it("does not invent returned offset/page and records offset-only request coordinates", async () => {
    const { http } = clientForPages([{ success: true, data: { jobStats: { total: 1 }, jobs: [job("job-1")] } }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected page evidence");
    expect(result.fetchEvidence.pages[0]).toMatchObject({
      requestedOffset: 0,
      returnedOffset: null,
      requestedPage: null,
      returnedPage: null,
      requestedPageSize: 50,
      returnedPageSize: null
    });
    expect(result.fetchEvidence.artifacts[1]?.extractorLocator).toContain("request:offset=0,limit=50");
  });

  it("uses shared D1 to reject a same-page returned offset mismatch", async () => {
    const { http } = clientForPages([{
      success: true,
      data: { jobStats: { total: 1 }, offset: 50, jobs: [job("job-1")] }
    }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({
      ok: false,
      paginationEvaluation: { derivedAnomalyCodes: ["OFFSET_NOT_ADVANCING"] },
      fetchEvidence: { pages: [{ anomalyCodes: ["OFFSET_NOT_ADVANCING"] }] }
    });
  });

  it.each(["finalUrl", "contentType", "capturedAt"] as const)(
    "fails closed when injected API metadata omits %s",
    async (field) => {
      const api = response(encryptedBody({ success: true, data: { jobStats: { total: 1 }, jobs: [job("job-1")] } }), "api");
      delete api[field];
      const result = await createMokaSourceFetch({
        http: async (request) => request.method === "GET" ? response(initHtml(), "entry") : api,
        now: () => new Date(capturedAt)
      })(plan);
      expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining("evidence metadata") });
    }
  );

  it("derives total-change and offset regression only through D1 and fails closed with evidence", async () => {
    const firstJobs = Array.from({ length: 50 }, (_, index) => job(`job-${index}`));
    const { http } = clientForPages([
      { success: true, data: { jobStats: { total: 52 }, offset: 100, jobs: firstJobs } },
      { success: true, data: { jobStats: { total: 51 }, offset: 0, jobs: [job("job-50")] } }
    ]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);

    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { pages: [{ anomalyCodes: ["OFFSET_NOT_ADVANCING"] }, { anomalyCodes: expect.arrayContaining(["TOTAL_CHANGED", "OFFSET_NOT_ADVANCING"]) }] },
      paginationEvaluation: {
        safeCompleteness: false,
        derivedAnomalyCodes: expect.arrayContaining(["TOTAL_CHANGED", "OFFSET_NOT_ADVANCING"])
      }
    });
  });

  it("records parse and validation losses and fails when declared total no longer matches valid IDs", async () => {
    const { http } = clientForPages([{
      success: true,
      data: {
        jobStats: { total: 4 },
        jobs: ["not-an-object", job("", { id: "" }), job("foreign", { locations: [{ cityName: "Boston", country: "美国" }] }), job("job-1")]
      }
    }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);

    expect(result).toMatchObject({
      ok: false,
      failureReason: "Moka declared total does not match unique raw and hydrated valid job IDs",
      fetchEvidence: {
        fetchCounts: { rawCount: 4, parsedCount: 3, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 2 },
        fetchLosses: [
          { stage: "PARSE", details: { code: "NON_OBJECT_RECORD" } },
          { stage: "VALIDATION", details: { code: "MISSING_REQUIRED_FIELD", field: "id" } },
          { stage: "VALIDATION", details: { code: "OUT_OF_SCOPE" } }
        ]
      }
    });
    if (!result.fetchEvidence) throw new Error("Expected loss evidence");
    expect(result.fetchEvidence.fetchLosses.every((loss) => /sha256:[0-9a-f]{64}$/.test(loss.rawLocator))).toBe(true);
  });

  it("fails closed on credential losses without classifying the ordinary title Token Engineer as sensitive", async () => {
    const { http } = clientForPages([{
      success: true,
      data: {
        jobStats: { total: 21 },
        jobs: [
          job("Bearer example-placeholder"),
          job("token=raw-token"),
          job("session=raw-session"),
          job("job-title-secret", { title: "Bearer example-placeholder" }),
          job("job-secret-assignment", { title: "secret=title-secret" }),
          job("job-location-secret", { locations: [{ cityName: "password=hunter2", country: "中国" }] }),
          job("job-credential-location", { locations: [{ cityName: "credential=location-secret", country: "中国" }] }),
          job("source_Token=source-secret"),
          job("api-key=api-secret"),
          job("client-secret=client-secret-value"),
          job("jwt=jwt-secret"),
          job("x_api_key=x-api-secret"),
          job("sourceToken%3Dencoded-secret"),
          job("AUTH=auth-secret"),
          job("job-passwd", { title: "passwd=title-secret" }),
          job("job-pwd", { title: "PWD=title-secret" }),
          job("job-bearer", { locations: [{ cityName: "bearer=location-secret", country: "中国" }] }),
          job("job-basic", { locations: [{ cityName: "BASIC=location-secret", country: "中国" }] }),
          job("job-api-dot", { locations: [{ cityName: "api.key=location-secret", country: "中国" }] }),
          job("api%2Ekey%3Dencoded-api-secret"),
          job("ordinary-job", { title: "Token Engineer" })
        ]
      }
    }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result.ok).toBe(false);
    if (!result.fetchEvidence) throw new Error("Expected sanitized failure evidence");
    expect(result.fetchEvidence.fetchCounts).toMatchObject({ rawCount: 21, parsedCount: 21, validCount: 1, validationDiscardCount: 20 });
    expect(result.fetchEvidence.fetchLosses).toHaveLength(20);
  });

  it("rejects one- and two-layer percent-encoded fullwidth credential assignments", async () => {
    const fullwidthAssignment = "ａｐｉ．ｋｅｙ＝aaa111";
    const onceEncoded = encodeURIComponent(fullwidthAssignment);
    const twiceEncoded = encodeURIComponent(onceEncoded);
    const { http } = clientForPages([{
      success: true,
      data: {
        jobStats: { total: 3 },
        jobs: [
          job(onceEncoded),
          job("job-fullwidth-location", { locations: [{ cityName: twiceEncoded, country: "中国" }] }),
          job("ordinary-token-title", { title: "Token Engineer" })
        ]
      }
    }]);

    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);

    expect(result.ok).toBe(false);
    if (!result.fetchEvidence) throw new Error("Expected sanitized failure evidence");
    expect(result.fetchEvidence.fetchCounts).toMatchObject({
      rawCount: 3,
      parsedCount: 3,
      validCount: 1,
      validationDiscardCount: 2
    });
  });

  it("retains the entry artifact when init data is invalid", async () => {
    const invalidEntry = "<html><body>missing init</body></html>";
    const result = await createMokaSourceFetch({
      http: async () => response(invalidEntry, "entry"),
      now: () => new Date(capturedAt)
    })(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ logicalKey: "moka-entry-0000", body: invalidEntry }],
        pages: [{ artifactLogicalKey: "moka-entry-0000", termination: "FAILED" }],
        fetchLosses: [{ stage: "PARSE", details: { code: "INVALID_INIT_DATA" } }]
      }
    });
  });

  it("retains raw evidence and records a duplicate official ID as validation loss", async () => {
    const { http } = clientForPages([{
      success: true,
      data: { jobStats: { total: 2 }, jobs: [job("duplicate-id"), job("duplicate-id", { title: "Second" })] }
    }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Moka declared total does not match unique raw and hydrated valid job IDs",
      fetchEvidence: {
        artifacts: [{}, { logicalKey: "moka-page-0000" }],
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 1, validationDiscardCount: 1 },
        fetchLosses: [{ stage: "VALIDATION", details: { code: "DUPLICATE_OFFICIAL_ID", field: "id" } }]
      }
    });
  });

  it("accepts explicit China country aliases while rejecting an explicit non-China country", async () => {
    const aliases = ["People's Republic of China", "PRC", "中国大陆", "Mainland China"];
    const { http } = clientForPages([{
      success: true,
      data: {
        jobStats: { total: 5 },
        jobs: [
          ...aliases.map((country, index) => job(`china-${index}`, { locations: [{ cityName: "Shanghai", country }] })),
          job("foreign", { locations: [{ cityName: "Boston", country: "United States" }] })
        ]
      }
    }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Moka declared total does not match unique raw and hydrated valid job IDs",
      fetchEvidence: {
        fetchCounts: { rawCount: 5, parsedCount: 5, validCount: 4, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "OUT_OF_SCOPE" } }]
      }
    });
  });

  it("fails closed on a repeated encrypted response and repeated ID set using D1 labels", async () => {
    const repeated = {
      success: true,
      data: {
        jobStats: { total: 100 },
        offset: 0,
        jobs: Array.from({ length: 50 }, (_, index) => job(`job-${index}`))
      }
    };
    const { http } = clientForPages([repeated, repeated]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({
      ok: false,
      paginationEvaluation: {
        derivedAnomalyCodes: expect.arrayContaining([
          "REPEATED_RESPONSE_FINGERPRINT",
          "REPEATED_JOB_ID_SET_WITH_NEXT"
        ])
      }
    });
    if (!result.fetchEvidence) throw new Error("Expected retained repeated-page evidence");
    expect(result.fetchEvidence.artifacts).toHaveLength(3);
  });

  it("retains and rejects an intermediate empty page through D1", async () => {
    const { http } = clientForPages([
      { success: true, data: { jobStats: { total: 51 }, jobs: Array.from({ length: 50 }, (_, index) => job(`job-${index}`)) } },
      { success: true, data: { jobStats: { total: 51 }, jobs: [] } },
      { success: true, data: { jobStats: { total: 51 }, jobs: [job("job-50")] } }
    ]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { pages: [{}, { termination: "CONTINUE", anomalyCodes: ["INTERMEDIATE_EMPTY_PAGE"] }, {}] },
      paginationEvaluation: { derivedAnomalyCodes: expect.arrayContaining(["INTERMEDIATE_EMPTY_PAGE"]) }
    });
  });

  it("retains page 100 and rejects max-page-with-next through D1", async () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({
      success: true,
      data: { jobStats: { total: 101 }, offset: index * 50, jobs: [job(`job-${index}`)] }
    }));
    const { http } = clientForPages(pages);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({
      ok: false,
      paginationEvaluation: { derivedAnomalyCodes: expect.arrayContaining(["MAX_PAGES_WITH_NEXT"]) }
    });
    if (!result.fetchEvidence) throw new Error("Expected max-page evidence");
    expect(result.fetchEvidence.pages).toHaveLength(100);
    expect(result.fetchEvidence.pages[99]).toMatchObject({
      termination: "MAX_PAGE_LIMIT", anomalyCodes: ["INTERMEDIATE_SHORT_PAGE", "MAX_PAGES_WITH_NEXT"]
    });
  });

  it.each([
    ["invalid envelope", "{}", "INVALID_ENVELOPE"],
    ["decryption failure", JSON.stringify({ data: "not-base64", necromancer: "short" }), "DECRYPTION_FAILED"],
    ["invalid decrypted JSON", encryptedPlain("not-json"), "INVALID_DECRYPTED_JSON"],
    ["invalid record collection", encryptedBody({ success: true, data: { jobStats: { total: 1 } } }), "INVALID_RECORD_COLLECTION"]
  ])("retains strict raw evidence for %s", async (_label, body, code) => {
    const http: MokaHttpClient = async (request) => request.method === "GET"
      ? response(initHtml(), "entry")
      : response(body, "api");
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{}, { body }],
        pages: [{ termination: "FAILED" }],
        fetchCounts: { rawCount: 1, parsedCount: 0, validCount: 0, parseDiscardCount: 1, validationDiscardCount: 0 },
        fetchLosses: [{ stage: "PARSE", details: { code } }]
      }
    });
  });

  it("does not serialize cookies, tokens, headers, or decryption material outside opaque artifact bodies", async () => {
    const { http } = clientForPages([{
      success: true,
      data: {
        jobStats: { total: 1 },
        jobs: [job("job-1", { authorization: "example-placeholder", sessionToken: "payload-token" })]
      }
    }]);
    const result = await createMokaSourceFetch({ http, now: () => new Date(capturedAt) })(plan);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.fetchEvidence || !("payload" in result)) throw new Error("Expected Moka evidence");
    const redactedEvidence = {
      ...result.fetchEvidence,
      artifacts: result.fetchEvidence.artifacts.map(({ body: _body, ...metadata }) => metadata)
    };
    const serialized = JSON.stringify({ payload: result.payload, completeness: result.completeness, redactedEvidence });
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain(aesIv);
    expect(serialized).not.toContain(necromancer);
    expect(serialized.toLowerCase()).not.toContain("cookie");
    expect(serialized.toLowerCase()).not.toContain("authorization");
    expect(serialized).not.toContain("payload-secret");
    expect(serialized).not.toContain("payload-token");
    expect(JSON.stringify(result.payload)).not.toContain("sourceToken");
  });
});
