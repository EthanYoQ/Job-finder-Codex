import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  defaultHcmCloudBrowserFetch,
  type HcmCloudBrowserSession,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { createSourceFetchAttemptTracker, runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createSourceFetchRouter } from "../../src/crawler/sourceFetchRouter";
import { runWithOfficialSourceAttemptTimeout } from "../../src/crawler/officialHttpRuntimeLimits";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const START = "2026-07-08T00:00:00.000Z";
const ENTRY = "https://hcm.lunan.com.cn/recruit";
const COUNT = "https://hcm.lunan.com.cn/api/hcm.model.count?model=ReleaseJobMgr";
const LIST = "https://hcm.lunan.com.cn/api/hcm.model.list?model=ReleaseJobMgr";

const plan = {
  adapterId: "official-json",
  company: { id: "company-lunan", officialChineseName: "鲁南制药集团股份有限公司" },
  source: {
    id: "source-lunan-social", companyId: "company-lunan", kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON", status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: ENTRY, officialChainEvidenceUrl: ENTRY
  },
  json: { jobsPath: "jobs", fields: { sourceJobId: "sourceJobId", officialTitle: "title",
    officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" } },
  officialJsonFetch: { kind: "hcm-cloud", pageSize: 2, maxPages: 5 }
} satisfies SourceCrawlPlan;

function encoded(payload: unknown): string {
  const base64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
  return JSON.stringify({ hcm_transfer_strategy: "hb5",
    hcm_param: `rsp${base64.replace(/[5a]/gu, (v) => v === "5" ? "a" : "!")}` });
}

function response(url: string, payload: unknown, capturedAt: string): OfficialJsonHttpResponse {
  return { status: 200, body: encoded(payload), finalUrl: url,
    contentType: "application/json; charset=utf-8", capturedAt };
}

function browserSession(overrides: Partial<HcmCloudBrowserSession> = {}): HcmCloudBrowserSession {
  return {
    entryResponse: { status: 200, body: "<html>official</html>", finalUrl: ENTRY,
      contentType: "text/html; charset=utf-8", capturedAt: "2026-07-08T00:00:00.100Z" },
    post: async (endpoint) => endpoint === "count"
      ? response(COUNT, { result: { list: [{ count__id: 1 }] } }, "2026-07-08T00:00:00.200Z")
      : response(LIST, { result: { page_index: 1, list: [{ id: "1", name: "医学专员", work_city: "上海市" }] } },
        "2026-07-08T00:00:00.300Z"),
    close: async () => undefined,
    ...overrides
  };
}

function clock(): () => Date {
  let calls = 0;
  return () => new Date(calls++ === 0 ? START : "2026-07-08T00:00:01.000Z");
}

describe("HCM Cloud browser transport evidence instrumentation", () => {
  it("does not import or launch a browser when the company attempt already expired", async () => {
    if (plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "hcm-cloud") {
      throw new Error("HCM Cloud plan expected");
    }
    const controller = new AbortController();
    const reason = new Error("company attempt already expired");
    controller.abort(reason);
    await expect(defaultHcmCloudBrowserFetch({
      config: plan.officialJsonFetch,
      entryUrl: ENTRY,
      capturedAt: START,
      signal: controller.signal
    })).rejects.toBe(reason);
  });

  it("passes the company abort signal into browser transport and closes an active session", async () => {
    let closed = 0;
    let receivedSignal: AbortSignal | undefined;
    const fetcher = createOfficialJsonSourceFetch({
      now: clock(),
      http: async () => ({ status: 500, body: "{}", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async ({ signal }) => {
        receivedSignal = signal;
        return browserSession({
          post: async () => new Promise<OfficialJsonHttpResponse>((_resolve, reject) => {
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
          close: async () => { closed += 1; }
        });
      }
    });
    await expect(runWithOfficialSourceAttemptTimeout(() => Promise.resolve(fetcher(plan)), 25))
      .rejects.toMatchObject({ code: "OFFICIAL_SOURCE_ATTEMPT_TIMEOUT" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(receivedSignal?.aborted).toBe(true);
    expect(closed).toBe(1);
  });

  it("closes a browser handle even when the injected session shape is invalid", async () => {
    let closed = 0;
    const result = await createOfficialJsonSourceFetch({
      now: clock(),
      http: async () => ({ status: 503, body: "{}", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async () => ({ close: async () => { closed += 1; } }) as never
    })(plan);

    expect(result).toMatchObject({ ok: false, failureReason: "HCMCloud browser session failed" });
    expect(closed).toBe(1);
  });

  it("routes constrained browser responses through the shared manual builder and preserves direct evidence", async () => {
    const directBody = JSON.stringify({ errcode: 17003 });
    let directEvidence: unknown;
    const directOnly = createOfficialJsonSourceFetch({ now: clock(),
      http: async () => ({ status: 500, body: directBody, finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }) });
    const direct = await directOnly(plan);
    if (direct.ok || !direct.fetchEvidence) throw new Error("expected direct failure evidence");
    directEvidence = direct.fetchEvidence;

    const fetcher = createOfficialJsonSourceFetch({ now: clock(),
      http: async () => ({ status: 500, body: directBody, finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async () => browserSession() });
    const result = await fetcher(plan);
    expect(result).toMatchObject({ ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 1 },
      fetchEvidence: { artifacts: [
        { logicalKey: "browser-hcm-entry-0000", kind: "OFFICIAL_COMPANY_PAGE" },
        { logicalKey: "browser-hcm-count-0000", kind: "ATS_API_RESPONSE" },
        { logicalKey: "browser-hcm-list-0001", kind: "PAGINATION_PAGE" }
      ] },
      priorTransportAttempts: [
        { transport: "DIRECT_HTTP", outcome: "FAILED", code: "HCM_DIRECT_FAILED" },
        { transport: "BROWSER_SESSION", outcome: "SUCCEEDED", code: "HCM_BROWSER_SUCCEEDED" }
      ]
    });
    expect(result.priorTransportAttempts?.[1]).toMatchObject({
      transport: "BROWSER_SESSION", outcome: "SUCCEEDED", code: "HCM_BROWSER_SUCCEEDED"
    });
    expect(result.priorTransportAttempts?.[0]?.fetchEvidence).toEqual(directEvidence);
    expect(result.priorTransportAttempts?.[0]?.fetchEvidence).not.toBe(result.fetchEvidence);
    expect(result.fetchEvidence?.artifacts.map((a) => a.capturedAt)).toEqual([
      "2026-07-08T00:00:00.100Z", "2026-07-08T00:00:00.200Z", "2026-07-08T00:00:00.300Z"
    ]);
    const crawled = await runSourceCrawl(plan, { fetch: async () => result });
    expect(crawled.fetchEvidence).toBe(result.fetchEvidence);
    expect(crawled.priorTransportAttempts).toBe(result.priorTransportAttempts);
  });

  it("retains direct and browser attempt evidence on browser failure and closes the session", async () => {
    let closed = 0;
    const session = browserSession({
      post: async (endpoint) => endpoint === "count"
        ? response(COUNT, { result: { list: [{ count__id: 1 }] } }, "2026-07-08T00:00:00.200Z")
        : ({ status: 503, body: "upstream Authorization: Bearer example-placeholder", finalUrl: LIST,
          contentType: "application/json", capturedAt: "2026-07-08T00:00:00.300Z" }),
      close: async () => { closed += 1; }
    });
    const result = await createOfficialJsonSourceFetch({ now: clock(),
      http: async () => ({ status: 500, body: "direct-cookie=secret", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async () => session })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HCMCloud browser list failed",
      fetchEvidence: { artifacts: [
        { kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "ATS_API_RESPONSE" }, { kind: "PAGINATION_PAGE" }
      ] }, priorTransportAttempts: [
        { code: "HCM_DIRECT_FAILED" },
        { transport: "BROWSER_SESSION", outcome: "FAILED", code: "HCM_BROWSER_LIST_FAILED" }
      ] });
    expect(closed).toBe(1);
    const redacted = JSON.parse(JSON.stringify(result)) as {
      fetchEvidence?: { artifacts: Array<Record<string, unknown>> };
      priorTransportAttempts?: Array<{ fetchEvidence?: { artifacts: Array<Record<string, unknown>> } }>;
    };
    redacted.fetchEvidence?.artifacts.forEach((artifact) => { delete artifact.body; });
    redacted.priorTransportAttempts?.forEach((attempt) =>
      attempt.fetchEvidence?.artifacts.forEach((artifact) => { delete artifact.body; }));
    expect(JSON.stringify(redacted)).not.toMatch(/Bearer|secret-value|cookie/i);
  });

  it("closes a browser session when shared validation rejects backward metadata", async () => {
    let closed = 0;
    const result = await createOfficialJsonSourceFetch({ now: clock(),
      http: async () => ({ status: 500, body: "{}", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async () => browserSession({
        post: async () => response(COUNT, { result: { list: [{ count__id: 1 }] } }, START),
        close: async () => { closed += 1; }
      }) })(plan);
    expect(result).toMatchObject({ ok: false, failureReason: "HCMCloud browser count failed" });
    expect(closed).toBe(1);
  });

  it("classifies a thrown browser list transport separately and retains entry plus count evidence", async () => {
    const result = await createOfficialJsonSourceFetch({ now: clock(),
      http: async () => ({ status: 500, body: "{}", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async () => browserSession({
        post: async (endpoint) => {
          if (endpoint === "list") throw new Error("Authorization: Bearer example-placeholder");
          return response(COUNT, { result: { list: [{ count__id: 1 }] } }, "2026-07-08T00:00:00.200Z");
        }
      }) })(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "HCMCloud browser list failed",
      fetchEvidence: {
        artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "ATS_API_RESPONSE" }],
        supportingArtifactOnlyFailure: { code: "HCM_LIST_RESPONSE_FAILED" }
      }
    });
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });

  it.each([
    ["final URL mismatch", { finalUrl: "https://hcm.lunan.com.cn/other" }],
    ["backward capture", { capturedAt: "2026-07-07T23:59:59.999Z" }]
  ])("retains a strict current browser entry artifact on %s", async (_label, metadata) => {
    const result = await createOfficialJsonSourceFetch({ now: clock(),
      http: async () => ({ status: 500, body: "direct", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async () => browserSession({
        entryResponse: { ...browserSession().entryResponse, ...metadata }
      }) })(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "HCMCloud browser entry failed",
      fetchEvidence: {
        artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE", body: "<html>official</html>" }],
        pages: [],
        supportingArtifactOnlyFailure: { code: "HCM_BROWSER_ENTRY_FAILED" }
      },
      priorTransportAttempts: [
        { code: "HCM_DIRECT_FAILED" },
        { code: "HCM_BROWSER_ENTRY_FAILED", outcome: "FAILED" }
      ]
    });
    expect(result.fetchEvidence).not.toBe(result.priorTransportAttempts?.[0]?.fetchEvidence);
  });

  it.each(["contentType", "capturedAt"] as const)(
    "fails safely without a fake current artifact when browser entry is missing %s",
    async (missingField) => {
      const incomplete = { ...browserSession().entryResponse } as Record<string, unknown>;
      delete incomplete[missingField];
      const result = await createOfficialJsonSourceFetch({ now: clock(),
        http: async () => ({ status: 500, body: "direct", finalUrl: COUNT,
          contentType: "application/json", capturedAt: START }),
        hcmCloudBrowserFetch: async () => browserSession({ entryResponse: incomplete as never })
      })(plan);
      expect(result).toMatchObject({
        ok: false,
        failureReason: "HCMCloud browser entry failed",
        priorTransportAttempts: [
          { code: "HCM_DIRECT_FAILED" },
          { code: "HCM_BROWSER_ENTRY_FAILED", outcome: "FAILED" }
        ]
      });
      expect(result.fetchEvidence).toBeUndefined();
      expect(result.priorTransportAttempts).toHaveLength(2);
      expect(JSON.stringify(result)).not.toMatch(/Zod|network artifact requires|invalid_type|contentType.*Required|capturedAt.*Required/i);
    }
  );

  it("does not open a browser for direct parse, pagination, or completeness failures", async () => {
    let browserCalls = 0;
    const malformed = createOfficialJsonSourceFetch({
      now: clock(),
      http: async () => ({ status: 200, body: "not-hcm-json", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }),
      hcmCloudBrowserFetch: async () => { browserCalls += 1; return browserSession(); }
    });

    await expect(malformed(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "HCMCloud count response decode failed"
    });
    expect(browserCalls).toBe(0);
  });

  it("treats the bounded direct-to-browser route as one outer attempt", async () => {
    let directCalls = 0;
    let browserCalls = 0;
    const hcm = createOfficialJsonSourceFetch({
      now: clock(),
      http: async () => { directCalls += 1; return { status: 503, body: "{}", finalUrl: COUNT,
        contentType: "application/json", capturedAt: START }; },
      hcmCloudBrowserFetch: async () => { browserCalls += 1; throw new Error("browser unavailable"); }
    });
    const routedPlan = { ...plan, transientRetryPolicy: { maxRetries: 2 as const, backoffMs: 1_000 } };
    const routed = createSourceFetchRouter({
      moka: hcm,
      officialJson: hcm,
      fallback: hcm,
      delay: async () => undefined
    });

    const attemptTracker = createSourceFetchAttemptTracker();
    const result = await routed(routedPlan, attemptTracker);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "HCMCloud browser session failed"
    });
    expect(attemptTracker).toEqual({ fetchAttemptCount: 1, retryCount: 0, retryReasonCodes: [] });
    expect(directCalls).toBe(1);
    expect(browserCalls).toBe(1);
  });
});
