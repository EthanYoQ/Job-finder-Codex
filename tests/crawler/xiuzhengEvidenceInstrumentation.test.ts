import { describe, expect, it } from "vitest";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpRequest, type OfficialJsonHttpResponse } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-07-11T08:00:00.000Z";
const ENTRY = "https://www.xiuzheng.com/#/recruit";
const ENDPOINT = "https://www.xiuzheng.com/front/human-resource/job-list";

function plan(overrides: Record<string, unknown> = {}): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "xiuzheng", officialChineseName: "修正药业" },
    source: { id: "xiuzheng-official", companyId: "xiuzheng", kind: "SOCIAL", atsKind: "OFFICIAL_JSON", status: "VERIFIED_SCRAPABLE", officialEntryUrl: ENTRY, officialChainEvidenceUrl: "https://www.xiuzheng.com/" },
    json: { jobsPath: "jobs", fields: { sourceJobId: "sourceJobId", officialTitle: "title", officialUrl: "officialUrl", locationRaw: "locationRaw", cities: "cities" } },
    officialJsonFetch: { kind: "xiuzheng-job-list", endpointUrl: ENDPOINT, detailBaseUrl: "https://www.xiuzheng.com/#/recruitDetail", pageSize: 2, maxPages: 5, ...overrides }
  };
}

function response(body: string, overrides: Partial<OfficialJsonHttpResponse> = {}): OfficialJsonHttpResponse {
  return { status: 200, body, finalUrl: ENDPOINT, contentType: "application/json; charset=utf-8", capturedAt: NOW, ...overrides };
}

function row(id: unknown, name: unknown, overrides: Record<string, unknown> = {}) {
  return { id, name, ...overrides };
}

function body(page: number, rows: unknown[], total = rows.length, lastPage = 1, perPage = 2): string {
  return JSON.stringify({ code: 0, data: { current_page: page, last_page: lastPage, total, per_page: perPage, data: rows } });
}

function client(bodies: string[], pageSize = 2) {
  let call = 0;
  return async (request: OfficialJsonHttpRequest): Promise<OfficialJsonHttpResponse> => {
    expect(request).toMatchObject({ url: ENDPOINT, method: "POST", body: JSON.stringify({ page: call + 1, pageSize }) });
    return response(bodies[call++]!);
  };
}

describe("Xiuzheng job-list evidence instrumentation", () => {
  it("captures exact POST pages, accounts non-jobs and unknown scope, and remains manual through D1", async () => {
    const exact = [
      body(1, [row(17, "用人理念"), row(16, "研究员")], 3, 2),
      body(2, [row(5, "生产经理", { location: "上海" })], 3, 2)
    ];
    const fetched = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client(exact) })(plan());
    expect(fetched).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 3, pagesVisited: 2 },
      fetchEvidence: {
        artifacts: [{ logicalKey: "xiuzheng-page-0001", kind: "PAGINATION_PAGE", body: exact[0] }, { logicalKey: "xiuzheng-page-0002", kind: "PAGINATION_PAGE", body: exact[1] }],
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 2 },
        fetchLosses: [{ details: { code: "NON_RECRUITMENT_CONTENT" } }, { details: { code: "AMBIGUOUS_SCOPE" } }],
        pages: [
          { requestedPage: 1, returnedPage: 1, requestedPageSize: 2, returnedPageSize: 2,
            declaredTotal: 3, declaredPages: 2, termination: "CONTINUE" },
          { requestedPage: 2, returnedPage: 2, requestedPageSize: 2, returnedPageSize: 2, termination: "ABORTED" }
        ]
      },
      paginationEvaluation: { verifiedEligible: false, safeCompleteness: false }
    });
    if (!fetched.fetchEvidence || !fetched.paginationEvaluation) throw new Error("missing evidence");
    expect(fetched.fetchEvidence.artifacts.map((artifact) => artifact.bodyRepresentation)).toEqual(["EXACT", "EXACT"]);
    const result = await runSourceCrawl(plan(), { fetch: async () => fetched });
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetched.paginationEvaluation);
  });

  it("retains current and prior accounting when a later declaration drifts", async () => {
    const exact = [body(1, [row(1, "A", { location: "上海" }), row(2, "B", { location: "北京" })], 3, 2), body(2, [row(3, "C", { location: "广州" })], 4, 2)];
    let call = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact[call++]!) })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Xiuzheng pagination declaration is inconsistent", fetchEvidence: { artifacts: [{ body: exact[0] }, { body: exact[1] }], fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3 }, pages: [{ termination: "CONTINUE" }, { termination: "FAILED" }] } });
  });

  it.each([
    ["duplicate keys", '{"code":0,"data":{"current_page":1,"last_page":1,"total":0,"per_page":2,"data":[],"meta":{"x":1,"x":2}}}'],
    ["invalid code", JSON.stringify({ code: "0", data: { current_page: 1, last_page: 1, total: 0, per_page: 2, data: [] } })],
    ["invalid present total", JSON.stringify({ code: 0, data: { current_page: 1, last_page: 1, total: 0.5, per_page: 2, data: [] } })],
    ["capacity contradiction", body(1, [row(1, "A", { location: "上海" }), row(2, "B", { location: "北京" })], 1, 1)]
  ])("fails closed with the exact current artifact for %s", async (_label, exact) => {
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact) })(plan());
    expect(result).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ body: exact }], pages: [{ termination: "FAILED" }] } });
  });

  it.each([
    ["fractional pageSize", { pageSize: 1.5 }],
    ["zero maxPages", { maxPages: 0 }],
    ["endpoint query", { endpointUrl: `${ENDPOINT}?token=secret` }],
    ["wrong endpoint", { endpointUrl: "https://evil.example/front/human-resource/job-list" }],
    ["unsafe detail", { detailBaseUrl: "https://www.xiuzheng.com/#/recruitDetail?token=secret" }]
  ])("rejects invalid config before transport: %s", async (_label, overrides) => {
    let calls = 0;
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => { calls += 1; throw new Error("must not call"); } })(plan(overrides));
    expect(result).toMatchObject({ ok: false, failureReason: "Xiuzheng job-list configuration is invalid" });
    expect(calls).toBe(0);
  });

  it("records duplicate/conflicting IDs and unsafe detail identifiers as explicit losses", async () => {
    const rows = [row("a", "A", { location: "上海" }), row("a", "A", { location: "上海" }), row("a", "Changed", { location: "上海" }), row("../x", "Unsafe", { location: "上海" })];
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: client([body(1, rows, 4, 1, 4)], 4) })(plan({ pageSize: 4 }));
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 4, parsedCount: 4, validCount: 1, validationDiscardCount: 3 } } });
    expect(result.fetchEvidence?.fetchLosses.map((loss) => loss.details.code)).toEqual(["DUPLICATE_OFFICIAL_ID", "CONFLICTING_OFFICIAL_ID", "UNSAFE_OFFICIAL_ID"]);
  });

  it("accepts only safe positive integer or nonempty string IDs and string title/location fields", async () => {
    const rows = [
      row(1, "Valid", { location: "上海" }),
      row(0, "Zero", { location: "上海" }),
      row(true, "Boolean ID", { location: "上海" }),
      row(1.5, "Fractional ID", { location: "上海" }),
      row(Number.NaN, "NaN ID", { location: "上海" }),
      row(Number.POSITIVE_INFINITY, "Infinite ID", { location: "上海" }),
      row("s2", 42, { location: "上海" }),
      row("s3", true, { location: "上海" }),
      row("s4", "Numeric location", { location: 42 }),
      row("s5", "Boolean location", { location: false })
    ];
    const exact = body(1, rows, rows.length, 1, rows.length);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact) })(plan({ pageSize: rows.length }));
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { rawCount: 10, parsedCount: 10, validCount: 1, validationDiscardCount: 9 } } });
    expect(result.fetchEvidence?.fetchLosses.map((loss) => loss.details.code)).toEqual([
      "UNSAFE_OFFICIAL_ID", "UNSAFE_OFFICIAL_ID", "UNSAFE_OFFICIAL_ID", "UNSAFE_OFFICIAL_ID", "UNSAFE_OFFICIAL_ID",
      "MISSING_REQUIRED_FIELD", "MISSING_REQUIRED_FIELD", "AMBIGUOUS_SCOPE", "AMBIGUOUS_SCOPE"
    ]);
  });

  it.each([
    ["location token", { location: "上海 token=opaque-location-secret" }],
    ["work_place cookie", { work_place: "上海 cookie%253Dopaque-location-secret" }],
    ["address auth", { address: "上海 auth%3Dopaque-location-secret" }],
    ["NFKC secret", { location: "上海 ｓｅｃｒｅｔ＝opaque-location-secret" }]
  ])("rejects sensitive %s with a typed loss and no output leak", async (_label, coordinate) => {
    const secret = "opaque-location-secret";
    const exact = body(1, [row("safe-id", "Safe title", coordinate)], 1, 1, 1);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact) })(plan({ pageSize: 1 }));
    expect(result).toMatchObject({ ok: true, payload: { jobs: [] }, fetchEvidence: { fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 }, fetchLosses: [{ details: { code: "SENSITIVE_OUTPUT" } }] } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("redacts sensitive response material and fails without persisting it", async () => {
    const secret = "opaque-upstream-secret";
    const exact = JSON.stringify({ code: 0, access_token: secret, data: { current_page: 1, last_page: 1, total: 0, per_page: 2, data: [] } });
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact) })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Xiuzheng job-list response contains sensitive material", fetchEvidence: { artifacts: [{ bodyRepresentation: "REDACTED", rawBodySha256: expect.stringMatching(/^[0-9a-f]{64}$/) }] } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("retains exact evidence and fixed safe reason for response metadata and later HTTP failures", async () => {
    let call = 0;
    const first = body(1, [row(1, "A", { location: "上海" }), row(2, "B", { location: "北京" })], 3, 2);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => ++call === 1 ? response(first) : response("upstream-private", { status: 503 }) })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Xiuzheng job-list returned HTTP 503", fetchEvidence: { artifacts: [{ body: first }, { body: "upstream-private" }], pages: [{ termination: "CONTINUE" }, { termination: "FAILED" }] } });
  });

  it("marks a full page stopped by maxPages as a noncertifying page-limit terminal", async () => {
    const exact = body(1, [row(1, "A", { location: "上海" }), row(2, "B", { location: "北京" })], 4, 2);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact) })(plan({ maxPages: 1 }));
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }, fetchEvidence: { pages: [{ termination: "MAX_PAGE_LIMIT", anomalyCodes: ["MAX_PAGES_WITH_NEXT"] }] }, paginationEvaluation: { safeCompleteness: false, verifiedEligible: false } });
  });

  it.each([
    ["wrong MIME", { contentType: "text/html" }],
    ["final URL drift", { finalUrl: "https://evil.example/front/human-resource/job-list" }],
    ["capture before crawl", { capturedAt: "2026-07-11T07:59:59.999Z" }]
  ])("retains the current artifact and fails fixed metadata validation for %s", async (_label, overrides) => {
    const exact = body(1, [], 0, 1);
    const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => response(exact, overrides) })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Xiuzheng job-list response metadata is invalid", fetchEvidence: { artifacts: [{ body: exact }], pages: [{ termination: "FAILED" }] } });
  });
});
