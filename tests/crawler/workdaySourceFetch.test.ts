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
          searchText: "China",
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
            total: 20,
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
          searchText: "China",
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
