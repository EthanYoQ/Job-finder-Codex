import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import type { WorkdayHttpResponse } from "../../src/crawler/workdaySourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const plan = {
  adapterId: "official-json",
  company: { id: "company-pfizer-china", officialChineseName: "辉瑞" },
  source: {
    id: "source-pfizer-china-social",
    companyId: "company-pfizer-china",
    kind: "SOCIAL",
    atsKind: "WORKDAY",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
    officialChainEvidenceUrl: "https://www.pfizer.com/about/careers"
  },
  json: {
    jobsPath: "jobPostings",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    }
  },
  workday: {
    tenant: "pfizer",
    site: "PfizerCareers",
    searchText: "China",
    appliedFacets: { Location_Country: ["china-id"] },
    pageSize: 2,
    maxPages: 2
  }
} satisfies SourceCrawlPlan;

function response(
  body: unknown,
  capturedAt = "2026-07-08T00:00:00.000Z",
  overrides: Partial<WorkdayHttpResponse> = {}
): WorkdayHttpResponse {
  return {
    status: 200,
    body: typeof body === "string" ? body : JSON.stringify(body),
    finalUrl: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
    contentType: "application/json; charset=utf-8",
    capturedAt,
    ...overrides
  };
}

function workdayId(externalPath: string): string {
  return `workday:sha256:${createHash("sha256").update(Buffer.from(externalPath, "utf8")).digest("hex")}`;
}

describe("createWorkdaySourceFetch", () => {
  it("retains exact Workday pages and official total evidence without promoting fetch completeness", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: 2,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset + 1}`,
            locationsText: "Shanghai, China",
            bulletFields: [`id-${offset + 1}`]
          }]
        }, offset === 0 ? "2026-07-08T00:00:01.000Z" : "2026-07-08T00:00:02.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: { ...plan.workday, pageSize: 1, maxPages: 2 }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"
      },
      fetchEvidence: {
        artifacts: [
          { body: expect.stringContaining("Role One"), capturedAt: "2026-07-08T00:00:01.000Z" },
          { body: expect.stringContaining("Role Two"), capturedAt: "2026-07-08T00:00:02.000Z" }
        ],
        pages: [
          { sequence: 0, requestedOffset: 0, requestedPageSize: 1, returnedPageSize: null, rawJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], validJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], termination: "CONTINUE" },
          { sequence: 1, requestedOffset: 1, requestedPageSize: 1, returnedPageSize: null, rawJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], validJobIds: [expect.stringMatching(/^sha256:[0-9a-f]{64}$/)], termination: "DECLARED_TOTAL_REACHED" }
        ],
        declaredCompleteness: {
          kind: "OFFICIAL_TOTAL_COUNT",
          value: 2,
          artifactLogicalKey: "workday-page-0000",
          extractorLocator: "$.total",
          scope: "SOURCE"
        },
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false, derivedAnomalyCodes: [] }
    });
  });

  it("fails closed when injected Workday response metadata is incomplete", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 200, body: JSON.stringify({ total: 0, jobPostings: [] }) })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("evidence metadata")
    });
  });

  it("records parse and validation losses from exact raw Workday records", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 3,
        jobPostings: [
          "not-an-object",
          { title: "Missing location", externalPath: "/job/China/missing" },
          { title: "Valid", externalPath: "/job/China/valid", locationsText: "Shanghai, China", bulletFields: ["valid-id"] }
        ]
      })
    });

    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 2, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 1 },
        fetchLosses: [
          { stage: "PARSE", details: { code: "NON_OBJECT_RECORD", pageSequence: 0, recordIndex: 0 } },
          { stage: "VALIDATION", details: { code: "MISSING_REQUIRED_FIELD", field: "locationsText", pageSequence: 0, recordIndex: 1 } }
        ]
      }
    });
  });

  it("rejects records without record-level China evidence instead of trusting request facets", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 3,
        jobPostings: [
          { title: "US Role", externalPath: "/job/United-States/1", locationsText: "Boston, MA", bulletFields: ["us-1"] },
          { title: "China Role", externalPath: "/job/China/2", locationsText: "Shanghai, China", bulletFields: ["cn-2"] },
          { title: "Hinted China Role", externalPath: "/job/special-hint/3", locationsText: "Remote", bulletFields: ["hint-3"] }
        ]
      })
    });

    const result = await fetcher({
      ...plan,
      workday: { ...plan.workday, cityHints: { "special-hint": ["上海"] } }
    });
    expect(result).toMatchObject({
      ok: true,
      payload: { jobPostings: [
        { sourceJobId: workdayId("/job/China/2") },
        { sourceJobId: workdayId("/job/special-hint/3") }
      ] },
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 2, validationDiscardCount: 1 },
        fetchLosses: [{ stage: "VALIDATION", details: { code: "OUT_OF_SCOPE" } }]
      }
    });

    const unknownOnly = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 1,
        jobPostings: [{ title: "Unknown Role", externalPath: "/job/unknown/1", locationsText: "Remote", bulletFields: ["unknown-1"] }]
      })
    });
    await expect(unknownOnly(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("record-level China evidence"),
      fetchEvidence: expect.any(Object)
    });
  });

  it("keeps the entire emitted result free of credential material and unsafe upstream identifiers", async () => {
    const secret = "top-secret-value";
    const safeLookingBullet = "SAFE-REQ-4";
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
        total: 4,
        jobPostings: [
          { title: "Path attack", externalPath: `/job/China/token=${secret}`, locationsText: "China", bulletFields: ["safe-1"] },
          { title: `Medical Lead Bearer=${secret}`, externalPath: "/job/China/2", locationsText: "China", bulletFields: ["safe-2"] },
          { title: "Location attack", externalPath: "/job/China/3", locationsText: `China session:${secret}`, bulletFields: ["safe-3"] },
          { title: "Token Engineer", externalPath: "/job/China/4", locationsText: "Shanghai, China", bulletFields: [safeLookingBullet] }
        ]
      })
    });

    const result = await fetcher(plan);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.fetchEvidence || !("payload" in result)) throw new Error("Expected evidence-backed JSON result");
    const resultWithOpaqueBodies = {
      ...result,
      fetchEvidence: {
        ...result.fetchEvidence,
        artifacts: result.fetchEvidence.artifacts.map((artifact) => ({ ...artifact, body: "<opaque>" }))
      }
    };
    const serialized = JSON.stringify(resultWithOpaqueBodies);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(safeLookingBullet);
    expect(result.payload).toMatchObject({
      jobPostings: [{
        sourceJobId: workdayId("/job/China/4"),
        title: "Token Engineer",
        officialUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China/4"
      }]
    });
    expect(result.fetchEvidence.fetchLosses.map((loss) => loss.details.code)).toEqual([
      "INVALID_EXTERNAL_PATH",
      "CREDENTIAL_MATERIAL",
      "CREDENTIAL_MATERIAL"
    ]);
    expect(result.fetchEvidence.fetchCounts).toEqual({
      rawCount: 4,
      parsedCount: 4,
      validCount: 1,
      parseDiscardCount: 0,
      validationDiscardCount: 3
    });
    expect(result.fetchEvidence.fetchLosses[0]!.rawLocator).toMatch(/^workday-page-0000#page-0#record-0#sha256:[0-9a-f]{64}$/);
    expect(result.fetchEvidence.pages[0]!.rawJobIds.every((id) => /^sha256:[0-9a-f]{64}$/.test(id))).toBe(true);
    expect(result.fetchEvidence.pages[0]!.validJobIds.every((id) => /^sha256:[0-9a-f]{64}$/.test(id))).toBe(true);
  });

  it("fails native responses without an actual content-type instead of inventing a fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      status: 200,
      url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
      headers: { get: () => null },
      text: async () => JSON.stringify({ total: 0, jobPostings: [] })
    })));
    try {
      const fetcher = createWorkdaySourceFetch({ now: () => new Date("2026-07-08T00:00:00.000Z") });
      await expect(fetcher(plan)).resolves.toMatchObject({
        ok: false,
        failureReason: expect.stringContaining("evidence metadata")
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when Workday omits the official jobPostings array", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({ total: 0 })
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("jobPostings array")
    });
  });

  it("fails closed when a later Workday page changes the official total", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 3,
          jobPostings: [{ title: `Role ${offset}`, externalPath: `/job/${offset}`, locationsText: "China", bulletFields: [`id-${offset}`] }]
        });
      }
    });
    await expect(fetcher({ ...plan, workday: { ...plan.workday, pageSize: 1, maxPages: 2 } })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("TOTAL_CHANGED")
    });
  });

  it("fails closed on later raw zero totals without the exact audited source policy", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 0,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        pageSize: 1,
        maxPages: 2
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("TOTAL_CHANGED")
    });
  });

  it("rejects the audited later-zero policy on any other source before transport", async () => {
    const http = vi.fn(async () => response({ total: 0, jobPostings: [] }));
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http
    });

    await expect(fetcher({
      ...plan,
      source: {
        ...plan.source,
        id: "source-non-audited-workday"
      },
      workday: {
        ...plan.workday,
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION"
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("not allowed for source")
    });
    expect(http).not.toHaveBeenCalled();
  });

  it("accepts later raw zero totals only after exact lossless reconciliation and preserves the zero evidence", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 3 : 0,
          jobPostings: [{
            title: `Role ${offset + 1}`,
            externalPath: `/job/China/role-${offset + 1}`,
            locationsText: "Shanghai, China"
          }]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        appliedFacets: { Location_Country: ["china-id"] },
        pageSize: 1,
        maxPages: 3
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 3
      },
      fetchEvidence: {
        artifacts: [
          { body: expect.stringContaining('"total":3') },
          { body: expect.stringContaining('"total":0') },
          { body: expect.stringContaining('"total":0') }
        ],
        pages: [
          { sequence: 0, declaredTotal: 3 },
          { sequence: 1, declaredTotal: 0 },
          { sequence: 2, declaredTotal: 0 }
        ],
        fetchCounts: {
          rawCount: 3,
          parsedCount: 3,
          validCount: 3,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        }
      },
      paginationEvaluation: {
        safeCompleteness: true,
        verifiedEligible: false,
        derivedAnomalyCodes: []
      }
    });
  });

  it("rejects duplicate Workday total keys before applying the audited later-zero policy", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        if (offset === 0) {
          return response({
            total: 2,
            jobPostings: [{
              title: "Role One",
              externalPath: "/job/China/one",
              locationsText: "Shanghai, China"
            }]
          });
        }
        return response(
          '{"total":2,"total":0,"jobPostings":[{"title":"Role Two","externalPath":"/job/China/two","locationsText":"Shanghai, China"}]}'
        );
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
        appliedFacets: { Location_Country: ["china-id"] },
        pageSize: 1,
        maxPages: 2
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("duplicate JSON object keys")
    });
  });

  it.each([
    { name: "error-shaped", extra: { error: "upstream partial response" } },
    { name: "facet-shaped", extra: { facets: [] } },
    { name: "authentication-shaped", extra: { userAuthenticated: false } }
  ])("fails closed on a non-first non-empty Workday zero total in a $name payload", async ({ extra }) => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({
          total: offset === 0 ? 2 : 0,
          ...extra,
          jobPostings: [{
            title: offset === 0 ? "Role One" : "Role Two",
            externalPath: `/job/China/${offset === 0 ? "one" : "two"}`,
            locationsText: "Shanghai, China"
          }]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        pageSize: 1,
        maxPages: 2
      }
    });

    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("TOTAL_CHANGED"),
      fetchEvidence: {
        pages: [
          { sequence: 0, declaredTotal: 2 },
          { sequence: 1, declaredTotal: 0 }
        ]
      },
      paginationEvaluation: {
        safeCompleteness: false,
        derivedAnomalyCodes: expect.arrayContaining(["TOTAL_CHANGED", "DECLARED_CAPACITY_CONTRADICTION"])
      }
    });
  });

  it("fails closed on a repeated final Workday response and on an intermediate empty page", async () => {
    const repeated = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({ total: 2, jobPostings: [{
        title: "Same", externalPath: "/job/same", locationsText: "China", bulletFields: ["same-id"]
      }] })
    });
    await expect(repeated({ ...plan, workday: { ...plan.workday, pageSize: 1, maxPages: 2 } })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringMatching(/REPEATED_RESPONSE_FINGERPRINT|REPEATED_JOB_ID_SET_WITH_NEXT/),
      fetchEvidence: expect.any(Object)
    });

    const empty = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        const { offset } = JSON.parse(request.body) as { offset: number };
        return response({ total: 3, jobPostings: offset === 0 ? [{
          title: "First", externalPath: "/job/first", locationsText: "China", bulletFields: ["first-id"]
        }] : [] });
      }
    });
    await expect(empty({ ...plan, workday: { ...plan.workday, pageSize: 1, maxPages: 2 } })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("INTERMEDIATE_EMPTY_PAGE")
    });
  });

  it("carries Workday fetch evidence unchanged through runSourceCrawl", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({ total: 1, jobPostings: [{
        title: "Role", externalPath: "/job/China/1", locationsText: "Shanghai, China", bulletFields: ["id-1"]
      }] })
    });
    const fetched = await fetcher(plan);
    expect(fetched.ok).toBe(true);
    if (!fetched.ok) throw new Error(fetched.failureReason);

    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result.status).toBe("SUCCESS");
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetched.paginationEvaluation);
    expect(result.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
  });
  it("fetches paginated Workday jobs and enriches official urls and Chinese cities", async () => {
    const requests: unknown[] = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body);
        if (body.offset === 0) {
          return response({
              total: 4,
              jobPostings: [
                {
                  title: "助理医学信息沟通专员",
                  externalPath: "/job/China---Shanghai---Shanghai/_4960384",
                  locationsText: "China - Shanghai - Shanghai",
                  bulletFields: ["4960384"]
                },
                {
                  title: "血友病客户解决方案大区经理",
                  externalPath: "/job/China---Beijing---Beijing/_4959317",
                  locationsText: "China - Beijing - Beijing",
                  bulletFields: ["4959317"]
                }
              ]
            });
        }

        return response({
            total: 4,
            jobPostings: [
              {
                title: "Site Admin",
                externalPath: "/job/China---Jiangsu---Suzhou/_4950000",
                locationsText: "China - Jiangsu - Suzhou",
                bulletFields: ["4950000"]
              },
              {
                title: "China Market Access Lead",
                externalPath: "/job/China-Remote/_4950001",
                locationsText: "China",
                bulletFields: ["4950001"]
              }
            ]
          });
      }
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      capturedAt: "2026-07-08T00:00:00.000Z",
      payload: {
        jobPostings: [
          {
            sourceJobId: workdayId("/job/China---Shanghai---Shanghai/_4960384"),
            title: "助理医学信息沟通专员",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Shanghai---Shanghai/_4960384",
            locationRaw: "China - Shanghai - Shanghai",
            cities: ["上海"]
          },
          {
            sourceJobId: workdayId("/job/China---Beijing---Beijing/_4959317"),
            title: "血友病客户解决方案大区经理",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Beijing---Beijing/_4959317",
            locationRaw: "China - Beijing - Beijing",
            cities: ["北京"]
          },
          {
            sourceJobId: workdayId("/job/China---Jiangsu---Suzhou/_4950000"),
            title: "Site Admin",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China---Jiangsu---Suzhou/_4950000",
            locationRaw: "China - Jiangsu - Suzhou",
            cities: ["苏州"]
          },
          {
            sourceJobId: workdayId("/job/China-Remote/_4950001"),
            title: "China Market Access Lead",
            officialUrl:
              "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers/job/China-Remote/_4950001",
            locationRaw: "China",
            cities: ["中国"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 4,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers",
        totalPages: 2,
        pageSize: 2,
        pagesVisited: 2
      }
    });

    expect(requests).toEqual([
      expect.objectContaining({
        url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
        method: "POST",
        body: JSON.stringify({
          appliedFacets: { Location_Country: ["china-id"] },
          searchText: "China",
          limit: 2,
          offset: 0
        })
      }),
      expect.objectContaining({
        url: "https://pfizer.wd1.myworkdayjobs.com/wday/cxs/pfizer/PfizerCareers/jobs",
        method: "POST",
        body: JSON.stringify({
          appliedFacets: { Location_Country: ["china-id"] },
          searchText: "China",
          limit: 2,
          offset: 2
        })
      })
    ]);
  });

  it("fails non-Workday plans before formal crawl", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z")
    });

    await expect(
      fetcher({
        ...plan,
        source: { ...plan.source, atsKind: "MOKA" }
      })
    ).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday source fetch only supports WORKDAY sources"
    });
  });

  it("fails non-2xx Workday responses", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => ({ status: 500, body: "server error" })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday jobs API returned HTTP 500"
    });
  });

  it("discovers China location facets instead of trusting broad Workday searchText totals", async () => {
    const requests: unknown[] = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body);
        if (Array.isArray(body.appliedFacets?.locations)) {
          return response({
              total: 1,
              jobPostings: [
                {
                  title: "China Medical Role",
                  externalPath: "/job/China---Shanghai---Shanghai/China-Medical-Role_1",
                  locationsText: "Shanghai, China",
                  bulletFields: ["1"]
                }
              ]
            });
        }

        return response({
            total: 2,
            jobPostings: [],
            facets: [
              {
                facetParameter: "locationMainGroup",
                values: [
                  {
                    facetParameter: "locations",
                    descriptor: "Locations",
                    values: [
                      { descriptor: "China - Shanghai", id: "china-location", count: 1 },
                      { descriptor: "United States - California", id: "us-location", count: 1 }
                    ]
                  }
                ]
              }
            ]
          });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        searchText: "China",
        pageSize: 2,
        maxPages: 2
      }
    });

    expect(result).toMatchObject({
      ok: true,
      payload: { jobPostings: [{
        sourceJobId: workdayId("/job/China---Shanghai---Shanghai/China-Medical-Role_1"),
        cities: ["上海"]
      }] },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1
      }
    });
    if (!result.ok) throw new Error(result.failureReason);
    if (!result.fetchEvidence) throw new Error("Expected Workday fetch evidence");
    expect(result.fetchEvidence.pages).toHaveLength(1);
    expect(result.fetchEvidence.artifacts.map((artifact) => artifact.logicalKey)).toEqual([
      "workday-preflight-0000",
      "workday-page-0000"
    ]);
    expect(result.fetchEvidence.artifacts.every((artifact) => !("headers" in artifact))).toBe(true);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: {},
          limit: 2,
          offset: 0
        })
      })
    );
    expect(requests[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: { locations: ["china-location"] },
          limit: 2,
          offset: 0
        })
      })
    );
  });

  it("selects the unique country-level China facet without intersecting a city facet group", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        if (body.appliedFacets.Location_Country) {
          return response({
            total: 1,
            jobPostings: [{
              title: "China Country Role",
              externalPath: "/job/China---Shanghai/China-Country-Role_1",
              locationsText: "Shanghai, China",
              bulletFields: ["1"]
            }]
          });
        }
        return response({
          total: 3,
          jobPostings: [],
          facets: [
            {
              facetParameter: "Location_Country",
              descriptor: "Country",
              values: [
                { descriptor: "China", id: "china-country", count: 1 },
                { descriptor: "United States", id: "us-country", count: 2 }
              ]
            },
            {
              facetParameter: "locations",
              descriptor: "Locations",
              values: [
                { descriptor: "Shanghai, China", id: "shanghai-city", count: 1 },
                { descriptor: "New York, United States", id: "new-york-city", count: 2 }
              ]
            }
          ]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 2, maxPages: 2 }
    });

    expect(result).toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1]!.body)).toEqual({
      appliedFacets: { Location_Country: ["china-country"] },
      limit: 2,
      offset: 0
    });
  });

  it("uses a unique exact China country id when sibling facet counts overlap without deriving a denominator", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        if (body.appliedFacets.Location_Country) {
          return response({
            total: 2,
            jobPostings: [
              { title: "China Role One", externalPath: "/job/China/one", locationsText: "Shanghai, China" },
              { title: "China Role Two", externalPath: "/job/China/two", locationsText: "Beijing, China" }
            ]
          });
        }
        return response({
          total: 3,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china-country", count: 2 },
              { descriptor: "United States", id: "us-country", count: 2 }
            ]
          }]
        });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 20 }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2
      }
    });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ Location_Country: ["china-country"] });
  });

  it("rejects overlapping country facets with more than one exact mainland-China request id", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "Location_Country",
          descriptor: "Country",
          values: [
            { descriptor: "China", id: "china-country", count: 2 },
            { descriptor: "CN", id: "cn-country", count: 1 },
            { descriptor: "United States", id: "us-country", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("unique exact mainland-China request id")
    });
  });

  it("does not relax an under-counted country facet that may omit official jobs", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 3,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china-country", count: 1 },
              { descriptor: "United States", id: "us-country", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", maxPages: 1 }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("counts do not prove a complete partition")
    });
    expect(requests).toHaveLength(1);
  });

  it("fails closed with the archived preflight when country-level China facets are ambiguous", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [
          {
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [{ descriptor: "China", id: "china-country", count: 1 }]
          },
          {
            facetParameter: "countryFacet",
            descriptor: "Country/Region",
            values: [{ descriptor: "China", id: "china-region", count: 1 }]
          }
        ]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("ambiguous country-level China location facets"),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-preflight-0000", extractorLocator: "$.facets" }]
      }
    });
  });

  it("fails closed instead of treating searchText as completeness evidence when no China facet is proven", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 1,
        jobPostings: [],
        facets: [{
          facetParameter: "jobFamilyGroup",
          descriptor: "Job family",
          values: [{ descriptor: "Medical", id: "medical", count: 1 }]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("no authoritative China location facet"),
      fetchEvidence: { artifacts: [{ logicalKey: "workday-preflight-0000" }] }
    });
  });

  it("fails closed when multiple city-level China facet groups have equal authority", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [
          {
            facetParameter: "locations",
            descriptor: "Locations",
            values: [{ descriptor: "Shanghai, China", id: "shanghai", count: 1 }]
          },
          {
            facetParameter: "locationHierarchy2",
            descriptor: "Locations",
            values: [{ descriptor: "Beijing, China", id: "beijing", count: 1 }]
          }
        ]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("ambiguous city-level China location facets")
    });
  });

  it("fails closed when an explicit mainland-China city facet value has no selectable id", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "locations",
          descriptor: "Locations",
          values: [
            { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
            { descriptor: "Beijing, China", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("contains a mainland-China descriptor without an id"),
      fetchEvidence: { artifacts: [{ logicalKey: "workday-preflight-0000" }] }
    });
  });

  it("fails closed when Workday ignores the discovered location facet total", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.Location_Country
          ? response({ total: 2, jobPostings: [] })
          : response({
              total: 2,
              jobPostings: [],
              facets: [{
                facetParameter: "Location_Country",
                descriptor: "Country",
                values: [
                  { descriptor: "China", id: "china", count: 1 },
                  { descriptor: "United States", id: "us", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: "Workday filtered total 2 did not match derived total 1",
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-preflight-0000" },
          { logicalKey: "workday-filter-validation-0000" }
        ]
      }
    });
  });

  it("selects every structurally explicit mainland city without a city allowlist", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 2,
              jobPostings: [
                { title: "Shanghai Role", externalPath: "/job/China/Shanghai_1", locationsText: "Shanghai, China", bulletFields: ["1"] },
                { title: "Chongqing Role", externalPath: "/job/China/Chongqing_2", locationsText: "Chongqing, China", bulletFields: ["2"] }
              ]
            })
          : response({
              total: 3,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
                  { descriptor: "Chongqing, China", id: "chongqing", count: 1 },
                  { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 2 }
    })).resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 2 } });
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locations: ["shanghai", "chongqing"] });
  });

  it("fails closed when a flat city group contains an unscoped descriptor", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 3,
        jobPostings: [],
        facets: [{
          facetParameter: "locations",
          descriptor: "Locations",
          values: [
            { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
            { descriptor: "Chongqing", id: "chongqing", count: 1 },
            { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("unscoped location descriptor Chongqing") });
  });

  it("fails closed when authoritative facet values share an id across China and foreign branches", async () => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{
          facetParameter: "Location_Country",
          descriptor: "Country",
          values: [
            { descriptor: "China", id: "shared", count: 1 },
            { descriptor: "United States", id: "shared", count: 1 }
          ]
        }]
      })
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("duplicate descriptors or ids") });
  });

  it("fails closed before pagination when a country facet has an unowned Global or Remote branch", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 2,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china", count: 1 },
              { descriptor: "Global / Remote", id: "global-remote", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("unscoped country descriptor Global / Remote"),
      fetchEvidence: { artifacts: [{ logicalKey: "workday-preflight-0000" }] }
    });
    expect(requests).toHaveLength(1);
  });

  it.each(["Acme / Georgia", "North America / Jordan", "Region / US"])(
    "rejects a country name or code embedded in a composite descriptor: %s",
    async (foreignDescriptor) => {
      const requests: Array<{ body: string }> = [];
      const fetcher = createWorkdaySourceFetch({
        http: async (request) => {
          requests.push(request);
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "Location_Country",
              descriptor: "Country",
              values: [
                { descriptor: "China", id: "china", count: 1 },
                { descriptor: foreignDescriptor, id: "foreign", count: 1 }
              ]
            }]
          });
        }
      });

      await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
        .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining(`unscoped country descriptor ${foreignDescriptor}`) });
      expect(requests).toHaveLength(1);
    }
  );

  it.each(["Region / Hong Kong", "Acme / Taiwan", "North America / Macau"])(
    "rejects a non-mainland boundary embedded in a composite country descriptor: %s",
    async (boundaryDescriptor) => {
      const requests: Array<{ body: string }> = [];
      const fetcher = createWorkdaySourceFetch({
        http: async (request) => {
          requests.push(request);
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "Location_Country",
              descriptor: "Country",
              values: [
                { descriptor: "China", id: "china", count: 1 },
                { descriptor: boundaryDescriptor, id: "boundary", count: 1 }
              ]
            }]
          });
        }
      });

      await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
        .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining(`unscoped country descriptor ${boundaryDescriptor}`) });
      expect(requests).toHaveLength(1);
    }
  );

  it.each(["Hong Kong", "HKG", "澳门", "MAC", "Taiwan", "TW"])(
    "accepts an exact non-mainland country boundary descriptor: %s",
    async (boundaryDescriptor) => {
      const requests: Array<{ body: string }> = [];
      const fetcher = createWorkdaySourceFetch({
        http: async (request) => {
          requests.push(request);
          const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
          return body.appliedFacets.Location_Country
            ? response({
                total: 1,
                jobPostings: [{ title: "China Role", externalPath: "/job/China/Role_1", locationsText: "China", bulletFields: ["1"] }]
              })
            : response({
                total: 2,
                jobPostings: [],
                facets: [{
                  facetParameter: "Location_Country",
                  descriptor: "Country",
                  values: [
                    { descriptor: "China", id: "china", count: 1 },
                    { descriptor: boundaryDescriptor, id: "boundary", count: 1 }
                  ]
                }]
              });
        }
      });

      await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
        .resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
      expect(requests).toHaveLength(2);
    }
  );

  it.each([
    { name: "exact CLDR names", foreignDescriptors: ["Georgia", "Jordan"] },
    { name: "exact ISO alpha-2 codes", foreignDescriptors: ["US", "DE"] },
    { name: "exact ISO alpha-3 codes", foreignDescriptors: ["USA", "DEU"] }
  ])("accepts provable foreign country siblings from $name", async ({ foreignDescriptors }) => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.Location_Country
          ? response({
              total: 1,
              jobPostings: [{ title: "China Role", externalPath: "/job/China/Role_1", locationsText: "China", bulletFields: ["1"] }]
            })
          : response({
              total: 3,
              jobPostings: [],
              facets: [{
                facetParameter: "Location_Country",
                descriptor: "Country",
                values: [
                  { descriptor: "China", id: "china", count: 1 },
                  ...foreignDescriptors.map((descriptor, index) => ({ descriptor, id: `foreign-${index}`, count: 1 }))
                ]
              }]
            });
      }
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(requests).toHaveLength(2);
  });

  it("accepts the exact official country descriptor United States of America", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.Location_Country
          ? response({
              total: 1,
              jobPostings: [{ title: "China Role", externalPath: "/job/China/Role_1", locationsText: "China" }]
            })
          : response({
              total: 2,
              jobPostings: [],
              facets: [{
                facetParameter: "Location_Country",
                descriptor: "Country",
                values: [
                  { descriptor: "China", id: "china", count: 1 },
                  { descriptor: "United States of America", id: "usa", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "biogen", site: "External", searchText: "China" }
    })).resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(requests).toHaveLength(2);
  });

  it("rejects an unknown recursive country branch even when its counts partition", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        return response({
          total: 2,
          jobPostings: [],
          facets: [{
            facetParameter: "Location_Country",
            descriptor: "Country",
            values: [
              { descriptor: "China", id: "china", count: 1 },
              {
                descriptor: "Worldwide",
                count: 1,
                values: [{ descriptor: "Remote", id: "remote", count: 1 }]
              }
            ]
          }]
        });
      }
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("unscoped country descriptor Remote") });
    expect(requests).toHaveLength(1);
  });

  it("selects requestable leaves from a nested locations to China hierarchy", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 2,
              jobPostings: [
                { title: "Shanghai Role", externalPath: "/job/China/Shanghai_1", locationsText: "Shanghai, China", bulletFields: ["1"] },
                { title: "Beijing Role", externalPath: "/job/China/Beijing_2", locationsText: "Beijing, China", bulletFields: ["2"] }
              ]
            })
          : response({
              total: 3,
              jobPostings: [],
              facets: [{
                facetParameter: "locationMainGroup",
                values: [{
                  facetParameter: "locations",
                  descriptor: "Locations",
                  values: [
                    {
                      descriptor: "China",
                      count: 2,
                      values: [
                        { descriptor: "Shanghai", id: "shanghai", count: 1 },
                        { descriptor: "Beijing", id: "beijing", count: 1 }
                      ]
                    },
                    {
                      descriptor: "United States",
                      count: 1,
                      values: [{ descriptor: "New York", id: "new-york", count: 1 }]
                    }
                  ]
                }]
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China", pageSize: 2 }
    })).resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 2 } });
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locations: ["shanghai", "beijing"] });
  });

  it("excludes Hong Kong, Macau and Taiwan leaves while proving the full facet partition", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
        return body.appliedFacets.locations
          ? response({
              total: 1,
              jobPostings: [{ title: "Shanghai", externalPath: "/job/China/Shanghai_1", locationsText: "Shanghai, China", bulletFields: ["1"] }]
            })
          : response({
              total: 5,
              jobPostings: [],
              facets: [{
                facetParameter: "locations",
                descriptor: "Locations",
                values: [
                  { descriptor: "Shanghai, China", id: "shanghai", count: 1 },
                  { descriptor: "Hong Kong, China", id: "hong-kong", count: 1 },
                  { descriptor: "Macau, China", id: "macau", count: 1 },
                  { descriptor: "Taiwan, China", id: "taiwan", count: 1 },
                  { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
                ]
              }]
            });
      }
    });

    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(JSON.parse(requests[1]!.body).appliedFacets).toEqual({ locations: ["shanghai"] });
  });

  it.each([
    {
      name: "missing count",
      values: [
        { descriptor: "Shanghai, China", id: "shanghai" },
        { descriptor: "Tokyo, Japan", id: "tokyo", count: 1 }
      ]
    },
    {
      name: "overlapping hierarchy counts",
      values: [{
        descriptor: "China",
        count: 2,
        values: [
          { descriptor: "Shanghai", id: "shanghai", count: 2 },
          { descriptor: "Beijing", id: "beijing", count: 2 }
        ]
      }]
    },
    {
      name: "non-integer count",
      values: [
        { descriptor: "Shanghai, China", id: "shanghai", count: 0.5 },
        { descriptor: "Tokyo, Japan", id: "tokyo", count: 1.5 }
      ]
    }
  ])("fails closed when location facet counts cannot prove a partition: $name", async ({ values }) => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 2,
        jobPostings: [],
        facets: [{ facetParameter: "locations", descriptor: "Locations", values }]
      })
    });
    await expect(fetcher({ ...plan, workday: { tenant: "pfizer", site: "PfizerCareers", searchText: "China" } }))
      .resolves.toMatchObject({ ok: false, failureReason: expect.stringContaining("counts do not prove a complete partition") });
  });

  it("proves an exact allowed-descriptor Workday boundary before crawling", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        requests.push(body);
        const appliedFacets = body.appliedFacets as Record<string, string[]>;
        if (!appliedFacets.workerSubType) {
          return response({
            total: 3,
            jobPostings: [],
            facets: [{
              facetParameter: "workerSubType",
              descriptor: "Job Type",
              values: [
                { descriptor: "Regular", id: "regular-id", count: 2 },
                { descriptor: "Fixed Term Employee (Non-Intern) (Fixed Term)", id: "fixed-id", count: 1 }
              ]
            }]
          }, "2026-07-13T00:00:01.000Z");
        }
        return response({
          total: 3,
          jobPostings: [
            { title: "Role One", externalPath: "/job/China/one", locationsText: "Shanghai, China" },
            { title: "Role Two", externalPath: "/job/China/two", locationsText: "Beijing, China" },
            { title: "Role Three", externalPath: "/job/China/three", locationsText: "Suzhou, China" }
          ]
        }, "2026-07-13T00:00:02.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular", "Fixed Term Employee (Non-Intern) (Fixed Term)"]
        },
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({ ok: true, completeness: { expectedJobCount: 3 } });
    expect(requests).toEqual([
      { appliedFacets: { Location_Country: ["china-id"] }, limit: 20, offset: 0 },
      {
        appliedFacets: {
          Location_Country: ["china-id"],
          workerSubType: ["regular-id", "fixed-id"]
        },
        limit: 20,
        offset: 0
      }
    ]);
  });

  it.each([
    {
      name: "an unconfigured descriptor appears",
      values: [
        { descriptor: "Regular", id: "regular-id", count: 1 },
        { descriptor: "Fixed Term Employee (Non-Intern) (Fixed Term)", id: "fixed-id", count: 1 },
        { descriptor: "Intern (Fixed Term)", id: "intern-id", count: 1 }
      ],
      reason: "unexpected descriptor Intern (Fixed Term)"
    },
    {
      name: "an allowed descriptor is missing",
      values: [{ descriptor: "Regular", id: "regular-id", count: 3 }],
      reason: "allowed descriptor Fixed Term Employee (Non-Intern) (Fixed Term) was missing"
    },
    {
      name: "descriptor ids overlap",
      values: [
        { descriptor: "Regular", id: "same-id", count: 2 },
        { descriptor: "Fixed Term Employee (Non-Intern) (Fixed Term)", id: "same-id", count: 1 }
      ],
      reason: "duplicate descriptors or ids"
    }
  ])("fails closed when an allowed-descriptor Workday boundary drifts: $name", async ({ values, reason }) => {
    const fetcher = createWorkdaySourceFetch({
      http: async () => response({
        total: 3,
        jobPostings: [],
        facets: [{ facetParameter: "workerSubType", descriptor: "Job Type", values }]
      })
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular", "Fixed Term Employee (Non-Intern) (Fixed Term)"]
        }
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining(reason),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-facet-preflight-0000", extractorLocator: "$.facets" }],
        supportingArtifactOnlyFailure: { code: "FACET_DERIVATION_FAILED" }
      }
    });
  });

  it("fails closed when a Workday record exposes a job-type descriptor outside the proven facet boundary", async () => {
    let requestNumber = 0;
    const fetcher = createWorkdaySourceFetch({
      http: async () => {
        requestNumber += 1;
        return requestNumber === 1
          ? response({
              total: 1,
              jobPostings: [],
              facets: [{
                facetParameter: "workerSubType",
                values: [{ descriptor: "Regular", id: "regular-id", count: 1 }]
              }]
            })
          : response({
              total: 1,
              jobPostings: [{
                title: "Role",
                externalPath: "/job/China/role",
                locationsText: "Shanghai, China",
                workerSubType: "Intern (Fixed Term)"
              }]
            });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular"]
        }
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("record workerSubType descriptor Intern (Fixed Term) is outside the proven boundary"),
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-facet-preflight-0000" },
          {
            logicalKey: "workday-record-boundary-validation-0000",
            body: expect.stringContaining("Intern (Fixed Term)")
          }
        ],
        supportingArtifactOnlyFailure: { code: "FACET_FILTER_VALIDATION_FAILED" }
      }
    });
  });

  it("derives positive Workday facet ids from an archived preflight and uses the filtered official total", async () => {
    const requests: Array<{ body: string }> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body) as {
          appliedFacets: Record<string, string[]>;
          offset: number;
        };
        if (body.appliedFacets.jobFamilyGroup) {
          expect(body.appliedFacets.jobFamilyGroup).toEqual(["medical-id", "commercial-id"]);
          return response({
            total: 2,
            jobPostings: [
              {
                title: "Medical Role",
                externalPath: "/job/China---Shanghai/medical",
                locationsText: "Shanghai, China",
                bulletFields: ["medical"]
              },
              {
                title: "Commercial Role",
                externalPath: "/job/China---Beijing/commercial",
                locationsText: "Beijing, China",
                bulletFields: ["commercial"]
              }
            ]
          }, "2026-07-13T00:00:02.000Z");
        }

        return response({
          total: 3,
          jobPostings: [],
          facets: [{
            facetParameter: "jobFamilyGroup",
            descriptor: "Job Family Group",
            values: [
              { descriptor: "Medical", id: "medical-id", count: 1 },
              { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 },
              { descriptor: "Commercial", id: "commercial-id", count: 1 }
            ]
          }]
        }, "2026-07-13T00:00:01.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }],
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT"
      },
      fetchEvidence: {
        artifacts: [
          {
            logicalKey: "workday-facet-preflight-0000",
            kind: "ATS_API_RESPONSE",
            extractorLocator: "$.facets",
            body: expect.stringContaining("Vocational & Development Programs")
          },
          { logicalKey: "workday-page-0000", body: expect.stringContaining('"total":2') }
        ],
        declaredCompleteness: { value: 2, artifactLogicalKey: "workday-page-0000" }
      }
    });
    expect(requests).toHaveLength(2);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      appliedFacets: { Location_Country: ["china-id"] },
      limit: 20,
      offset: 0
    });
    expect(JSON.parse(requests[1]!.body)).toEqual({
      appliedFacets: {
        Location_Country: ["china-id"],
        jobFamilyGroup: ["medical-id", "commercial-id"]
      },
      limit: 20,
      offset: 0
    });
  });

  it("discovers geography before a dedicated facet preflight and includes categories absent from the search subset", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async (request) => {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        bodies.push(body);
        const appliedFacets = body.appliedFacets as Record<string, string[]>;
        if (bodies.length === 1) {
          return response({
            total: 4,
            jobPostings: [],
            facets: [
              {
                facetParameter: "locations",
                descriptor: "Locations",
                values: [{ descriptor: "Shanghai, China", id: "shanghai-id", count: 4 }]
              },
              {
                facetParameter: "jobFamilyGroup",
                descriptor: "Job Family Group",
                values: [{ descriptor: "Medical", id: "medical-id", count: 2 }]
              }
            ]
          }, "2026-07-13T00:00:01.000Z");
        }
        if (!appliedFacets.jobFamilyGroup) {
          return response({
            total: 4,
            jobPostings: [],
            facets: [{
              facetParameter: "jobFamilyGroup",
              descriptor: "Job Family Group",
              values: [
                { descriptor: "Medical", id: "medical-id", count: 1 },
                { descriptor: "Commercial", id: "commercial-id", count: 2 },
                { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
              ]
            }]
          }, "2026-07-13T00:00:02.000Z");
        }
        expect(appliedFacets.jobFamilyGroup).toEqual(["medical-id", "commercial-id"]);
        return response({
          total: 3,
          jobPostings: [
            { title: "Medical", externalPath: "/job/China/medical", locationsText: "Shanghai, China" },
            { title: "Commercial One", externalPath: "/job/China/commercial-1", locationsText: "Shanghai, China" },
            { title: "Commercial Two", externalPath: "/job/China/commercial-2", locationsText: "Shanghai, China" }
          ]
        }, "2026-07-13T00:00:03.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        searchText: "China",
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }],
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 3 },
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-preflight-0000", body: expect.stringContaining("shanghai-id") },
          { logicalKey: "workday-facet-preflight-0000", body: expect.stringContaining("commercial-id") },
          { logicalKey: "workday-page-0000", body: expect.stringContaining('"total":3') }
        ]
      }
    });
    expect(bodies).toEqual([
      { appliedFacets: {}, limit: 20, offset: 0 },
      { appliedFacets: { locations: ["shanghai-id"] }, limit: 20, offset: 0 },
      {
        appliedFacets: {
          locations: ["shanghai-id"],
          jobFamilyGroup: ["medical-id", "commercial-id"]
        },
        limit: 20,
        offset: 0
      }
    ]);
  });

  it("fails before worker-type derivation when its preflight total exceeds the location-derived baseline", async () => {
    let requestNumber = 0;
    const fetcher = createWorkdaySourceFetch({
      http: async () => {
        requestNumber += 1;
        if (requestNumber === 1) {
          return response({
            total: 2,
            jobPostings: [],
            facets: [{
              facetParameter: "locations",
              descriptor: "Locations",
              values: [
                { descriptor: "Shanghai, China", id: "shanghai-id", count: 1 },
                { descriptor: "Tokyo, Japan", id: "tokyo-id", count: 1 }
              ]
            }]
          });
        }
        return response({
          total: 2,
          jobPostings: [],
          facets: [{
            facetParameter: "workerSubType",
            descriptor: "Job Type",
            values: [
              { descriptor: "Regular", id: "regular-id", count: 1 },
              { descriptor: "Intern (Fixed Term)", id: "intern-id", count: 1 }
            ]
          }]
        });
      }
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        searchText: "China",
        facetDescriptorBoundary: {
          facetParameter: "workerSubType",
          allowedDescriptors: ["Regular"]
        }
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("social facet preflight total 2 did not match location-derived total 1"),
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-preflight-0000" },
          { logicalKey: "workday-facet-preflight-0000" }
        ],
        supportingArtifactOnlyFailure: { code: "FACET_FILTER_VALIDATION_FAILED" }
      }
    });
  });

  it("fails closed with evidence when Workday ignores the derived positive facet ids", async () => {
    let requestNumber = 0;
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => {
        requestNumber += 1;
        if (requestNumber === 1) {
          return response({
            total: 3,
            jobPostings: [],
            facets: [{
              facetParameter: "jobFamilyGroup",
              values: [
                { descriptor: "Medical", id: "medical-id", count: 2 },
                { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
              ]
            }]
          }, "2026-07-13T00:00:01.000Z");
        }
        return response({
          total: 3,
          jobPostings: [
            { title: "Medical", externalPath: "/job/China/medical", locationsText: "Shanghai, China" },
            { title: "Development", externalPath: "/job/China/development", locationsText: "Shanghai, China" }
          ]
        }, "2026-07-13T00:00:02.000Z");
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }],
        pageSize: 20,
        maxPages: 1
      }
    });

    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("filtered total 3 did not match derived total 2"),
      fetchEvidence: {
        artifacts: [
          { logicalKey: "workday-facet-preflight-0000", extractorLocator: "$.facets" },
          { logicalKey: "workday-filter-validation-0000", body: expect.stringContaining('"total":3') }
        ],
        supportingArtifactOnlyFailure: { code: "FACET_FILTER_VALIDATION_FAILED" }
      }
    });
  });

  it.each([
    {
      name: "missing counts",
      total: 2,
      values: [
        { descriptor: "Medical", id: "medical-id" },
        { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
      ]
    },
    {
      name: "malformed counts",
      total: 2,
      values: [
        { descriptor: "Medical", id: "medical-id", count: 1.5 },
        { descriptor: "Vocational & Development Programs", id: "development-id", count: 0.5 }
      ]
    },
    {
      name: "nonpartition counts",
      total: 3,
      values: [
        { descriptor: "Medical", id: "medical-id", count: 1 },
        { descriptor: "Vocational & Development Programs", id: "development-id", count: 1 }
      ]
    }
  ])("fails closed when Workday facet $name cannot prove a complete partition", async ({ total, values }) => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({
        total,
        jobPostings: [],
        facets: [{ facetParameter: "jobFamilyGroup", values }]
      })
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }]
      }
    });

    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("complete partition"),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-facet-preflight-0000", extractorLocator: "$.facets" }],
        supportingArtifactOnlyFailure: { code: "FACET_DERIVATION_FAILED" }
      }
    });
  });

  it.each([
    {
      name: "descriptor drift",
      facets: [{ facetParameter: "jobFamilyGroup", values: [{ descriptor: "Renamed Development Programs", id: "development-id" }] }],
      reason: "excluded descriptor"
    },
    {
      name: "missing facet ids",
      facets: [{ facetParameter: "jobFamilyGroup", values: [{ descriptor: "Medical" }, { descriptor: "Vocational & Development Programs", id: "development-id" }] }],
      reason: "missing an id"
    },
    {
      name: "facet drift",
      facets: [{ facetParameter: "jobCategory", values: [{ descriptor: "Vocational & Development Programs", id: "development-id" }] }],
      reason: "facet parameter"
    }
  ])("fails closed on Workday facet exclusion $name", async ({ facets, reason }) => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-13T00:00:00.000Z"),
      http: async () => response({ total: 1, jobPostings: [], facets })
    });

    await expect(fetcher({
      ...plan,
      workday: {
        tenant: "roche",
        site: "roche-ext",
        appliedFacets: { Location_Country: ["china-id"] },
        facetDescriptorExclusions: [{
          facetParameter: "jobFamilyGroup",
          excludedDescriptors: ["Vocational & Development Programs"]
        }]
      }
    })).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining(reason),
      fetchEvidence: {
        artifacts: [{ logicalKey: "workday-facet-preflight-0000", extractorLocator: "$.facets" }]
      }
    });
  });

  it("merges discovered China location facets with configured business facets", async () => {
    const requests: unknown[] = [];
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async (request) => {
        requests.push(request);
        const body = JSON.parse(request.body);
        if (Array.isArray(body.appliedFacets?.locations)) {
          return response({
              total: 1,
              jobPostings: [
                {
                  title: "China Pharmaceutical Sales",
                  externalPath: "/job/China---Shanghai---Shanghai/China-Pharma_1",
                  locationsText: "Shanghai, China",
                  bulletFields: ["1"]
                }
              ]
            });
        }

        return response({
            total: 2,
            jobPostings: [],
            facets: [
              {
                facetParameter: "locationMainGroup",
                values: [
                  {
                    facetParameter: "locations",
                    descriptor: "Locations",
                    values: [
                      { descriptor: "Shanghai, China", id: "china-location", count: 1 },
                      { descriptor: "Tokyo, Japan", id: "japan-location", count: 1 }
                    ]
                  }
                ]
              }
            ]
          });
      }
    });

    const result = await fetcher({
      ...plan,
      workday: {
        tenant: "pfizer",
        site: "PfizerCareers",
        searchText: "China",
        appliedFacets: { jobFamilyGroup: ["pharma-category"] },
        pageSize: 2,
        maxPages: 2
      }
    });

    expect(result).toMatchObject({
      ok: true,
      payload: {
        jobPostings: [
          {
            sourceJobId: workdayId("/job/China---Shanghai---Shanghai/China-Pharma_1"),
            title: "China Pharmaceutical Sales",
            cities: ["上海"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1
      }
    });
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: { jobFamilyGroup: ["pharma-category"] },
          limit: 2,
          offset: 0
        })
      })
    );
    expect(requests[1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({
          appliedFacets: {
            jobFamilyGroup: ["pharma-category"],
            locations: ["china-location"]
          },
          limit: 2,
          offset: 0
        })
      })
    );
  });

  it("infers cities from Workday external paths when the location label is generic", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
          total: 1,
          jobPostings: [
            {
              title: "MA Expert",
              externalPath: "/job/China---Beijing---Beijing/MA-Expert_4960057",
              locationsText: "2 Locations",
              bulletFields: ["4960057"]
            }
          ]
        })
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      payload: {
        jobPostings: [
          {
            sourceJobId: workdayId("/job/China---Beijing---Beijing/MA-Expert_4960057"),
            locationRaw: "2 Locations",
            cities: ["北京"]
          }
        ]
      },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 1
      }
    });
  });

  it("marks Workday crawls incomplete when maxPages stops before the official total", async () => {
    const fetcher = createWorkdaySourceFetch({
      now: () => new Date("2026-07-08T00:00:00.000Z"),
      http: async () => response({
          total: 52,
          jobPostings: [
            {
              title: "China Medical Role",
              externalPath: "/job/China---Shanghai---Shanghai/_1",
              locationsText: "China - Shanghai - Shanghai",
              bulletFields: ["1"]
            }
          ]
        })
    });

    await expect(
      fetcher({
        ...plan,
        workday: { ...plan.workday, pageSize: 20, maxPages: 1 }
      })
    ).resolves.toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("MAX_PAGES_WITH_NEXT")
    });
  });
});
