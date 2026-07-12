import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";

const capturedAt = "2026-07-11T00:00:00.000Z";
const entryUrl = "https://careers.example.test/cn/zh/search-results?keywords=China";
const widgetUrl = "https://careers.example.test/widgets";
const refNum = "REFNUM-SHOULD-STAY-OPAQUE";

const plan = {
  adapterId: "official-json",
  company: { id: "company-phenom", officialChineseName: "Phenom 测试公司" },
  source: {
    id: "source-phenom-social",
    companyId: "company-phenom",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: entryUrl,
    officialChainEvidenceUrl: "https://careers.example.test/cn/zh/search-results"
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
    kind: "phenom",
    detailBaseUrl: "https://careers.example.test/cn/zh/job",
    countryFilter: "China",
    pageSize: 1,
    maxPages: 5
  }
} satisfies SourceCrawlPlan;

function entryHtml(overrides = ""): string {
  return `<script>var phApp={"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":"page18"${overrides}};</script>`;
}

function response(
  body: string,
  url: string,
  contentType: string,
  overrides: Partial<OfficialJsonHttpResponse> = {}
): OfficialJsonHttpResponse {
  return { status: 200, body, finalUrl: url, contentType, capturedAt, ...overrides };
}

function job(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jobSeqNo: id,
    title: `Medical role ${id}`,
    location: "Shanghai, China",
    city: "Shanghai",
    country: "China",
    applyUrl: `https://careers.example.test/cn/zh/job/${id}`,
    ...overrides
  };
}

function pageBody(jobs: unknown[], totalHits?: unknown, from?: unknown): string {
  return JSON.stringify({
    refineSearch: {
      ...(totalHits === undefined ? {} : { totalHits }),
      ...(from === undefined ? {} : { from }),
      data: { jobs }
    }
  });
}

function facetPageBody(
  jobs: unknown[],
  totalHits: number,
  from: number,
  aggregations: Array<{ field: string; value: Record<string, unknown> }>
): string {
  return JSON.stringify({
    refineSearch: { totalHits, from, data: { jobs, aggregations } }
  });
}

function withoutOpaqueBodies(value: unknown): string {
  const clone = structuredClone(value) as { fetchEvidence?: { artifacts?: Array<Record<string, unknown>> } };
  for (const artifact of clone.fetchEvidence?.artifacts ?? []) artifact.body = "[OPAQUE]";
  return JSON.stringify(clone);
}

describe("Phenom evidence instrumentation", () => {
  it("safely accepts the Roche static phApp fallback object with one separate literal pageId assignment", async () => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results"};
      phApp.pageId = "page11";
    </script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });

    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it("keeps the complete Roche bootstrap pageId authoritative over a later standalone runtime pageId", async () => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":"page11"};
    </script><script>phApp.pageId = "page11-ds";</script>`;
    const requests: Array<{ body?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
          : response(body, entryUrl, "text/html");
      }
    });

    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
    expect(JSON.parse(requests[1]?.body ?? "{}").pageId).toBe("page11");
  });

  it.each([
    ["dynamic pageId", `phApp.pageId = makePageId();`],
    ["conflicting pageIds", `phApp.pageId = "page11"; phApp.pageId = "page12";`],
    ["computed pageId", `phApp["pageId"] = "page11";`]
  ])("rejects Roche-style config with %s", async (_label, pageIdSource) => {
    const body = `<script>
      var phApp = phApp || {"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results"};
      ${pageIdSource}
    </script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });

    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it("proves a structured country/category facet scope before paginating the filtered jobs", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        },
        pageSize: 2
      }
    } satisfies SourceCrawlPlan;
    const requests: Array<{ method?: string; body?: string }> = [];
    const bodies = [
      facetPageBody([], 10, 0, [{ field: "country", value: { 中国大陆: 4, 瑞士: 6 } }]),
      facetPageBody([job("SAMPLE", { country: "中国大陆", category: "销售 & 市场" })], 4, 0, [
        { field: "category", value: { "销售 & 市场": 2, "医学事务": 1, "实习 & 发展项目": 1 } }
      ]),
      facetPageBody([
        job("CN-1", { country: "中国大陆", category: "销售 & 市场" }),
        job("CN-2", { country: "中国大陆", category: "医学事务" })
      ], 3, 0, []),
      facetPageBody([
        job("CN-3", { country: "中国大陆", category: "销售 & 市场" })
      ], 3, 2, [])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(bodies.shift()!, widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html");
      }
    });

    const result = await fetcher(scopedPlan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { expectedJobCount: 3, completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: {
        artifacts: [
          { kind: "OFFICIAL_COMPANY_PAGE" },
          { kind: "ATS_API_RESPONSE" },
          { kind: "ATS_API_RESPONSE" },
          { kind: "PAGINATION_PAGE" },
          { kind: "PAGINATION_PAGE" }
        ],
        declaredCompleteness: { value: 3, scope: "SOURCE" },
        fetchCounts: { rawCount: 3, validCount: 3 }
      }
    });
    expect(requests.slice(1).map((request) => JSON.parse(request.body ?? "{}").selected_fields)).toEqual([
      {},
      { country: ["中国大陆"] },
      { country: ["中国大陆"], category: ["销售 & 市场", "医学事务"] },
      { country: ["中国大陆"], category: ["销售 & 市场", "医学事务"] }
    ]);
  });

  it("accepts only an explicitly configured HTTPS apply origin endorsed by the Phenom payload", async () => {
    const externalApplyUrl = "https://ats.example.test/jobs/CN-1/apply";
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1", { applyUrl: externalApplyUrl })], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    const result = await fetcher({
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        allowedApplyOrigins: ["https://ats.example.test"]
      }
    });
    expect(result).toMatchObject({ ok: true, payload: { jobs: [{ officialUrl: externalApplyUrl }] } });
  });

  it.each([
    [
      "country total drift",
      facetPageBody([job("S", { country: "中国大陆", category: "销售 & 市场" })], 3, 0, [
        { field: "category", value: { "销售 & 市场": 2, "实习 & 发展项目": 1 } }
      ])
    ],
    [
      "out-of-country sample",
      facetPageBody([job("S", { country: "瑞士", category: "销售 & 市场" })], 4, 0, [
        { field: "category", value: { "销售 & 市场": 3, "实习 & 发展项目": 1 } }
      ])
    ],
    [
      "category partition drift",
      facetPageBody([job("S", { country: "中国大陆", category: "销售 & 市场" })], 4, 0, [
        { field: "category", value: { "销售 & 市场": 2, "实习 & 发展项目": 1 } }
      ])
    ]
  ])("fails closed when the country preflight has %s", async (_label, countryBody) => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 10, 0, [{ field: "country", value: { 中国大陆: 4, 瑞士: 6 } }]),
      countryBody
    ];
    let postCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
        postCount += 1;
        return response(bodies.shift()!, widgetUrl, "application/json");
      }
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({ ok: false });
    expect(postCount).toBe(2);
  });

  it("fails closed when filtered totals or records prove the server ignored the category scope", async () => {
    const scopedPlan = {
      ...plan,
      officialJsonFetch: {
        ...plan.officialJsonFetch,
        facetScope: {
          countryIncludeDescriptor: "中国大陆",
          categoryExcludeDescriptors: ["实习 & 发展项目"]
        }
      }
    } satisfies SourceCrawlPlan;
    const bodies = [
      facetPageBody([], 10, 0, [{ field: "country", value: { 中国大陆: 4, 瑞士: 6 } }]),
      facetPageBody([], 4, 0, [{
        field: "category", value: { "销售 & 市场": 3, "实习 & 发展项目": 1 }
      }]),
      facetPageBody([job("IGNORED", { country: "中国大陆", category: "实习 & 发展项目" })], 4, 0, [])
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });

    await expect(fetcher(scopedPlan)).resolves.toMatchObject({ ok: false });
  });
  it("retains exact entry and page artifacts, strict offsets and total coordinates while staying manual", async () => {
    const requests: Array<{ method?: string; body?: string }> = [];
    const bodies = [pageBody([job("CN-1")], 2, 0), pageBody([job("CN-2")], 2, 1)];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(bodies.shift()!, widgetUrl, "application/json; charset=utf-8")
          : response(entryHtml(), entryUrl, "text/html; charset=utf-8");
      }
    });

    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        expectedJobCount: 2,
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        pagesVisited: 2
      },
      fetchEvidence: {
        artifacts: [
          { kind: "OFFICIAL_COMPANY_PAGE", body: entryHtml() },
          { kind: "PAGINATION_PAGE" },
          { kind: "PAGINATION_PAGE" }
        ],
        pages: [
          { requestedOffset: 0, returnedOffset: 0, declaredTotal: 2, termination: "CONTINUE" },
          { requestedOffset: 1, returnedOffset: 1, declaredTotal: 2, termination: "NEXT_ABSENT" }
        ],
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 2, scope: "SOURCE" },
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0 }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false }
    });
    if (!result.ok || !result.fetchEvidence || !("payload" in result)) throw new Error("expected Phenom evidence");
    expect(result.fetchEvidence.declaredCompleteness?.extractorLocator).toContain("json:$.refineSearch.totalHits");
    expect(result.fetchEvidence.artifacts[1]?.extractorLocator).toBe(
      result.fetchEvidence.declaredCompleteness?.extractorLocator
    );
    expect(result.fetchEvidence.pages.flatMap((page) => page.rawJobIds)).toEqual([
      expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      expect.stringMatching(/^sha256:[0-9a-f]{64}$/)
    ]);
    expect((result.payload as { jobs: Array<{ sourceJobId: string }> }).jobs[0]?.sourceJobId)
      .toMatch(/^official-json:sha256:[0-9a-f]{64}$/);
    expect(withoutOpaqueBodies(result)).not.toContain(refNum);
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      from: 0,
      size: 1,
      selected_fields: { country: ["China"] },
      global: true
    });
  });

  it("retains an available entry artifact on wrong MIME and never parses its config", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(entryHtml(), entryUrl, "application/json")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE", body: entryHtml() }],
        pages: [{ termination: "FAILED" }]
      }
    });
    expect(withoutOpaqueBodies(result)).not.toContain(refNum);
  });

  it("accounts non-object, unknown/US scope, duplicate ID and credential-bearing URL exactly", async () => {
    const rawJobs = [
      null,
      job("UNKNOWN", { country: "", location: "Remote", city: "" }),
      job("US", { country: "United States", location: "Boston, United States", city: "Boston" }),
      job("CONFLICT", { country: "United States", location: "Shanghai, China", city: "Shanghai" }),
      job("CN-1"),
      job("CN-1", { title: "duplicate" }),
      job("LEAK", { applyUrl: "https://careers.example.test/cn/zh/job/LEAK?access_token=raw-secret" })
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody(rawJobs, 7, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, pageSize: 10 } });
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: {
        fetchCounts: { rawCount: 7, parsedCount: 6, validCount: 1, parseDiscardCount: 1, validationDiscardCount: 5 },
        fetchLosses: [
          { stage: "PARSE", details: { code: "NON_OBJECT_RECORD", pageSequence: 0, recordIndex: 0 } },
          { stage: "VALIDATION", details: { code: "OUT_OF_SCOPE", pageSequence: 0, recordIndex: 1 } },
          { stage: "VALIDATION", details: { code: "OUT_OF_SCOPE", pageSequence: 0, recordIndex: 2 } },
          { stage: "VALIDATION", details: { code: "OUT_OF_SCOPE", pageSequence: 0, recordIndex: 3 } },
          { stage: "VALIDATION", details: { code: "DUPLICATE_OFFICIAL_ID", pageSequence: 0, recordIndex: 5 } },
          { stage: "VALIDATION", details: { code: "UNSAFE_OFFICIAL_URL", pageSequence: 0, recordIndex: 6 } }
        ]
      }
    });
    expect(withoutOpaqueBodies(result)).not.toContain("raw-secret");
  });

  it("fails closed through D1 on unstable totals and retains both raw pages", async () => {
    const bodies = [pageBody([job("CN-1")], 3, 0), pageBody([job("CN-2")], 2, 1)];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{}, { kind: "PAGINATION_PAGE" }, { kind: "PAGINATION_PAGE" }] },
      paginationEvaluation: { safeCompleteness: false, derivedAnomalyCodes: ["TOTAL_CHANGED"] }
    });
  });

  it("retains invalid JSON and invalid jobs collection page evidence", async () => {
    for (const body of ["{", JSON.stringify({ refineSearch: { totalHits: 1, data: { jobs: {} } } })]) {
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => request.method === "POST"
          ? response(body, widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html")
      });
      const result = await fetcher(plan);
      expect(result).toMatchObject({
        ok: false,
        fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE", body }] }
      });
    }
  });

  it.each([
    ["missing entry metadata", { finalUrl: null as unknown as string }],
    ["false entry origin", { finalUrl: "https://evil.example.test/cn/zh/search-results?keywords=China" }],
    ["entry time before crawl", { capturedAt: "2026-07-10T23:59:59.999Z" }]
  ])("fails closed on %s", async (_label, overrides) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(entryHtml(), entryUrl, "text/html", overrides)
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({ ok: false });
    expect(withoutOpaqueBodies(result)).not.toContain(refNum);
  });

  it("retains the exact entry artifact when required widget config is missing", async () => {
    const body = "<html><body>no widget configuration</body></html>";
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => response(body, entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE", body }] }
    });
  });

  it.each([
    [
      "scattered key/value fragments",
      `<script>{"widgetApiEndpoint":"${widgetUrl}"}</script><script>{"refNum":"${refNum}","locale":"zh_cn","deviceType":"desktop","country":"cn","pageName":"search-results","pageId":"page18"}</script>`
    ],
    [
      "invalid phApp JSON",
      `<script>var phApp={"widgetApiEndpoint":"${widgetUrl}","refNum":"${refNum}","locale":"zh_cn","deviceType":"desktop","country":"cn","pageName":"search-results","pageId":"page18";</script>`
    ],
    [
      "multiple conflicting phApp objects",
      `${entryHtml()}<script>var phApp={"widgetApiEndpoint":"https://careers.example.test/other-widgets","country":"cn","deviceType":"mobile","locale":"en_us","refNum":"OTHER","pageName":"other","pageId":"page99"};</script>`
    ],
    [
      "wrong-typed own field",
      `<script>var phApp={"widgetApiEndpoint":"${widgetUrl}","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"${refNum}","pageName":"search-results","pageId":18};</script>`
    ]
  ])("rejects %s instead of stitching config across HTML", async (_label, body) => {
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found",
      fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE", body }] }
    });
    expect(requestCount).toBe(1);
  });

  it("accepts one strict application/json script object containing one phApp object", async () => {
    const body = `<script type="application/json">${JSON.stringify({
      phApp: {
        widgetApiEndpoint: widgetUrl,
        country: "cn",
        deviceType: "desktop",
        locale: "zh_cn",
        refNum,
        pageName: "search-results",
        pageId: "page18"
      }
    })}</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" }
    });
  });

  it("ignores phApp text inside comments, strings and templates while accepting the real assignment", async () => {
    const fake = `{"widgetApiEndpoint":"https://careers.example.test/evil","country":"us","deviceType":"mobile","locale":"en_us","refNum":"EVIL","pageName":"evil","pageId":"evil"}`;
    const body = `<script>
      // phApp = ${fake};
      const quoted = ${JSON.stringify(`phApp = ${fake}`)};
      const templated = \`phApp = ${fake}\`;
      /* window.phApp = ${fake}; */
      window.phApp = ${entryHtml().match(/phApp=(\{.*\});/u)?.[1]};
    </script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it("does not accept a phApp-looking assignment outside a real script element", async () => {
    const body = `<div>window.phApp = ${entryHtml().match(/phApp=(\{.*\});/u)?.[1]};</div>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it("rejects duplicate required JSON keys before JSON.parse can overwrite them", async () => {
    const body = `<script>window.phApp={"widgetApiEndpoint":"${widgetUrl}","refNum":"${refNum}","locale":"zh_cn","deviceType":"desktop","country":"cn","pageName":"search-results","pageId":"page18","pageId":"page99"};</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    ["regex literal", (config: string) => `const matcher = /phApp = ${config.replaceAll("/", "\\/")}/;`],
    ["function default parameter", (config: string) => `function nested(phApp = ${config}) { return phApp; }`],
    ["local block declaration", (config: string) => `{ const phApp = ${config}; void phApp; }`],
    ["nested function declaration", (config: string) => `function nested() { const phApp = ${config}; return phApp; }`],
    ["nested IIFE assignment", (config: string) => `(() => { window.phApp = ${config}; })();`],
    ["computed window member", (config: string) => `window["phApp"] = ${config};`],
    ["other member alias", (config: string) => `holder.phApp = ${config};`]
  ])("rejects non-top-level executable config from %s", async (_label, source) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script>${source(config)}</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each(["var", "let", "const"] as const)(
    "accepts a top-level %s phApp object declaration",
    async (declaration) => {
      const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
      const body = `<script>${declaration} phApp = ${config};</script>`;
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => request.method === "POST"
          ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
          : response(body, entryUrl, "text/html")
      });
      await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
    }
  );

  it("accepts a top-level window.phApp assignment expression", async () => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script>window.phApp = ${config};</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["spread", (config: string) => `const base = {}; const phApp = {...base, ${config.slice(1, -1)}};`],
    ["computed property", (config: string) => `const phApp = ${config.replace('"pageId"', '["pageId"]')};`],
    ["method", (config: string) => `const phApp = {helper(){}, ${config.slice(1, -1)}};`],
    ["dynamic required value", (config: string) => `const phApp = ${config.replace('"pageId":"page18"', '"pageId":makePageId()')};`]
  ])("rejects ambiguous top-level ObjectExpression using %s", async (_label, source) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script>${source(config)}</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    "text/template",
    "text/plain",
    "application/ld+json",
    "application/x-phenom-config",
    "text/plain; text/javascript",
    "application/ld+json; charset=utf-8"
  ])("ignores inert script type %s even when its body contains phApp", async (type) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const body = `<script type="${type}">const phApp = ${config};</script>`;
    let requestCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async () => {
        requestCount += 1;
        return response(body, entryUrl, "text/html");
      }
    });
    await expect(fetcher(plan)).resolves.toMatchObject({
      ok: false,
      failureReason: "Phenom required widget configuration was not found"
    });
    expect(requestCount).toBe(1);
  });

  it.each([
    ["absent", undefined, "const"],
    ["empty", "", "const"],
    ["whitespace", "   ", "const"],
    ["text javascript", "text/javascript", "const"],
    ["application javascript", "application/javascript", "const"],
    ["case and MIME parameter", "  TEXT/JAVASCRIPT ; charset=UTF-8  ", "const"],
    ["module", "module", "const"]
  ] as const)("accepts executable script type %s", async (_label, type, declaration) => {
    const config = entryHtml().match(/phApp=(\{.*\});/u)?.[1] ?? "{}";
    const typeAttribute = type === undefined ? "" : ` type="${type}"`;
    const body = `<script${typeAttribute}>${declaration} phApp = ${config};</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it("keeps application/json with a MIME parameter on the strict JSON path", async () => {
    const body = `<script type=" Application/JSON ; charset=utf-8 ">${JSON.stringify({
      phApp: {
        widgetApiEndpoint: widgetUrl,
        country: "cn",
        deviceType: "desktop",
        locale: "zh_cn",
        refNum,
        pageName: "search-results",
        pageId: "page18"
      }
    })}</script>`;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(body, entryUrl, "text/html")
    });
    await expect(fetcher(plan)).resolves.toMatchObject({ ok: true });
  });

  it.each([
    ["wrong page MIME", { contentType: "text/html" }],
    ["false page URL", { finalUrl: "https://evil.example.test/widgets" }],
    ["future page time", { capturedAt: "2026-07-11T00:00:00.001Z" }]
  ])("fails closed on %s while retaining every safely available prior artifact", async (_label, overrides) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json", overrides)
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({ ok: false });
    expect(result.fetchEvidence?.artifacts[0]).toMatchObject({ kind: "OFFICIAL_COMPANY_PAGE" });
  });

  it.each([
    [
      "repeated response and ID set",
      [pageBody([job("CN-1")], 3, 0), pageBody([job("CN-1")], 3, 0)],
      ["MAX_PAGES_WITH_NEXT", "REPEATED_JOB_ID_SET_WITH_NEXT", "REPEATED_RESPONSE_FINGERPRINT"]
    ],
    [
      "returned offset mismatch",
      [pageBody([job("CN-1")], 1, 7)],
      ["OFFSET_NOT_ADVANCING"]
    ],
    [
      "max page with next",
      [pageBody([job("CN-1")], 2, 0)],
      ["MAX_PAGES_WITH_NEXT"]
    ]
  ])("fails closed through D1 on %s", async (_label, suppliedBodies, expectedCodes) => {
    const bodies = [...suppliedBodies];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch, maxPages: suppliedBodies.length }
    });
    expect(result).toMatchObject({ ok: false, paginationEvaluation: { safeCompleteness: false } });
    if (!result.paginationEvaluation) throw new Error("expected pagination evaluation");
    expect(result.paginationEvaluation.derivedAnomalyCodes).toEqual(expect.arrayContaining(expectedCodes));
  });

  it("fails closed through D1 on an intermediate empty page and retains the later page", async () => {
    const bodies = [
      pageBody([job("CN-1")], 3, 0),
      pageBody([], 3, 1),
      pageBody([job("CN-3")], 3, 2)
    ];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(bodies.shift()!, widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, maxPages: 3 } });
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{}, {}, {}, {}] },
      paginationEvaluation: { derivedAnomalyCodes: ["INTERMEDIATE_EMPTY_PAGE", "MAX_PAGES_WITH_NEXT"] }
    });
  });

  it.each(["transport", "metadata"] as const)(
    "marks the last trusted page ABORTED when a later %s failure has no trustworthy response artifact",
    async (failureKind) => {
      let postCount = 0;
      const fetcher = createOfficialJsonSourceFetch({
        now: () => new Date(capturedAt),
        http: async (request) => {
          if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
          postCount += 1;
          if (postCount === 1) {
            return response(pageBody([job("CN-1")], 3, 0), widgetUrl, "application/json");
          }
          if (failureKind === "transport") throw new Error("raw transport secret");
          return response(pageBody([job("CN-2")], 3, 1), widgetUrl, "application/json", {
            finalUrl: "https://evil.example.test/widgets"
          });
        }
      });
      const result = await fetcher(plan);
      expect(result).toMatchObject({
        ok: false,
        fetchEvidence: {
          artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE" }],
          pages: [{ sequence: 0, termination: "ABORTED", nextPageSignalAfter: "offset:1" }],
          fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1 }
        }
      });
      expect(JSON.stringify(result)).not.toContain("raw transport secret");
    }
  );

  it("adds a FAILED page when a later invalid JSON response has a trustworthy artifact", async () => {
    let postCount = 0;
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        if (request.method !== "POST") return response(entryHtml(), entryUrl, "text/html");
        postCount += 1;
        return postCount === 1
          ? response(pageBody([job("CN-1")], 3, 0), widgetUrl, "application/json")
          : response("{", widgetUrl, "application/json");
      }
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: {
        artifacts: [{}, {}, { kind: "PAGINATION_PAGE", body: "{" }],
        pages: [{ sequence: 0, termination: "CONTINUE" }, { sequence: 1, termination: "FAILED" }]
      }
    });
  });

  it("does not invent a total when totalHits is absent and keeps completeness manual", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], undefined, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher({ ...plan, officialJsonFetch: { ...plan.officialJsonFetch, pageSize: 2 } });
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { pages: [{ declaredTotal: null, termination: "ABORTED" }] },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
    if (!result.ok) throw new Error("expected manual Phenom result");
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
    expect(result.completeness?.expectedJobCount).toBeUndefined();
  });

  it("keeps an empty no-total response ABORTED, manual and non-certifying", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([], undefined, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: true,
      completeness: { completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW" },
      fetchEvidence: { pages: [{ rawJobIds: [], validJobIds: [], termination: "ABORTED" }] },
      paginationEvaluation: { safeCompleteness: false, verifiedEligible: false }
    });
  });

  it.each([null, -1, 1.5, "2"])('fails with retained evidence for invalid own totalHits %j', async (totalHits) => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], totalHits, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const result = await fetcher(plan);
    expect(result).toMatchObject({
      ok: false,
      fetchEvidence: { artifacts: [{ kind: "OFFICIAL_COMPANY_PAGE" }, { kind: "PAGINATION_PAGE" }] }
    });
  });

  it("does not certify SOURCE scope when the configured facet is not exact China", async () => {
    const requests: Array<{ body?: string }> = [];
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => {
        requests.push(request);
        return request.method === "POST"
          ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
          : response(entryHtml(), entryUrl, "text/html");
      }
    });
    const result = await fetcher({
      ...plan,
      officialJsonFetch: { ...plan.officialJsonFetch, countryFilter: "United States" }
    });
    expect(JSON.parse(requests[1]?.body ?? "{}")).toMatchObject({
      selected_fields: { country: ["United States"] }
    });
    if (!result.ok) throw new Error("expected non-China request to remain manual");
    expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
    expect(result.completeness?.expectedJobCount).toBeUndefined();
  });

  it("preserves success and failure evidence references through runSourceCrawl", async () => {
    const fetcher = createOfficialJsonSourceFetch({
      now: () => new Date(capturedAt),
      http: async (request) => request.method === "POST"
        ? response(pageBody([job("CN-1")], 1, 0), widgetUrl, "application/json")
        : response(entryHtml(), entryUrl, "text/html")
    });
    const fetchResult = await fetcher(plan);
    if (!fetchResult.ok || !fetchResult.fetchEvidence || !fetchResult.paginationEvaluation) {
      throw new Error("expected successful fetch evidence");
    }
    const success = await runSourceCrawl(plan, { fetch: async () => fetchResult });
    expect(success.fetchEvidence).toBe(fetchResult.fetchEvidence);
    expect(success.paginationEvaluation).toBe(fetchResult.paginationEvaluation);
    expect(withoutOpaqueBodies(success)).not.toContain(refNum);

    const failureFetch = { ...fetchResult, ok: false as const, failureReason: "safe failure" };
    const failure = await runSourceCrawl(plan, { fetch: async () => failureFetch });
    expect(failure.fetchEvidence).toBe(fetchResult.fetchEvidence);
    expect(failure.paginationEvaluation).toBe(fetchResult.paginationEvaluation);
  });
});
