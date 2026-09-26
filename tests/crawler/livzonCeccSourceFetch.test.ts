import { describe, expect, it } from "vitest";
import {
  createLivzonCeccSourceFetch,
  type LivzonCeccHttpRequest,
  type LivzonCeccHttpResponse
} from "../../src/crawler/livzonCeccSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-07-16T00:00:00.000Z";
const origin = "https://www.livzon.com.cn";
const socialIndexUrl = `${origin}/Social.html`;
const listApiUrl =
  `${origin}/nportal/fwebapi/product/product/es/findPage?appId=143150160001&templateId=product`;
const routeDeclaredListApiUrl =
  `${origin}/fwebapi/product/product/es/findPage?appId=143150160001&templateId=product`;

const auditedPartitions = [
  { routePath: "/product/140/", categoryId: "1323235936422219776", categoryName: "丽珠集团总部", total: 2 },
  { routePath: "/product/141/", categoryId: "1323235936447385600", categoryName: "丽珠营销总部", total: 0 },
  { routePath: "/product/142/", categoryId: "1323235936472551424", categoryName: "丽珠制药厂", total: 3 },
  { routePath: "/product/143/", categoryId: "1323235936501911552", categoryName: "丽珠微球", total: 0 },
  { routePath: "/product/144/", categoryId: "1323235936527077376", categoryName: "丽珠单抗", total: 10 },
  { routePath: "/product/145/", categoryId: "1323235936552243200", categoryName: "丽珠研究院", total: 4 },
  { routePath: "/product/146/", categoryId: "1323235936577409024", categoryName: "丽珠利民", total: 0 },
  { routePath: "/product/147/", categoryId: "1323235936598380544", categoryName: "丽珠合成", total: 0 },
  { routePath: "/product/149/", categoryId: "1323235936648712192", categoryName: "丽珠新北江", total: 0 },
  { routePath: "/product/150/", categoryId: "1323235936678072320", categoryName: "丽珠福州福兴", total: 0 },
  { routePath: "/product/151/", categoryId: "1323235936707432448", categoryName: "丽珠宁夏制药", total: 3 },
  { routePath: "/product/152/", categoryId: "1323235936732598272", categoryName: "上海丽珠", total: 0 },
  { routePath: "/product/153/", categoryId: "1323235936757764096", categoryName: "丽珠试剂", total: 0 },
  { routePath: "/product/154/", categoryId: "1323235936787124224", categoryName: "丽珠四川光大", total: 0 }
] as const;

type AuditedPartition = (typeof auditedPartitions)[number];

const plan = {
  adapterId: "official-json",
  company: { id: "company-livzon", officialChineseName: "丽珠医药集团股份有限公司" },
  source: {
    id: "source-livzon-social",
    companyId: "company-livzon",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: socialIndexUrl,
    officialChainEvidenceUrl: socialIndexUrl
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw"
    }
  },
  profileBoundSource: {
    kind: "livzon-cecc",
    config: {
      socialIndexUrl,
      routeDeclaredListApiUrl,
      listApiUrl,
      pageSize: 6,
      maxPagesPerPartition: 20,
      auditedPartitions: auditedPartitions.map(({ routePath, categoryId, categoryName }) => ({
        routePath,
        categoryId,
        categoryName
      }))
    }
  }
} as unknown as SourceCrawlPlan;

interface FixtureOptions {
  socialRoutes?: readonly { routePath: string; categoryName: string }[];
  totals?: Readonly<Record<string, number>>;
  routeCategoryOverrides?: Readonly<Record<string, string>>;
  responseTotal?: (partition: AuditedPartition, from: number, stableTotal: number) => number;
  responseJobs?: (
    partition: AuditedPartition,
    from: number,
    pageSize: number,
    jobs: ReturnType<typeof jobsForPartition>
  ) => ReturnType<typeof jobsForPartition>;
}

interface FixtureJob {
  productId: string;
  code: string;
  title: string;
  href: string;
  categoryName: string;
  content: string;
  attributeList: Array<{ attribute: string; value: string }>;
}

function htmlResponse(request: LivzonCeccHttpRequest, body: string): LivzonCeccHttpResponse {
  return {
    status: 200,
    body,
    finalUrl: request.url,
    contentType: "text/html; charset=utf-8",
    capturedAt
  };
}

function jsonResponse(request: LivzonCeccHttpRequest, body: unknown): LivzonCeccHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: request.url,
    contentType: "application/json",
    capturedAt
  };
}

function socialHtml(
  routes: readonly { routePath: string; categoryName: string }[] = auditedPartitions
): string {
  return `<html><body><main id="livzon-social-units"><div id="c_product_list_041-1735488276515"><div class="p_list">${routes.map(({ routePath, categoryName }) => `
    <article class="p_loopitem"><div class="e_text-5">
      <h2><a href="${routePath}">${categoryName}</a></h2></div>
      <a class="view-jobs" href="${routePath}">查看职位</a>
    </article>`).join("")}</div></div></main></body></html>`;
}

function routeHtml(partition: AuditedPartition, categoryId: string, total: number): string {
  const params = {
    size: 6,
    query: [{
      valueName: "",
      dataType: "string",
      operator: "eq",
      esField: "category.id",
      field: "categoryId",
      sourceType: "page",
      value: categoryId
    }],
    header: {
      "Data-Query-Es-Field": "list,page,productName.keyword,summary",
      "Data-Query-Random": 0,
      "Data-Query-Field": "list,page,title,summary"
    },
    from: 0,
    sort: [],
    _detailId: categoryId
  };
  const config = escapeHtmlAttribute(JSON.stringify({
    cname: "产品-产品列表",
    type: "list",
    params,
    appId: "143150160001",
    api: "/fwebapi/product/product/es/findPage?appId=143150160001&templateId=product"
  }));
  const pageParams = escapeHtmlAttribute(JSON.stringify({ size: 6, from: 0, totalCount: total }));
  return `<html><head><title>${partition.categoryName}</title></head><body>
    <section class="bound-recruitment-widget">
      <input type="hidden" name="_config" value="${config}">
      <input type="hidden" name="pageParamsJson" value="${pageParams}">
    </section>
    <section class="unrelated-widget">
      <input type="hidden" name="pageParamsJson" value="${escapeHtmlAttribute(JSON.stringify({ size: 6, from: 0, totalCount: total + 3 }))}">
    </section>
  </body></html>`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function jobsForPartition(partition: AuditedPartition, total: number = partition.total): FixtureJob[] {
  const base = Number(partition.routePath.match(/\d+/)?.[0] ?? 0) * 100;
  return Array.from({ length: total }, (_, index) => ({
    productId: String(base + index + 1),
    code: String(base + index + 1),
    title: `${partition.categoryName}职位${index + 1}`,
    href: `/product/${base + index + 1}.html`,
    categoryName: partition.categoryName,
    content: "岗位职责 负责药品研发。任职要求 本科及以上学历。",
    attributeList: [
      { attribute: "公司名称", value: partition.categoryName },
      { attribute: "工作地点", value: index % 2 === 0 ? "珠海" : "上海" }
    ]
  }));
}

function categoryIdFromBody(body: Record<string, unknown>): string | undefined {
  const query = Array.isArray(body.query) ? body.query : [];
  const category = query.find((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && (item as Record<string, unknown>).field === "categoryId"
  );
  return typeof category?.value === "string" ? category.value : undefined;
}

function createFixture(options: FixtureOptions = {}) {
  const requests: LivzonCeccHttpRequest[] = [];
  const http = async (request: LivzonCeccHttpRequest): Promise<LivzonCeccHttpResponse> => {
    requests.push(request);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/Social.html") {
      return htmlResponse(request, socialHtml(options.socialRoutes));
    }

    const routePartition = auditedPartitions.find(({ routePath }) => routePath === url.pathname);
    if (request.method === "GET" && routePartition) {
      const categoryId = options.routeCategoryOverrides?.[routePartition.routePath] ?? routePartition.categoryId;
      const total = options.totals?.[routePartition.categoryId] ?? routePartition.total;
      return htmlResponse(request, routeHtml(routePartition, categoryId, total));
    }

    if (request.method === "GET" && url.pathname === "/product/155/") {
      const unknown = {
        routePath: "/product/155/",
        categoryId: "1323235936812289999",
        categoryName: "未审计单位",
        total: 0
      } as unknown as AuditedPartition;
      return htmlResponse(request, routeHtml(unknown, unknown.categoryId, 0));
    }

    if (request.method === "POST" && request.url === listApiUrl) {
      const body = JSON.parse(request.body ?? "null") as Record<string, unknown>;
      const categoryId = categoryIdFromBody(body);
      const partition = auditedPartitions.find((candidate) => candidate.categoryId === categoryId);
      if (!partition) return jsonResponse(request, { data: { code: 400 } });
      const from = Number(body.from);
      const pageSize = Number(body.size);
      const stableTotal = options.totals?.[partition.categoryId] ?? partition.total;
      const allJobs = jobsForPartition(partition, stableTotal);
      const defaultPage = allJobs.slice(from, from + pageSize);
      const list = options.responseJobs?.(partition, from, pageSize, defaultPage) ?? defaultPage;
      const totalCount = options.responseTotal?.(partition, from, stableTotal) ?? stableTotal;
      return jsonResponse(request, {
        data: {
          code: 200,
          page: { size: pageSize, from, totalCount },
          category: null,
          list
        }
      });
    }

    throw new Error(`Unexpected Livzon CECC fixture request: ${request.method} ${request.url}`);
  };

  return { http, requests };
}

async function runFixture(options: FixtureOptions = {}) {
  const fixture = createFixture(options);
  const fetched = await createLivzonCeccSourceFetch({
    now: () => new Date(capturedAt),
    http: fixture.http
  })(plan);
  return { fetched, requests: fixture.requests };
}

function postBodies(requests: readonly LivzonCeccHttpRequest[]) {
  return requests
    .filter((request) => request.method === "POST")
    .map((request) => JSON.parse(request.body ?? "null") as Record<string, unknown>);
}

describe("createLivzonCeccSourceFetch", () => {
  it("is independently replayed and certified by runSourceCrawl through the staged company profile", async () => {
    const stagedPlan = getPlanBySourceId(
      buildStagedSourceCrawlPlans(candidateCompanies),
      "source-livzon-social"
    );
    if (stagedPlan?.adapterId !== "official-json" ||
      stagedPlan.profileBoundSource?.kind !== "livzon-cecc") {
      throw new Error("Missing staged Livzon CECC plan");
    }
    const fixture = createFixture();
    const fetched = await createLivzonCeccSourceFetch({
      now: () => new Date(capturedAt),
      http: fixture.http
    })(stagedPlan);
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => fetched });
    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: {
        completenessStatus: "VERIFIED",
        expectedJobCount: 22,
        structuredJobCount: 22
      }
    });
  });

  it("discovers the exact 14 audited official routes, dynamically paginates every partition, and returns the 22-job fixture", async () => {
    const { fetched, requests } = await runFixture();

    expect(fetched).toMatchObject({
      ok: true,
      capturedAt,
      payload: { jobs: expect.any(Array) },
      completeness: {
        completenessStatus: "NEEDS_MANUAL_COMPLETENESS_REVIEW",
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        completenessEvidenceUrl: socialIndexUrl,
        expectedJobCount: 22
      }
    });
    if (!fetched.ok) throw new Error(fetched.failureReason);
    if (!("payload" in fetched) || !isJobPayload(fetched.payload)) {
      throw new Error("Expected Livzon CECC JSON payload");
    }

    expect(fetched.payload.jobs).toHaveLength(22);
    expect(fetched.payload.jobs.every((job: { locationRaw: string; cities: string[] }) =>
      job.cities.length === 1 && job.cities[0] === job.locationRaw
    )).toBe(true);
    expect(new Set(fetched.payload.jobs.map((job: { sourceJobId: string }) => job.sourceJobId)).size).toBe(22);
    expect(fetched.payload.jobs.every((job: { sourceJobId: string }) =>
      /^livzon-cecc:sha256:[0-9a-f]{64}$/.test(job.sourceJobId)
    )).toBe(true);
    expect(fetched.payload.jobs.every((job: { officialUrl: string }) => {
      const url = new URL(job.officialUrl);
      return url.protocol === "https:" && url.origin === origin && /^\/product\/\d+\.html$/.test(url.pathname);
    })).toBe(true);

    const discoveredRouteGets = requests
      .filter((request) => request.method === "GET" && request.url !== socialIndexUrl)
      .map((request) => new URL(request.url).pathname)
      .sort();
    expect(discoveredRouteGets).toEqual(auditedPartitions.map(({ routePath }) => routePath).sort());

    const bodies = postBodies(requests);
    expect(bodies).toHaveLength(15);
    for (const body of bodies) {
      expect(body).not.toHaveProperty("params");
      expect(body).toMatchObject({ size: 6, from: expect.any(Number), sort: [], _detailId: expect.any(String) });
      expect(categoryIdFromBody(body)).toBe(body._detailId);
    }

    const singlePagedZeroCategoryIds: string[] = auditedPartitions
      .filter(({ total }) => total === 0)
      .map(({ categoryId }) => categoryId)
      .sort();
    expect(bodies
      .filter((body) => Number(body.from) === 0 && singlePagedZeroCategoryIds.includes(String(body._detailId)))
      .map((body) => String(body._detailId))
      .sort()).toEqual(singlePagedZeroCategoryIds);

    const tenJobCategory = auditedPartitions.find(({ total }) => total === 10);
    expect(bodies
      .filter((body) => body._detailId === tenJobCategory?.categoryId)
      .map((body) => body.from)).toEqual([0, 6]);

    expect((plan as unknown as {
      profileBoundSource: { config: Record<string, unknown> };
    }).profileBoundSource.config)
      .not.toHaveProperty("expectedJobCount");
  });

  it("derives a changed partition total and page count from the official response instead of a configured grand total", async () => {
    const changed = auditedPartitions[0];
    const { fetched, requests } = await runFixture({ totals: { [changed.categoryId]: 7 } });

    expect(fetched).toMatchObject({
      ok: true,
      payload: { jobs: expect.any(Array) },
      completeness: { expectedJobCount: 27 }
    });
    if (!fetched.ok) throw new Error(fetched.failureReason);
    if (!("payload" in fetched) || !isJobPayload(fetched.payload)) {
      throw new Error("Expected Livzon CECC JSON payload");
    }
    expect(fetched.payload.jobs).toHaveLength(27);
    expect(postBodies(requests)
      .filter((body) => body._detailId === changed.categoryId)
      .map((body) => body.from)).toEqual([0, 6]);
  });

  it("fails closed when a discovered route is bound to a different categoryId than the audited profile", async () => {
    const partition = auditedPartitions[0];
    const { fetched } = await runFixture({
      routeCategoryOverrides: { [partition.routePath]: auditedPartitions[1].categoryId }
    });
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("LIVZON_CECC_CATEGORY_BINDING_DRIFT")
    });
  });

  it("fails closed when a response record names a different official partition", async () => {
    const partition = auditedPartitions[0];
    const { fetched } = await runFixture({
      responseJobs: (candidate, from, _pageSize, jobs) =>
        candidate.categoryId === partition.categoryId && from === 0
          ? jobs.map((job, index) => index === 0
              ? { ...job, categoryName: "HR园地->社会招聘->丽珠营销总部" }
              : job)
          : jobs
    });
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("LIVZON_CECC_CATEGORY_BINDING_DRIFT")
    });
  });

  it("fails closed when totalCount changes between pages", async () => {
    const partition = auditedPartitions.find(({ total }) => total === 10)!;
    const { fetched } = await runFixture({
      responseTotal: (candidate, from, total) =>
        candidate.categoryId === partition.categoryId && from === 6 ? total - 1 : total
    });
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("LIVZON_CECC_TOTAL_COUNT_DRIFT")
    });
  });

  it("fails closed when a non-terminal page is short", async () => {
    const partition = auditedPartitions.find(({ total }) => total === 10)!;
    const { fetched } = await runFixture({
      responseJobs: (candidate, from, _pageSize, jobs) =>
        candidate.categoryId === partition.categoryId && from === 0 ? jobs.slice(0, 5) : jobs
    });
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("LIVZON_CECC_SHORT_PAGE")
    });
  });

  it("fails closed when a later page repeats a previously seen official job", async () => {
    const partition = auditedPartitions.find(({ total }) => total === 10)!;
    const first = jobsForPartition(partition)[0]!;
    const { fetched } = await runFixture({
      responseJobs: (candidate, from, _pageSize, jobs) =>
        candidate.categoryId === partition.categoryId && from === 6
          ? [first, ...jobs.slice(1)]
          : jobs
    });
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("LIVZON_CECC_REPEATED_JOB")
    });
  });

  it.each([
    ["adds an unknown route", [
      ...auditedPartitions,
      { routePath: "/product/155/", categoryName: "未审计单位" }
    ]],
    ["drops an audited route", auditedPartitions.slice(0, -1)]
  ])("fails closed when Social.html %s", async (_name, socialRoutes) => {
    const { fetched } = await runFixture({ socialRoutes });
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("LIVZON_CECC_PARTITION_SET_DRIFT")
    });
  });

  it.each([
    "http://www.livzon.com.cn/product/14001.html",
    "https://jobs.example.test/product/14001.html"
  ])("fails closed for a non-HTTPS or cross-origin detail URL: %s", async (href) => {
    const partition = auditedPartitions[0];
    const { fetched } = await runFixture({
      responseJobs: (candidate, from, _pageSize, jobs) =>
        candidate.categoryId === partition.categoryId && from === 0
          ? jobs.map((job, index) => index === 0 ? { ...job, href } : job)
          : jobs
    });
    expect(fetched).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("LIVZON_CECC_DETAIL_URL_OUT_OF_SCOPE")
    });
  });
});

function isJobPayload(value: unknown): value is {
  jobs: Array<{
    sourceJobId: string;
    officialUrl: string;
    locationRaw: string;
    cities: string[];
  }>;
} {
  return value !== null && typeof value === "object" && "jobs" in value &&
    Array.isArray((value as { jobs?: unknown }).jobs);
}
