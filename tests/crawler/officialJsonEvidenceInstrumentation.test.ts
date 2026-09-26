import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const capturedAt = "2026-07-10T12:00:00.000Z";
const innoventEndpoint = "https://www.innoventbio.com/api/jobs?limit=200";
const novoEndpoint =
  "https://www.novonordisk.com/bin/nncorp/careersearch?keyword=&country=China%20Mainland&category=&locale=en";

const basePlan = {
  adapterId: "official-json",
  company: { id: "company-test", officialChineseName: "测试公司" },
  source: {
    id: "source-test-social",
    companyId: "company-test",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://www.example.test/careers",
    officialChainEvidenceUrl: "https://www.example.test/careers"
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    }
  }
} satisfies SourceCrawlPlan;

function plan(kind: "innovent" | "novo-nordisk"): SourceCrawlPlan {
  return {
    ...basePlan,
    source: {
      ...basePlan.source,
      officialEntryUrl: kind === "innovent"
        ? "https://www.innoventbio.com/cn/recruit"
        : "https://www.novonordisk.com/careers/find-a-job.html"
    },
    officialJsonFetch: {
      kind,
      endpointUrl: kind === "innovent" ? innoventEndpoint : novoEndpoint
    }
  };
}

function response(
  body: string,
  endpoint: string,
  overrides: Partial<OfficialJsonHttpResponse> = {}
): OfficialJsonHttpResponse {
  return {
    status: 200,
    body,
    finalUrl: endpoint,
    contentType: "application/json; charset=utf-8",
    capturedAt,
    ...overrides
  };
}

function innoventJob(id: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, title: "医学经理", city: "上海", ...overrides };
}

function novoJob(id: unknown, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobId: id,
    jobTitle: "Medical Advisor",
    jobLocationLabel: "China Mainland, Beijing",
    jobCity: { label: "Beijing" },
    ...overrides
  };
}

function serializedWithoutOpaqueBodies(value: unknown): string {
  const clone = structuredClone(value) as {
    fetchEvidence?: { artifacts?: Array<Record<string, unknown>> };
  };
  for (const artifact of clone.fetchEvidence?.artifacts ?? []) artifact.body = "[OPAQUE]";
  return JSON.stringify(clone);
}

describe("Official JSON Innovent/Novo evidence instrumentation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("retains exact Innovent response evidence without treating limit=200 as exhaustion", async () => {
    const body = JSON.stringify({ data: [innoventJob("74")] });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, innoventEndpoint)
    });

    const result = await fetcher(plan("innovent"));
    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        pagesVisited: 1
      },
      fetchEvidence: {
        artifacts: [{ body, httpStatus: 200, contentType: "application/json; charset=utf-8" }],
        pages: [{
          requestedPage: null,
          returnedPage: null,
          requestedOffset: null,
          returnedOffset: null,
          declaredTotal: null,
          declaredPages: null,
          nextPageSignalAfter: null,
          termination: "ABORTED"
        }],
        fetchCounts: {
          rawCount: 1, parsedCount: 1, validCount: 1,
          parseDiscardCount: 0, validationDiscardCount: 0
        },
        fetchLosses: []
      },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
    if (!result.ok || !("payload" in result)) throw new Error("Expected payload");
    const jobs = (result.payload as { jobs: Array<Record<string, unknown>> }).jobs;
    expect(jobs[0]?.sourceJobId).toMatch(/^official-json:sha256:[0-9a-f]{64}$/);
    expect(jobs[0]?.officialUrl).toBe("https://www.innoventbio.com/cn/recruit/74");
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
  });

  it("uses a canonical sanitized clone for completenessEvidenceUrl without leaking entry query/hash", async () => {
    const scopedPlan = plan("innovent");
    scopedPlan.source.officialEntryUrl =
      "https://www.innoventbio.com/cn/recruit?campaign=summer#social-jobs";
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(JSON.stringify({ data: [innoventJob("1")] }), innoventEndpoint)
    });
    const result = await fetcher(scopedPlan);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.completeness?.completenessEvidenceUrl).toMatch(
      /^https:\/\/www\.innoventbio\.com\/cn\/recruit\?campaign=sha256%3A[0-9a-f]{64}$/
    );
    expect(JSON.stringify(result)).not.toContain("summer");
    expect(JSON.stringify(result)).not.toContain("social-jobs");
  });

  it.each([
    "https://user:placeholder@www.innoventbio.com/cn/recruit",
    "https://www.innoventbio.com/cn/recruit?campaign=apiKey%3Dabc123"
  ])("rejects unsafe official entry before transport without echoing it: %s", async (entryUrl) => {
    const scopedPlan = plan("innovent");
    scopedPlan.source.officialEntryUrl = entryUrl;
    const http = vi.fn(async () => response(JSON.stringify({ data: [innoventJob("1")] }), innoventEndpoint));
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(capturedAt), http })(scopedPlan);
    expect(result.ok).toBe(false);
    expect(http).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("abc123");
    expect(JSON.stringify(result)).not.toContain("password");
  });

  it.each([
    ["totalMatches", { totalMatches: 1 }],
    ["total", { total: 1 }]
  ] as const)("binds Novo official total to the actual $.data.%s path and closes a zero-loss response", async (path, total) => {
    const body = JSON.stringify({ data: { ...total, jobs: [novoJob("343573.en_GB")] } });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, novoEndpoint)
    });

    const result = await fetcher(plan("novo-nordisk"));
    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"
      },
      fetchEvidence: {
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: 1,
          scope: "SOURCE"
        },
        pages: [{ declaredTotal: 1, termination: "DECLARED_TOTAL_REACHED" }]
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected evidence");
    expect(result.fetchEvidence.declaredCompleteness?.extractorLocator).toContain(`json:$.data.${path}`);
    expect(result.fetchEvidence.artifacts[0]?.extractorLocator).toBe(
      result.fetchEvidence.declaredCompleteness?.extractorLocator
    );
    expect(result.fetchEvidence.declaredCompleteness?.extractorLocator).toContain("request:country=");
  });

  it("does not invent a Novo total when neither supported path exists", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(JSON.stringify({ data: { jobs: [novoJob("1")] } }), novoEndpoint)
    });
    const result = await fetcher(plan("novo-nordisk"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.completeness).toMatchObject({ completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" });
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
    expect(result.fetchEvidence?.pages[0]?.declaredTotal).toBeNull();
  });

  it("fails closed when injected response evidence metadata is missing", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => ({ status: 200, body: JSON.stringify({ data: [] }) })
    });
    await expect(fetcher(plan("innovent"))).resolves.toMatchObject({
      ok: false,
      failureReason: "Official JSON response is missing required evidence metadata"
    });
  });

  it.each([
    ["false final URL", { finalUrl: "https://evil.example.test/api/jobs?limit=200" }],
    ["time before crawl", { capturedAt: "2026-07-10T11:59:59.999Z" }],
    ["future time", { capturedAt: "2026-07-10T12:00:00.001Z" }]
  ])("fails closed on %s metadata", async (_label, override) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(JSON.stringify({ data: [innoventJob("1")] }), innoventEndpoint, override)
    });
    await expect(fetcher(plan("innovent"))).resolves.toMatchObject({ ok: false });
  });

  it("captures native final URL, MIME, and body-completion time without a second request", async () => {
    const body = JSON.stringify({ data: [innoventJob("1")] });
    const fetchMock = vi.fn(async () => ({
      status: 200,
      url: innoventEndpoint,
      headers: new Headers({ "content-type": "application/json" }),
      text: async () => body
    }));
    vi.stubGlobal("fetch", fetchMock);
    const fetcher = createOfficialJsonSourceFetch({ now: () => new Date(capturedAt) });
    const result = await fetcher(plan("innovent"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.fetchEvidence?.artifacts[0]).toMatchObject({
      body,
      finalUrl: expect.stringContaining("https://www.innoventbio.com/api/jobs"),
      contentType: "application/json",
      capturedAt
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retains exact raw response evidence for non-2xx, wrong MIME, and invalid JSON failures", async () => {
    const cases = [
      response("upstream failed", innoventEndpoint, { status: 503, contentType: "text/plain" }),
      response("<html>blocked</html>", innoventEndpoint, { contentType: "text/html" }),
      response("{not-json", innoventEndpoint)
    ];
    for (const item of cases) {
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async () => item
      });
      const result = await fetcher(plan("innovent"));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.fetchEvidence?.artifacts[0]?.body).toBe(item.body);
      expect(result.fetchEvidence?.pages[0]?.termination).toBe("FAILED");
    }
  });

  it("rejects credential-bearing MIME parameters before they enter persistent evidence", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(
        JSON.stringify({ data: [innoventJob("1")] }),
        innoventEndpoint,
        { contentType: "application/json; apiKey=abc123" }
      )
    });
    const result = await fetcher(plan("innovent"));
    expect(result.ok).toBe(false);
    expect(serializedWithoutOpaqueBodies(result)).not.toContain("abc123");
  });

  it("requires strict Innovent and Novo collection shapes and retains the response", async () => {
    for (const [kind, body, endpoint] of [
      ["innovent", JSON.stringify({ data: {} }), innoventEndpoint],
      ["novo-nordisk", JSON.stringify({ data: { jobs: {} } }), novoEndpoint]
    ] as const) {
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async () => response(body, endpoint)
      });
      const result = await fetcher(plan(kind));
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected failure");
      expect(result.fetchEvidence?.artifacts[0]?.body).toBe(body);
      expect(result.fetchEvidence?.pages[0]?.termination).toBe("FAILED");
    }
  });

  it("accounts every Innovent parse, field, duplicate, scope, unsafe-ID, and sensitive-output loss", async () => {
    const body = JSON.stringify({ data: [
      "not-object",
      innoventJob("missing-title", { title: "" }),
      innoventJob("ok"),
      innoventJob("ok"),
      innoventJob("outside", { city: "Boston, United States" }),
      innoventJob("../../unsafe"),
      innoventJob("secret", { title: "apiKey=abc123" })
    ] });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, innoventEndpoint)
    });
    const result = await fetcher(plan("innovent"));
    expect(result.ok).toBe(true);
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected evidence");
    expect(result.fetchEvidence.fetchCounts).toEqual({
      rawCount: 7, parsedCount: 6, validCount: 1,
      parseDiscardCount: 1, validationDiscardCount: 5
    });
    expect(result.fetchEvidence.fetchLosses.map((loss) => loss.details.code)).toEqual([
      "NON_OBJECT_RECORD", "MISSING_REQUIRED_FIELD", "DUPLICATE_OFFICIAL_ID",
      "OUT_OF_SCOPE", "UNSAFE_OFFICIAL_ID", "SENSITIVE_OUTPUT"
    ]);
    expect(result.fetchEvidence.fetchLosses.every((loss) => /sha256:[0-9a-f]{64}$/.test(loss.rawLocator))).toBe(true);
  });

  it("applies the same exact loss boundary to Novo records without promoting its total", async () => {
    const body = JSON.stringify({ data: { totalMatches: 5, jobs: [
      novoJob("valid"),
      novoJob("valid"),
      novoJob("missing", { jobTitle: "" }),
      novoJob("outside", { jobLocationLabel: "Boston, United States", jobCity: { label: "Boston" } }),
      novoJob("secret", { jobTitle: "clientSecret=abc123" })
    ] } });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, novoEndpoint)
    });
    const result = await fetcher(plan("novo-nordisk"));
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 5 },
      fetchEvidence: {
        fetchCounts: {
          rawCount: 5, parsedCount: 5, validCount: 1,
          parseDiscardCount: 0, validationDiscardCount: 4
        }
      }
    });
  });

  it("does not label a Novo total SOURCE-scoped when the request is not China Mainland", async () => {
    const unsafeScopeEndpoint = novoEndpoint.replace("China%20Mainland", "United%20States");
    const scopedPlan = {
      ...plan("novo-nordisk"),
      officialJsonFetch: { kind: "novo-nordisk", endpointUrl: unsafeScopeEndpoint }
    } as SourceCrawlPlan;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(
        JSON.stringify({ data: { totalMatches: 1, jobs: [novoJob("us", {
          jobLocationLabel: "Boston, United States",
          jobCity: { label: "Boston" }
        })] } }),
        unsafeScopeEndpoint
      )
    });
    const result = await fetcher(scopedPlan);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected manual result");
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
    expect(result.completeness?.expectedJobCount).toBeUndefined();
  });

  it.each([
    "country=China%20Mainland&country=China%20Mainland",
    "country=China%20Mainland&country=United%20States",
    "country=China%20Mainland&Country=China%20Mainland",
    "country=China%20Mainland&%EF%BD%83%EF%BD%8F%EF%BD%95%EF%BD%8E%EF%BD%94%EF%BD%92%EF%BD%99=China%20Mainland",
    "Country=China%20Mainland"
  ])("requires exactly one exact country key/value for Novo SOURCE scope: %s", async (countryQuery) => {
    const endpoint = `https://www.novonordisk.com/bin/nncorp/careersearch?keyword=&${countryQuery}&category=&locale=en`;
    const scopedPlan = {
      ...plan("novo-nordisk"),
      officialJsonFetch: { kind: "novo-nordisk", endpointUrl: endpoint }
    } as SourceCrawlPlan;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(JSON.stringify({ data: { totalMatches: 1, jobs: [novoJob("1")] } }), endpoint)
    });
    const result = await fetcher(scopedPlan);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected manual success");
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
    expect(result.completeness?.expectedJobCount).toBeUndefined();
    expect(result.completeness?.completenessEvidenceKind).toBe("WEAK_MANUAL_SAMPLE");
  });

  it.each([".", ".."])('rejects path-normalizing official ID "%s" as an exact validation loss', async (id) => {
    const body = JSON.stringify({ data: [innoventJob(id), innoventJob("valid")] });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, innoventEndpoint)
    });
    const result = await fetcher(plan("innovent"));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected success");
    expect(result.fetchEvidence?.fetchCounts).toMatchObject({ rawCount: 2, validCount: 1, validationDiscardCount: 1 });
    expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("UNSAFE_OFFICIAL_ID");
  });

  it.each([
    [{ totalMatches: "1", total: 1 }, "$.data.totalMatches"],
    [{ totalMatches: -1, total: 1 }, "$.data.totalMatches"],
    [{ totalMatches: 1.5, total: 1 }, "$.data.totalMatches"],
    [{ total: "1" }, "$.data.total"]
  ] as const)("fails schema validation when own-present %s is invalid", async (totals, expectedPath) => {
    const body = JSON.stringify({ data: { ...totals, jobs: [novoJob("1")] } });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, novoEndpoint)
    });
    const result = await fetcher(plan("novo-nordisk"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected schema failure");
    expect(result.failureReason).toContain(expectedPath);
    expect(result.fetchEvidence?.artifacts[0]?.body).toBe(body);
    expect(result.fetchEvidence?.pages[0]?.termination).toBe("FAILED");
  });

  it("keeps persistent evidence DTOs secret-free outside opaque artifact bodies", async () => {
    const rawSecret = "apiKey=abc123";
    const body = JSON.stringify({ data: [innoventJob("1", { title: rawSecret })] });
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, innoventEndpoint)
    });
    const result = await fetcher(plan("innovent"));
    expect(serializedWithoutOpaqueBodies(result)).not.toContain(rawSecret);
    expect(serializedWithoutOpaqueBodies(result)).not.toMatch(/apiKey/i);
  });

  it('keeps the legitimate title "Token Engineer" while rejecting assignment-shaped secrets', async () => {
    const body = JSON.stringify({ data: [
      innoventJob("valid", { title: "Token Engineer" }),
      innoventJob("secret", { title: "access_token=abc123" })
    ] });
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, innoventEndpoint)
    })(plan("innovent"));
    expect(result.ok).toBe(true);
    if (!result.ok || !("payload" in result)) throw new Error("Expected payload");
    expect((result.payload as { jobs: Array<{ title: string }> }).jobs.map((job) => job.title)).toEqual([
      "Token Engineer"
    ]);
    expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("SENSITIVE_OUTPUT");
  });

  it("maps raw transport failures to a fixed secret-safe reason", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => { throw new Error("fetch failed apiKey=abc123"); }
    });
    await expect(fetcher(plan("innovent"))).resolves.toEqual({
      ok: false,
      capturedAt,
      failureReason: "Official JSON TRANSPORT_FAILURE"
    });
  });

  it("marks a Novo network failure as retryable without retaining the raw error", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        throw Object.assign(new Error("socket reset apiKey=abc123"), { code: "ECONNRESET" });
      }
    });
    await expect(fetcher(plan("novo-nordisk"))).resolves.toMatchObject({
      ok: false,
      capturedAt,
      failureReason: "Official recruitment network request failed",
      transportFailure: { code: "OFFICIAL_NETWORK_ERROR", retryable: true }
    });
  });

  it("marks a Novo 503 response as retryable while preserving its failure evidence", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response("temporarily unavailable", novoEndpoint, { status: 503 })
    });
    await expect(fetcher(plan("novo-nordisk"))).resolves.toMatchObject({
      ok: false,
      failureReason: "Official recruitment endpoint was temporarily unavailable (HTTP 503)",
      transportFailure: { code: "OFFICIAL_HTTP_503", retryable: true },
      fetchEvidence: { pages: [{ termination: "FAILED" }] }
    });
  });

  it("preserves Official JSON evidence/evaluation through runSourceCrawl by exact reference", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(JSON.stringify({ data: [innoventJob("74")] }), innoventEndpoint)
    });
    const fetched = await fetcher(plan("innovent"));
    const crawled = await runSourceCrawl(plan("innovent"), { fetch: async () => fetched });
    expect(crawled.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(crawled.paginationEvaluation).toBe(fetched.paginationEvaluation);
  });

  it("preserves retained failure evidence through runSourceCrawl by exact reference", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response("{invalid", innoventEndpoint)
    });
    const fetched = await fetcher(plan("innovent"));
    expect(fetched.ok).toBe(false);
    const crawled = await runSourceCrawl(plan("innovent"), { fetch: async () => fetched });
    expect(crawled.status).toBe("FAILED");
    expect(crawled.fetchEvidence).toBe(fetched.fetchEvidence);
  });
});
