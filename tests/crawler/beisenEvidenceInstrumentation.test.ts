import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonFetchConfig,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const NOW = "2026-07-11T00:00:00.000Z";
const ENTRY = "https://cttq.zhiye.com/social/jobs";
const API = "https://cttq.zhiye.com/api/Jobad/GetJobAdPageList";

function plan(
  overrides: Partial<Omit<Extract<OfficialJsonFetchConfig, { kind: "beisen-zhiye-2022" }>, "kind">> = {}
): SourceCrawlPlan {
  return {
    adapterId: "official-json",
    company: { id: "company-beisen", officialChineseName: "正大天晴药业集团股份有限公司" },
    source: {
      id: "source-beisen-social",
      companyId: "company-beisen",
      kind: "SOCIAL",
      atsKind: "OFFICIAL_JSON",
      status: "VERIFIED_SCRAPABLE",
      officialEntryUrl: ENTRY,
      officialChainEvidenceUrl: ENTRY
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
    },
    officialJsonFetch: {
      kind: "beisen-zhiye-2022",
      category: "1",
      pageSize: 2,
      maxPages: 5,
      detailPath: "social/detail",
      ...overrides
    }
  };
}

function response(body: unknown, overrides: Partial<OfficialJsonHttpResponse> = {}): OfficialJsonHttpResponse {
  return {
    status: 200,
    finalUrl: API,
    contentType: "application/json; charset=utf-8",
    capturedAt: NOW,
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...overrides
  };
}

function job(id: string, location: unknown = ["上海市"]): Record<string, unknown> {
  return {
    Id: `guid-${id}`,
    JobAdId: id,
    JobAdName: `职位 ${id}`,
    LocNames: location,
    Category: "社会招聘",
    CategoryId: "1",
    Kind: "全职"
  };
}

describe("Beisen Zhiye 2022 evidence instrumentation", () => {
  it("retains exact 0-based page artifacts, Count coordinates, and manual D1 evidence", async () => {
    const bodies = [
      JSON.stringify({ Code: 200, Count: 3, PageIndex: 0, Data: [job("1000"), job("1001")] }),
      JSON.stringify({ Code: 200, Count: 3, PageIndex: 1, Data: [job("1002")] })
    ];
    let call = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(bodies[call++]!)
    });

    const result = await fetcher(plan());

    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 3,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        pageSize: 2,
        pagesVisited: 2
      },
      fetchEvidence: {
        fetchCounts: { rawCount: 3, parsedCount: 3, validCount: 3, parseDiscardCount: 0, validationDiscardCount: 0 },
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 3, scope: "SOURCE" }
      }
    });
    if (!result.fetchEvidence) throw new Error("expected Beisen evidence");
    expect(result.fetchEvidence.artifacts.map(({ logicalKey, body }) => ({ logicalKey, body }))).toEqual([
      { logicalKey: "beisen-page-0000", body: bodies[0] },
      { logicalKey: "beisen-page-0001", body: bodies[1] }
    ]);
    expect(result.fetchEvidence.artifacts[0]?.extractorLocator).toContain("json:$.Count,$.Data");
    expect(result.fetchEvidence.artifacts[0]?.extractorLocator).toContain("requestPageIndex:0");
    expect(result.fetchEvidence.pages).toMatchObject([
      { requestedPage: 0, returnedPage: 0, declaredTotal: 3, declaredPages: null, termination: "CONTINUE" },
      { requestedPage: 1, returnedPage: 1, declaredTotal: 3, declaredPages: null, termination: "NEXT_ABSENT" }
    ]);
    expect(result.paginationEvaluation).toMatchObject({ safeCompleteness: true, verifiedEligible: false });
  });

  it.each([
    ["invalid JSON", "{"],
    ["invalid root", []],
    ["missing Code", { Count: 0, Data: [] }],
    ["bad Code", { Code: 500, Count: 0, Data: [] }],
    ["invalid Data", { Code: 200, Count: 0, Data: {} }],
    ["invalid Count", { Code: 200, Count: "1", Data: [] }],
    ["invalid returned page", { Code: 200, Count: 0, PageIndex: "0", Data: [] }]
  ])("fails closed with the exact current artifact for %s", async (_label, body) => {
    const exact = JSON.stringify(body);
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response(exact)
    })(plan());
    expect(result.ok).toBe(false);
    expect(result.fetchEvidence?.artifacts[0]?.body).toBe(exact);
    expect(result.fetchEvidence?.pages[0]).toMatchObject({ requestedPage: 0, termination: "FAILED" });
  });

  it("retains a wrong-MIME response artifact and rejects missing response metadata", async () => {
    const exact = JSON.stringify({ Code: 200, Count: 0, Data: [] });
    const wrongMime = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response(exact, { contentType: "text/html" })
    })(plan());
    expect(wrongMime).toMatchObject({ ok: false, fetchEvidence: { artifacts: [{ body: exact }] } });

    const missingMetadata = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => ({ status: 200, body: exact })
    })(plan());
    expect(missingMetadata).toMatchObject({ ok: false });
    expect(missingMetadata.fetchEvidence).toBeUndefined();
  });

  it.each([
    ["Code", '{"Code":500,"Code":200,"Count":0,"PageIndex":0,"Data":[]}'],
    ["Count", '{"Code":200,"Count":9,"Count":0,"PageIndex":0,"Data":[]}'],
    ["Data", '{"Code":200,"Count":0,"PageIndex":0,"Data":[{"Id":"hidden"}],"Data":[]}']
  ])("rejects duplicate top-level %s keys instead of accepting JSON overwrite", async (_key, exact) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response(exact)
    })(plan());
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{ body: exact }], pages: [{ termination: "FAILED" }] }
    });
  });

  it.each([
    ["record", '{"Code":200,"Count":1,"PageIndex":0,"Data":[{"Id":"first","Id":"second","JobAdName":"职位","LocNames":["上海市"]}]}'],
    ["nested object", '{"Code":200,"Count":1,"PageIndex":0,"Data":[{"Id":"first","JobAdName":"职位","LocNames":["上海市"],"Meta":{"region":"CN","region":"US"}}]}']
  ])("rejects duplicate keys in every raw JSON object: %s", async (_label, exact) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response(exact)
    })(plan());
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{ body: exact }], pages: [{ termination: "FAILED" }] }
    });
  });

  it("allows the same key name in different JSON objects", async () => {
    const exact = '{"Code":200,"Count":2,"PageIndex":0,"Data":[{"Id":"first","JobAdName":"职位一","LocNames":["上海市"],"Meta":{"region":"CN"}},{"Id":"second","JobAdName":"职位二","LocNames":["北京市"],"Meta":{"region":"CN"}}]}';
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response(exact)
    })(plan());
    expect(result).toMatchObject({ ok: true, fetchEvidence: { fetchCounts: { validCount: 2 } } });
  });

  it("uses D1 to fail Count changes, repeated bodies, and returned-page mismatches", async () => {
    const attacks = [
      [response({ Code: 200, Count: 3, PageIndex: 0, Data: [job("1"), job("2")] }), response({ Code: 200, Count: 4, PageIndex: 1, Data: [job("3")] })],
      [response({ Code: 200, Count: 4, PageIndex: 0, Data: [job("1"), job("2")] }), response({ Code: 200, Count: 4, PageIndex: 0, Data: [job("1"), job("2")] })],
      [response({ Code: 200, Count: 3, PageIndex: 0, Data: [job("1"), job("2")] }), response({ Code: 200, Count: 3, PageIndex: 9, Data: [job("3")] })]
    ];
    for (const [attackIndex, pages] of attacks.entries()) {
      let call = 0;
      const result = await createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async () => pages[call++]! })(plan());
      expect(result.ok).toBe(false);
      expect(result.paginationEvaluation?.safeCompleteness, `attack ${attackIndex}: ${JSON.stringify(result)}`).toBe(false);
      expect(result.fetchEvidence?.artifacts).toHaveLength(2);
    }
  });

  it("uses D1 to reject an intermediate empty page without making another request", async () => {
    const pages = [
      response({ Code: 200, Count: 3, PageIndex: 0, Data: [job("1"), job("2")] }),
      response({ Code: 200, Count: 3, PageIndex: 1, Data: [] })
    ];
    let call = 0;
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => pages[call++]!
    })(plan());
    expect(call).toBe(2);
    expect(result).toMatchObject({
      ok: false,
      paginationEvaluation: { safeCompleteness: false, derivedAnomalyCodes: ["INTERMEDIATE_EMPTY_PAGE"] },
      fetchEvidence: { pages: [{ termination: "CONTINUE" }, { termination: "ABORTED" }] }
    });
  });

  it("traverses every requested page when modern Beisen omits response PageIndex", async () => {
    const rows = Array.from({ length: 205 }, (_, index) =>
      job(String(index + 1), [index % 2 === 0 ? "山东省·临沂市" : "江苏省·连云港市"]));
    const requests: Array<{ PageIndex: number; PageSize: number; Category: string[] }> = [];
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => {
        const body = JSON.parse(request.body ?? "{}") as { PageIndex: number; PageSize: number; Category: string[] };
        requests.push(body);
        const start = body.PageIndex * body.PageSize;
        return response({ Code: 200, Count: rows.length, Total: rows.length, Data: rows.slice(start, start + body.PageSize) });
      }
    })(plan({ pageSize: 100, geographyScope: "DOMESTIC_OFFICIAL_TENANT" }));

    expect(requests).toEqual([
      expect.objectContaining({ PageIndex: 0, PageSize: 100, Category: ["1"] }),
      expect.objectContaining({ PageIndex: 1, PageSize: 100, Category: ["1"] }),
      expect.objectContaining({ PageIndex: 2, PageSize: 100, Category: ["1"] })
    ]);
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: expect.arrayContaining([expect.objectContaining({ title: "职位 205" })]) },
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW", expectedJobCount: 205, pagesVisited: 3 },
      fetchEvidence: {
        fetchCounts: { rawCount: 205, parsedCount: 205, validCount: 205 },
        pages: [
          { requestedPage: 0, returnedPage: null, requestedPageSize: 100, termination: "CONTINUE" },
          { requestedPage: 1, returnedPage: null, requestedPageSize: 100, termination: "CONTINUE" },
          { requestedPage: 2, returnedPage: null, requestedPageSize: 100, termination: "NEXT_ABSENT" }
        ]
      },
      paginationEvaluation: { safeCompleteness: true, derivedAnomalyCodes: [] }
    });
  });

  it("fails closed when modern Beisen explicitly returns the wrong PageIndex", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 1, PageIndex: 9, Data: [job("1")] })
    })(plan({ geographyScope: "DOMESTIC_OFFICIAL_TENANT" }));
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { pages: [{ requestedPage: 0, returnedPage: 9 }] },
      paginationEvaluation: { safeCompleteness: false, derivedAnomalyCodes: ["RETURNED_PAGE_MISMATCH"] }
    });
  });

  it.each([
    ["Hong Kong", "OUT_OF_SCOPE"],
    ["台湾省·台北市", "OUT_OF_SCOPE"],
    ["Macau", "OUT_OF_SCOPE"],
    ["Remote", "AMBIGUOUS_SCOPE"],
    ["", "MISSING_REQUIRED_FIELD"]
  ])("rejects domestic-tenant foreign or ambiguous geography %s", async (location, code) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 1, Data: [{ ...job("scope"), LocNames: location ? [location] : [] }] })
    })(plan({ geographyScope: "DOMESTIC_OFFICIAL_TENANT" }));
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code } }]
      }
    });
  });

  it.each([
    [{ Category: "校园招聘", CategoryId: "2", Kind: "全职" }],
    [{ Category: "社会招聘", CategoryId: "2", Kind: "全职" }],
    [{ Category: "社会招聘", CategoryId: "1", Kind: "实习招聘" }]
  ])("fails the whole source when a raw record leaks outside the requested social channel", async (override) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 2, Data: [job("ok"), { ...job("leak"), ...override }] })
    })(plan({ geographyScope: "DOMESTIC_OFFICIAL_TENANT" }));
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        pages: [{ termination: "FAILED" }],
        fetchLosses: [{ details: { code: "SOCIAL_CHANNEL_MISMATCH", pageSequence: 0, recordIndex: 1 } }]
      }
    });
  });

  it("accounts parse, required-field, duplicate, scope, unsafe-ID, sensitive, and fallback-location losses exactly", async () => {
    const rows: unknown[] = [
      "not-an-object",
      { Id: "missing-title", LocNames: ["上海市"] },
      job("ok"),
      job("ok"),
      job("foreign", ["Boston, United States"]),
      job("unknown", ["Remote"]),
      job("..", ["上海市"]),
      { ...job("secret", ["上海市"]), JobAdName: "token=super-secret" },
      { Id: "fallback", JobAdName: "无地点" }
    ];
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: rows.length, PageIndex: 0, Data: rows })
    })(plan({ pageSize: 20, defaultLocationRaw: "未披露" }));

    expect(result).toMatchObject({
      ok: true,
      fetchEvidence: {
        fetchCounts: { rawCount: 9, parsedCount: 8, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 7 }
      }
    });
    expect(result.fetchEvidence?.fetchLosses).toHaveLength(8);
    expect(result.fetchEvidence?.fetchLosses.map((loss) => loss.details?.code)).toEqual([
      "NON_OBJECT_RECORD", "MISSING_REQUIRED_FIELD", "DUPLICATE_OFFICIAL_ID", "OUT_OF_SCOPE",
      "OUT_OF_SCOPE", "UNSAFE_OFFICIAL_ID", "SENSITIVE_OUTPUT", "DECLARED_LOCATION_FALLBACK"
    ]);
    expect(JSON.stringify({ ...result, fetchEvidence: { ...result.fetchEvidence, artifacts: [] } })).not.toContain("super-secret");
  });

  it("rejects a record with mixed China and foreign scope markers as ambiguous", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({
        Code: 200,
        Count: 1,
        PageIndex: 0,
        Data: [{ ...job("mixed", ["Shanghai, China / Boston, United States"]), Country: "China" }]
      })
    })(plan());
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "AMBIGUOUS_SCOPE" } }]
      }
    });
  });

  it("rejects a duplicate detail ID independently from distinct official record IDs", async () => {
    const rows = [
      { Id: "official-a", JobAdId: "shared-detail", JobAdName: "职位 A", LocNames: ["上海市"] },
      { Id: "official-b", JobAdId: "shared-detail", JobAdName: "职位 B", LocNames: ["北京市"] }
    ];
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 2, PageIndex: 0, Data: rows })
    })(plan());
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [{ title: "职位 A", officialUrl: `${ENTRY.replace("/jobs", "/detail")}?jobAdId=shared-detail` }] },
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 1, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "DUPLICATE_DETAIL_ID", field: "detailId" } }]
      }
    });
  });

  it.each([
    ["same-page zero", [{ Code: 200, Count: 0, PageIndex: 0, Data: [job("1")] }]],
    ["same-page undercount", [{ Code: 200, Count: 1, PageIndex: 0, Data: [job("1"), job("2")] }]],
    ["later cumulative overrun", [
      { Code: 200, Count: 3, PageIndex: 0, Data: [job("1"), job("2")] },
      { Code: 200, Count: 3, PageIndex: 1, Data: [job("3"), job("4")] }
    ]]
  ])("fails official Count contradiction: %s", async (_label, payloads) => {
    let call = 0;
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response(payloads[call++]!)
    })(plan());
    expect(result).toMatchObject({ ok: false, failureReason: "Beisen Zhiye official Count is smaller than the raw record count" });
    expect(result.fetchEvidence?.artifacts).toHaveLength(payloads.length);
    expect(result.fetchEvidence?.pages.at(-1)).toMatchObject({ termination: "FAILED" });
    expect(result.fetchEvidence?.fetchCounts.rawCount).toBe(payloads.reduce((sum, item) => sum + item.Data.length, 0));
  });

  it("rejects a path-normalizing configured detail path instead of emitting a different official URL", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 1, PageIndex: 0, Data: [job("1")] })
    })(plan({ detailPath: "social/../admin" }));
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "UNSAFE_OFFICIAL_URL", field: "officialUrl" } }]
      },
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }
    });
  });

  it.each([
    ["short", [job("1")]],
    ["empty", []],
    ["full", [job("1"), job("2")]]
  ])("keeps a no-Count %s page ABORTED and noncertifying", async (_label, rows) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW), http: async () => response({ Code: 200, PageIndex: 0, Data: rows })
    })(plan());
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { pages: [{ termination: "ABORTED", declaredTotal: null, declaredPages: null }] },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
  });

  it("marks max-with-next through D1 and never synthesizes observed page counts", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 3, PageIndex: 0, Data: [job("1"), job("2")] })
    })(plan({ maxPages: 1 }));
    expect(result).toMatchObject({ ok: false, paginationEvaluation: { safeCompleteness: false } });
    expect(result.fetchEvidence?.pages[0]).toMatchObject({ termination: "MAX_PAGE_LIMIT", declaredPages: null });
    expect(result.fetchEvidence?.pages[0]?.anomalyCodes).not.toContain("MAX_PAGE_LIMIT");
  });

  it("preserves the exact Beisen evidence references through runSourceCrawl's safe clone", async () => {
    const fetched = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 1, PageIndex: 0, Data: [job("1")] })
    })(plan());
    if (!fetched.ok || !fetched.fetchEvidence || !fetched.paginationEvaluation) {
      throw new Error("expected successful Beisen evidence");
    }
    const result = await runSourceCrawl(plan(), { fetch: async () => fetched });
    expect(result.fetchEvidence).toBe(fetched.fetchEvidence);
    expect(result.paginationEvaluation).toBe(fetched.paginationEvaluation);
    expect(result.observation.completenessStatus).toBe("NEEDS_MANUAL_COMPLETENESS_REVIEW");
  });
});
