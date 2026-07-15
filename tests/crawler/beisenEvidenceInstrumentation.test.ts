import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonFetchConfig,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

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
    Id: beisenUuid(id),
    JobAdId: id,
    JobAdName: `职位 ${id}`,
    LocNames: location,
    Category: "社会招聘",
    CategoryId: "1",
    Kind: "全职"
  };
}

function beisenUuid(seed: string): string {
  const suffix = createHash("sha256").update(seed, "utf8").digest("hex").slice(0, 12);
  return `00000000-0000-4000-8000-${suffix}`;
}

type BeisenPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;

const AUDITED_DOMESTIC_BEISEN_SOURCES = [
  "source-nhu-social",
  "source-dongyangguang-social",
  "source-qilu-social",
  "source-3sbio-social"
] as const;

function exactBeisenPlan(sourceId: string): BeisenPlan {
  const plans = buildStagedSourceCrawlPlans(candidateCompanies);
  const value = getPlanBySourceId(plans, sourceId);
  if (value?.adapterId !== "official-json" || value.officialJsonFetch?.kind !== "beisen-zhiye-2022" ||
    value.officialJsonFetch.geographyScope !== "DOMESTIC_OFFICIAL_TENANT") {
    throw new Error(`Expected exact domestic Beisen plan ${sourceId}`);
  }
  return value;
}

async function fetchExactBeisen(
  sourceId: string,
  locations: readonly string[]
) {
  const exactPlan = exactBeisenPlan(sourceId);
  const endpoint = new URL("/api/Jobad/GetJobAdPageList", exactPlan.source.officialEntryUrl).toString();
  const rawJob = {
    ...job(sourceId, [...locations]),
    JobAdName: `职位 ${sourceId}`
  };
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(NOW),
    http: async () => ({
      ...response({ Code: 200, Count: 1, PageIndex: 0, Data: [rawJob] }),
      finalUrl: endpoint
    })
  });
  return { exactPlan, fetched: await fetcher(exactPlan) };
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
    const exact = JSON.stringify({ Code: 200, Count: 2, PageIndex: 0, Data: [
      { ...job("first"), JobAdName: "职位一", Meta: { region: "CN" } },
      { ...job("second", ["北京市"]), JobAdName: "职位二", Meta: { region: "CN" } }
    ] });
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
    ["韩国·首尔市", "OUT_OF_SCOPE"],
    ["山东省·潍坊市·高密市/Hong Kong", "OUT_OF_SCOPE"],
    ["台湾·高雄市", "OUT_OF_SCOPE"],
    ["香港·九龙", "OUT_OF_SCOPE"],
    ["港澳台", "OUT_OF_SCOPE"],
    ["国外", "OUT_OF_SCOPE"],
    ["市场中心", "AMBIGUOUS_SCOPE"],
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

  it("rejects an unknown location even when a structured country field says mainland China", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({
        Code: 200,
        Count: 1,
        Data: [{ ...job("remote-cn", ["Remote"]), Country: "中国" }]
      })
    })(plan({ geographyScope: "DOMESTIC_OFFICIAL_TENANT" }));
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "AMBIGUOUS_SCOPE" } }]
      }
    });
  });

  it.each(AUDITED_DOMESTIC_BEISEN_SOURCES)(
    "keeps the production fetcher for exact staged %s only when every location segment is mainland",
    async (sourceId) => {
      const positive = await fetchExactBeisen(sourceId, ["浙江省·杭州市"]);
      expect(positive.fetched).toMatchObject({
        ok: true,
        payload: { jobs: [{ locationRaw: "浙江省·杭州市" }] },
        fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1, validationDiscardCount: 0 } }
      });

      const mixed = await fetchExactBeisen(sourceId, ["浙江", "苏黎世"]);
      expect(mixed.fetched).toMatchObject({
        ok: true,
        payload: { jobs: [] },
        fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 } }
      });
      const crawled = await runSourceCrawl(mixed.exactPlan, { fetch: async () => mixed.fetched });
      expect(crawled.truth.completenessVerified).toBe(false);
      expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
    }
  );

  it.each([
    "全国",
    "全国各地",
    "北京",
    "上海市",
    "浙江省",
    "山东省·临沂市",
    "上海市·浦东新区",
    "广东省·东莞市·长安镇",
    "山东省·潍坊市·高密市",
    "山东省·潍坊市·高密市/诸城市",
    "甘肃省·临夏回族自治州",
    "云南省·红河哈尼族彝族自治州",
    "青海省·黄南藏族自治州·同仁市",
    "新疆维吾尔自治区·伊犁哈萨克自治州",
    "Shanghai, China"
  ])("keeps a common unambiguous mainland location: %s", async (location) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 1, Data: [job(`mainland-${location}`, [location])] })
    })(plan({ geographyScope: "DOMESTIC_OFFICIAL_TENANT" }));
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [{ locationRaw: location }] },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1, validationDiscardCount: 0 } }
    });
  });

  it.each([
    [{ Category: "校园招聘", CategoryId: "2", Kind: "全职" }],
    [{ Category: "社会招聘", CategoryId: "2", Kind: "全职" }],
    [{ Category: "社会招聘", CategoryId: "1", Kind: "实习招聘" }],
    [{ Category: "社会招聘", CategoryId: "1", Kind: "实习" }],
    [{ Category: "社会招聘", CategoryId: "1", Kind: "实习生" }],
    [{ Category: "社会招聘", CategoryId: "1", Kind: "Intern" }],
    [{ Category: "社会招聘", CategoryId: "1", Kind: "Internship" }],
    [{ Category: "社会招聘", CategoryId: "1", Kind: "校园" }]
  ])("fails the whole source when a raw record leaks outside the requested social channel", async (override) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 2, Data: [job("ok"), { ...job("leak"), ...override }] })
    })(plan());
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
      { Id: beisenUuid("missing-title"), LocNames: ["上海市"], Category: "社会招聘", CategoryId: "1", Kind: "全职" },
      job("ok"),
      job("ok"),
      job("foreign", ["Boston, United States"]),
      job("unknown", ["Remote"]),
      { ...job("unsafe", ["上海市"]), Id: "../unsafe" },
      { ...job("secret", ["上海市"]), JobAdName: "token=super-secret" },
      { Id: beisenUuid("fallback"), JobAdName: "无地点", Category: "社会招聘", CategoryId: "1", Kind: "全职" }
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

  it("accepts the NHU source-bound Zhejiang and Japan multi-location policy without publishing Japan", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({
        Code: 200,
        Count: 1,
        PageIndex: 0,
        Data: [{
          ...job("mixed-nhu", ["浙江、日本"]),
          Id: "c9b0fcab-f326-4991-a9a9-f89d55abf4a4"
        }]
      })
    })(plan({
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      mixedLocationPolicy: "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
    }));

    expect(result).toMatchObject({
      ok: true,
      payload: {
        jobs: [{
          officialUrl: `${ENTRY.replace("/jobs", "/detail")}?jobAdId=c9b0fcab-f326-4991-a9a9-f89d55abf4a4`,
          locationRaw: "浙江、日本",
          cities: ["浙江"]
        }]
      },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, validationDiscardCount: 0 }
      }
    });
  });

  it.each(["日本", "东京", "大阪", "京都", "Japan", "Tokyo", "Osaka", "Kyoto"])(
    "keeps only Zhejiang when the NHU alternative is explicit Japan geography: %s",
    async (japanLocation) => {
      const result = await createOfficialJsonSourceFetch({
        now: () => new Date(NOW),
        http: async () => response({
          Code: 200,
          Count: 1,
          PageIndex: 0,
          Data: [job(`nhu-${japanLocation}`, ["浙江", japanLocation])]
        })
      })(plan({
        geographyScope: "DOMESTIC_OFFICIAL_TENANT",
        mixedLocationPolicy: "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
      }));
      expect(result).toMatchObject({
        ok: true,
        payload: { jobs: [{ locationRaw: `浙江 / ${japanLocation}`, cities: ["浙江"] }] },
        fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 1, validationDiscardCount: 0 } }
      });
    }
  );

  it.each([
    ["Japan-only", ["大阪"]],
    ["Swiss alternative", ["浙江", "巴塞尔"]],
    ["Thailand alternative", ["浙江", "曼谷"]],
    ["unknown alternative", ["浙江", "Remote"]],
    ["mixed ambiguous segment", ["浙江苏黎世"]]
  ])("rejects the NHU policy when it contains %s", async (_label, locations) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 1, PageIndex: 0, Data: [job(`nhu-${_label}`, locations)] })
    })(plan({
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      mixedLocationPolicy: "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
    }));
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 } }
    });
  });

  it("does not extend the NHU Japan alternative to another domestic Beisen source", async () => {
    const { fetched } = await fetchExactBeisen("source-qilu-social", ["浙江", "大阪"]);
    expect(fetched).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: { fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 } }
    });
  });

  it("does not extend the NHU Japan policy to a different foreign country", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({
        Code: 200,
        Count: 1,
        PageIndex: 0,
        Data: [job("mixed-korea", ["浙江、韩国"])]
      })
    })(plan({
      geographyScope: "DOMESTIC_OFFICIAL_TENANT",
      mixedLocationPolicy: "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES"
    }));

    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "OUT_OF_SCOPE" } }]
      }
    });
  });

  it.each([
    ["numeric Id", 230917983],
    ["numeric-string Id", "230917983"],
    ["arbitrary safe string Id", "official-a"]
  ])("rejects a Beisen %s because the original Id must be a canonical UUID string", async (_label, Id) => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({
        Code: 200,
        Count: 1,
        PageIndex: 0,
        Data: [{ ...job("invalid-id"), Id, JobAdId: "fallback-detail" }]
      })
    })(plan());

    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "UNSAFE_OFFICIAL_ID", field: "id" } }]
      }
    });
  });

  it("uses each official UUID for detail URLs even when numeric JobAdId values collide", async () => {
    const officialA = "8d2b8c8a-190c-4e6d-a521-79fbf7ab1663";
    const officialB = "c78ed37c-24b3-4be0-b0c4-f2538c263aa4";
    const rows = [
      { ...job("official-a"), Id: officialA, JobAdId: "shared-detail", JobAdName: "职位 A", LocNames: ["上海市"] },
      { ...job("official-b"), Id: officialB, JobAdId: "shared-detail", JobAdName: "职位 B", LocNames: ["北京市"] }
    ];
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({ Code: 200, Count: 2, PageIndex: 0, Data: rows })
    })(plan());
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [
        { title: "职位 A", officialUrl: `${ENTRY.replace("/jobs", "/detail")}?jobAdId=${officialA}` },
        { title: "职位 B", officialUrl: `${ENTRY.replace("/jobs", "/detail")}?jobAdId=${officialB}` }
      ] },
      fetchEvidence: {
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, validationDiscardCount: 0 },
        fetchLosses: []
      }
    });
  });

  it("does not fall back to a numeric JobAdId when the official detail UUID is absent", async () => {
    const result = await createOfficialJsonSourceFetch({
      now: () => new Date(NOW),
      http: async () => response({
        Code: 200,
        Count: 1,
        PageIndex: 0,
        Data: [{ ...job("numeric-only"), Id: undefined }]
      })
    })(plan());

    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [] },
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{ details: { code: "MISSING_REQUIRED_FIELD", field: "id" } }]
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
