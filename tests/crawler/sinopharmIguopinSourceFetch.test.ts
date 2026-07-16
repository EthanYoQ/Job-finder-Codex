import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createSinopharmIguopinSourceFetch,
  replaySinopharmIguopinEvidence,
  validateStrictSinopharmIguopinEvidence,
  type SinopharmIguopinFetchConfig,
  type SinopharmIguopinHttpRequest,
  type SinopharmIguopinHttpResponse
} from "../../src/crawler/sinopharmIguopinSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import { profile_sinopharm } from "../../src/crawler/companyRecruitmentProfiles/profiles/sinopharm";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-07-16T00:00:00.000Z";
const companyId = "10685286902763068";
const defaultProjectId = "198318348402950324";
const talentHubUrl = "https://www.sinopharm.com/talents.html";
const recruitmentUrl = "https://www.sinopharm.com/recruitment.html";
const wechatUrl = "https://mp.weixin.qq.com/s/HHzjsHj-iLo9jlsf6LH0Vg";
const exclusiveEntryUrl = "https://sinopharm-global.iguopin.com/job";
const infoUrl = "https://gp-api.iguopin.com/api/activity/exclusive/v1/info?domain=sinopharm-global";
const jobsUrl = "https://gp-api.iguopin.com/api/jobs/v1/project-job";

const config: SinopharmIguopinFetchConfig = {
  officialTalentHubUrl: talentHubUrl,
  officialRecruitmentUrl: recruitmentUrl,
  officialWechatArticleUrl: wechatUrl,
  exclusiveEntryUrl,
  exclusiveInfoUrl: infoUrl,
  projectJobsUrl: jobsUrl,
  expectedDomain: "sinopharm-global",
  expectedCompanyId: companyId,
  expectedCompanyName: "中国医药集团有限公司",
  pageSize: 2,
  maxPages: 20
};

const plan = {
  adapterId: "official-json",
  company: {
    id: "company-sinopharm",
    officialChineseName: "中国医药集团有限公司",
    category: "DOMESTIC_PHARMA"
  },
  source: {
    id: "source-sinopharm-social",
    companyId: "company-sinopharm",
    kind: "SOCIAL",
    atsKind: "OFFICIAL_JSON",
    status: "VERIFIED_SCRAPABLE",
    officialEntryUrl: exclusiveEntryUrl,
    officialChainEvidenceUrl: recruitmentUrl
  },
  json: {
    jobsPath: "jobs",
    fields: {
      sourceJobId: "sourceJobId",
      officialTitle: "title",
      officialUrl: "officialUrl",
      locationRaw: "locationRaw",
      cities: "cities"
    },
    defaultCategory: "其他"
  },
  profileBoundSource: { kind: "sinopharm-iguopin", config }
} as unknown as SourceCrawlPlan;

interface RawJob {
  job_id: string;
  job_name: string;
  company_id: string;
  company_name: string;
  company_info: { show_name: string };
  district_list: Array<{ area_cn: string }>;
  contents: string;
  category_cn: string;
  department_cn: string;
  education_cn: string;
  experience_cn: string;
  start_time: string;
  end_time: string;
  status: number;
  is_apply: boolean;
  hide: number;
  recruitment_type_cn: string;
  nature_cn: string;
}

function rawJob(id: number, overrides: Partial<RawJob> = {}): RawJob {
  return {
    job_id: String(205019432680948500n + BigInt(id)),
    job_name: `国药职位${id}`,
    company_id: `1068530992663347${id}`,
    company_name: `国药成员企业${id}`,
    company_info: { show_name: `国药成员企业${id}` },
    district_list: [{ area_cn: id % 2 === 0 ? "上海-浦东新区" : "长春-朝阳区" }],
    contents: "岗位职责：负责医药研发。任职要求：博士学历。",
    category_cn: "药物研发",
    department_cn: `研发部门${id}`,
    education_cn: "博士",
    experience_cn: "3-5年",
    start_time: "2026-06-01 00:00:00",
    end_time: "2026-12-31 23:59:59",
    status: 1,
    is_apply: true,
    hide: 0,
    recruitment_type_cn: "社会招聘",
    nature_cn: "社招",
    ...overrides
  };
}

const baselineJobs: RawJob[] = [
  rawJob(1),
  rawJob(3, { recruitment_type_cn: "校园招聘", nature_cn: "校招" }),
  rawJob(4, { hide: 1 }),
  rawJob(2),
  rawJob(5, { end_time: "2026-07-15 23:59:59" })
];

interface FixtureOptions {
  projectId?: string;
  jobs?: RawJob[];
  talentHubHtml?: string;
  recruitmentHtml?: string;
  mutateInfo?: (response: Record<string, unknown>) => void;
  mutatePage?: (response: Record<string, unknown>, page: number) => void;
}

function talentHubHtml(): string {
  return `<html><head><meta http-equiv="refresh" content="0;url=${recruitmentUrl}"></head></html>`;
}

function recruitmentHtml(): string {
  return `<html><body><a href="${wechatUrl}">国药集团招聘公告</a></body></html>`;
}

function exclusiveHtml(): string {
  return "<!doctype html><html><head><title>招聘官网</title></head><body><div id=\"root\"></div></body></html>";
}

function infoBody(projectId: string): Record<string, unknown> {
  const jobNav = {
    title: "引才岗位",
    key: "job",
    route: "/job",
    component: "containers/job/job",
    props: { projectId, showAllCompany: "0" },
    type: "job",
    hidden: 0
  };
  return {
    code: 200,
    msg: "OK",
    data: {
      id: "6849314ad8d3ae1686dc79b3",
      company_id: companyId,
      project_id: "",
      title: "国药集团全球引才计划",
      status: 1,
      key: "sinopharm-global",
      is_display: 1,
      company: { id: companyId, name: "中国医药集团有限公司", show_name: "中国医药集团有限公司" },
      content: JSON.stringify({
        key: "sinopharm-global",
        title: "国药集团全球引才计划",
        company_id: companyId,
        params: { nav: [{ title: "首页", key: "index", route: "/", hidden: 0 }, jobNav] },
        paramsMobile: { nav: [{ title: "首页", key: "index", route: "/", hidden: 0 }, jobNav] }
      })
    }
  };
}

function htmlResponse(request: SinopharmIguopinHttpRequest, body: string): SinopharmIguopinHttpResponse {
  return {
    status: 200,
    body,
    finalUrl: request.url,
    contentType: "text/html; charset=utf-8",
    capturedAt
  };
}

function jsonResponse(request: SinopharmIguopinHttpRequest, body: unknown): SinopharmIguopinHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: request.url,
    contentType: "application/json; charset=utf-8",
    capturedAt
  };
}

function fixture(options: FixtureOptions = {}) {
  const requests: SinopharmIguopinHttpRequest[] = [];
  const projectId = options.projectId ?? defaultProjectId;
  const jobs = options.jobs ?? baselineJobs;
  const http = async (request: SinopharmIguopinHttpRequest): Promise<SinopharmIguopinHttpResponse> => {
    requests.push(request);
    if (request.method === "GET" && request.url === talentHubUrl) {
      return htmlResponse(request, options.talentHubHtml ?? talentHubHtml());
    }
    if (request.method === "GET" && request.url === recruitmentUrl) {
      return htmlResponse(request, options.recruitmentHtml ?? recruitmentHtml());
    }
    if (request.method === "GET" && request.url === exclusiveEntryUrl) {
      return htmlResponse(request, exclusiveHtml());
    }
    if (request.method === "GET" && request.url === infoUrl) {
      const body = infoBody(projectId);
      options.mutateInfo?.(body);
      return jsonResponse(request, body);
    }
    if (request.method === "POST" && request.url === jobsUrl) {
      const body = JSON.parse(request.body ?? "null") as {
        page: number; page_size: number; source: string; project_id: string[];
      };
      const start = (body.page - 1) * body.page_size;
      const response: Record<string, unknown> = {
        code: 200,
        msg: "OK",
        data: {
          page: body.page,
          page_size: body.page_size,
          total: jobs.length,
          list: jobs.slice(start, start + body.page_size)
        }
      };
      options.mutatePage?.(response, body.page);
      return jsonResponse(request, response);
    }
    throw new Error(`Unexpected fixture request: ${request.method} ${request.url}`);
  };
  return { http, requests };
}

async function run(
  options: FixtureOptions = {},
  runConfig: SinopharmIguopinFetchConfig = config
) {
  const subject = fixture(options);
  const runPlan = {
    ...(plan as unknown as Record<string, unknown>),
    profileBoundSource: { kind: "sinopharm-iguopin", config: runConfig }
  } as unknown as SourceCrawlPlan;
  const result = await createSinopharmIguopinSourceFetch({
    now: () => new Date(capturedAt),
    http: subject.http
  })(runPlan);
  return { result, requests: subject.requests };
}

function stagedSinopharmPlan(): Extract<SourceCrawlPlan, { adapterId: "official-json" }> {
  const staged = getPlanBySourceId(
    buildStagedSourceCrawlPlans(candidateCompanies),
    "source-sinopharm-social"
  );
  if (staged?.adapterId !== "official-json" ||
    staged.profileBoundSource?.kind !== "sinopharm-iguopin") {
    throw new Error("Expected staged Sinopharm profile-bound plan");
  }
  return staged;
}

async function runStagedSinopharm(options: FixtureOptions = {}) {
  const stagedPlan = stagedSinopharmPlan();
  const subject = fixture(options);
  const result = await createSinopharmIguopinSourceFetch({
    now: () => new Date(capturedAt),
    http: subject.http
  })(stagedPlan);
  return { stagedPlan, result };
}

function postBodies(requests: readonly SinopharmIguopinHttpRequest[]) {
  return requests.filter(({ method }) => method === "POST")
    .map(({ body }) => JSON.parse(body ?? "null") as Record<string, unknown>);
}

describe("createSinopharmIguopinSourceFetch", () => {
  it("passes the shared runSourceCrawl strict gate with the canonical staged profile", async () => {
    const { stagedPlan, result } = await runStagedSinopharm();
    const crawled = await runSourceCrawl(stagedPlan, { fetch: async () => result });

    expect(crawled).toMatchObject({
      status: "SUCCESS",
      truth: {
        transportSuccess: true,
        adapterSuccess: true,
        completenessVerified: true
      },
      observation: {
        structuredJobCount: 2,
        completenessStatus: "VERIFIED"
      }
    });
    expect(crawled.jobs).toHaveLength(2);
  });

  it("makes runSourceCrawl reject a self-hashed tampered archived project page", async () => {
    const { stagedPlan, result } = await runStagedSinopharm();
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected complete staged Sinopharm evidence");
    const fetchEvidence = structuredClone(result.fetchEvidence);
    const artifact = fetchEvidence.artifacts.find(({ logicalKey }) =>
      logicalKey === "sinopharm-iguopin-page-0000"
    );
    const trace = fetchEvidence.pages.find(({ artifactLogicalKey }) =>
      artifactLogicalKey === "sinopharm-iguopin-page-0000"
    );
    if (!artifact || typeof artifact.body !== "string" || !trace) {
      throw new Error("Missing archived staged Sinopharm page");
    }
    artifact.body = artifact.body.replace("国药职位1", "归档篡改职位");
    trace.responseFingerprintSha256 = createHash("sha256").update(artifact.body, "utf8").digest("hex");

    const crawled = await runSourceCrawl(stagedPlan, {
      fetch: async () => ({ ...result, fetchEvidence })
    });
    expect(crawled.truth.completenessVerified).toBe(false);
    expect(crawled.observation.completenessStatus).not.toBe("VERIFIED");
  });

  it("dynamically binds the endorsed tenant and project, reconciles every page, and filters social lifecycle rows", async () => {
    const { result, requests } = await run();
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: expect.any(Array) },
      completeness: {
        completenessEvidenceKind: "OFFICIAL_TOTAL_COUNT",
        expectedJobCount: 5,
        pagesVisited: 3
      },
      fetchEvidence: {
        fetchCounts: {
          rawCount: 5,
          parsedCount: 5,
          validCount: 2,
          validationDiscardCount: 3
        },
        pages: expect.any(Array),
        artifacts: expect.any(Array)
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true }
    });
    if (!result.ok || !("payload" in result) || !isJobsPayload(result.payload)) {
      throw new Error(result.ok ? "missing payload" : result.failureReason);
    }
    expect(result.payload.jobs).toHaveLength(2);
    expect(result.payload.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "国药职位1",
        locationRaw: "长春-朝阳区",
        cities: ["长春-朝阳区"],
        officialUrl: "https://www.iguopin.com/job/detail?id=205019432680948501"
      }),
      expect.objectContaining({ title: "国药职位2", locationRaw: "上海-浦东新区" })
    ]));
    expect(result.payload.jobs.every((job) =>
      /^sinopharm-iguopin:sha256:[0-9a-f]{64}$/.test(job.sourceJobId)
    )).toBe(true);

    expect(postBodies(requests)).toEqual([
      { page: 1, page_size: 2, source: "s_job_list", project_id: [defaultProjectId] },
      { page: 2, page_size: 2, source: "s_job_list", project_id: [defaultProjectId] },
      { page: 3, page_size: 2, source: "s_job_list", project_id: [defaultProjectId] }
    ]);
    expect(result.fetchEvidence?.artifacts).toHaveLength(7);
    expect(result.fetchEvidence?.pages).toHaveLength(3);
    expect(result.fetchEvidence?.artifacts.every((artifact) => artifact.bodyRepresentation === "EXACT")).toBe(true);
    expect(replaySinopharmIguopinEvidence({
      plan,
      evidence: result.fetchEvidence,
      outputJobs: result.payload.jobs
    })).toMatchObject({ officialTotal: 5, socialCurrentCount: 2, excludedCount: 3 });
    expect(validateStrictSinopharmIguopinEvidence({
      plan,
      evidence: result.fetchEvidence,
      outputJobs: result.payload.jobs
    })).toBe(true);
  });

  it("uses a newly published project id from both desktop and mobile config without a configured job total", async () => {
    const projectId = "298318348402950999";
    const { result, requests } = await run({ projectId, jobs: [rawJob(9)] });
    expect(result).toMatchObject({ ok: true, completeness: { expectedJobCount: 1 } });
    expect(postBodies(requests)).toEqual([
      { page: 1, page_size: 2, source: "s_job_list", project_id: [projectId] }
    ]);
    expect(config).not.toHaveProperty("expectedJobCount");
    expect(profile_sinopharm.sources[0]?.executionConfig.profileBoundSource.config)
      .not.toHaveProperty("expectedJobCount");
  });

  it.each([
    {
      label: "the official talent hub stops pointing to the recruitment page",
      options: { talentHubHtml: "<html><head><meta http-equiv=\"refresh\" content=\"0;url=https://example.com/jobs\"></head></html>" },
      code: "SINOPHARM_IGUOPIN_OFFICIAL_CHAIN_DRIFT"
    },
    {
      label: "the official recruitment page stops endorsing the audited WeChat notice",
      options: { recruitmentHtml: "<html><body>招聘信息</body></html>" },
      code: "SINOPHARM_IGUOPIN_OFFICIAL_CHAIN_DRIFT"
    },
    {
      label: "the exclusive tenant changes its group company identity",
      options: { mutateInfo: (response: Record<string, unknown>) => {
        const data = response.data as Record<string, unknown>;
        data.company_id = "99999999999999999";
      } },
      code: "SINOPHARM_IGUOPIN_TENANT_BINDING_DRIFT"
    },
    {
      label: "desktop and mobile navigation disagree about project id",
      options: { mutateInfo: (response: Record<string, unknown>) => {
        const data = response.data as Record<string, unknown>;
        const content = JSON.parse(String(data.content)) as {
          paramsMobile: { nav: Array<{ key: string; props?: { projectId?: string } }> };
        };
        content.paramsMobile.nav.find(({ key }) => key === "job")!.props!.projectId = "999999999999999999";
        data.content = JSON.stringify(content);
      } },
      code: "SINOPHARM_IGUOPIN_PROJECT_BINDING_DRIFT"
    }
  ])("fails closed when $label", async ({ options, code }) => {
    const { result } = await run(options as FixtureOptions);
    expect(result).toMatchObject({ ok: false, failureReason: expect.stringContaining(code) });
  });

  it("fails closed when total changes on a later page", async () => {
    const { result } = await run({
      mutatePage: (response, page) => {
        if (page === 2) (response.data as Record<string, unknown>).total = 4;
      }
    });
    expect(result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("SINOPHARM_IGUOPIN_TOTAL_COUNT_DRIFT")
    });
  });

  it("fails closed on a short page or a repeated official job id", async () => {
    const short = await run({
      mutatePage: (response, page) => {
        if (page === 1) (response.data as { list: unknown[] }).list.pop();
      }
    });
    expect(short.result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("SINOPHARM_IGUOPIN_SHORT_PAGE")
    });

    const duplicateJobs = [rawJob(1), rawJob(2), rawJob(3)];
    duplicateJobs[2]!.job_id = duplicateJobs[0]!.job_id;
    const duplicate = await run({ jobs: duplicateJobs });
    expect(duplicate.result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("SINOPHARM_IGUOPIN_DUPLICATE_JOB")
    });
  });

  it("fails closed on ambiguous social labels or any missing required detail field", async () => {
    const boundary = await run({
      jobs: [rawJob(1, { recruitment_type_cn: "社会招聘", nature_cn: "校招" })]
    });
    expect(boundary.result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("SINOPHARM_IGUOPIN_SOCIAL_BOUNDARY_DRIFT")
    });

    const missing = rawJob(1);
    missing.contents = "";
    const detail = await run({ jobs: [missing] });
    expect(detail.result).toMatchObject({
      ok: false,
      failureReason: expect.stringContaining("SINOPHARM_IGUOPIN_INVALID_JOB")
    });
  });

  it("rejects captured evidence when an exact API artifact is altered after capture", async () => {
    const { result } = await run();
    if (!result.ok || !("payload" in result) || !isJobsPayload(result.payload) || !result.fetchEvidence) {
      throw new Error("Expected complete Sinopharm fixture evidence");
    }
    const tampered = structuredClone(result.fetchEvidence);
    const page = tampered.artifacts.find(({ logicalKey }) =>
      logicalKey === "sinopharm-iguopin-page-0000"
    );
    if (!page || typeof page.body !== "string") throw new Error("Missing exact page artifact");
    page.body = page.body.replace("国药职位1", "篡改职位");
    expect(validateStrictSinopharmIguopinEvidence({
      plan,
      evidence: tampered,
      outputJobs: result.payload.jobs
    })).toBe(false);
  });

  it("excludes hidden, unavailable, future, and expired social jobs without losing page reconciliation", async () => {
    const jobs = [
      rawJob(1),
      rawJob(2, { status: 0 }),
      rawJob(3, { is_apply: false }),
      rawJob(4, { hide: 1 }),
      rawJob(5, { start_time: "2026-07-17 00:00:00" }),
      rawJob(6, { end_time: "2026-07-15 23:59:59" })
    ];
    const { result } = await run({ jobs }, { ...config, pageSize: 100 });
    expect(result).toMatchObject({
      ok: true,
      payload: { jobs: [expect.objectContaining({ title: "国药职位1" })] },
      fetchEvidence: {
        fetchCounts: { rawCount: 6, parsedCount: 6, validCount: 1, validationDiscardCount: 5 },
        fetchLosses: expect.arrayContaining([
          expect.objectContaining({ reason: "LIFECYCLE_EXCLUDED" })
        ])
      },
      paginationEvaluation: { safeCompleteness: true }
    });
  });
});

function isJobsPayload(value: unknown): value is {
  jobs: Array<{ sourceJobId: string; title: string; officialUrl: string; locationRaw: string; cities: string[] }>;
} {
  return Boolean(value) && typeof value === "object" &&
    Array.isArray((value as { jobs?: unknown }).jobs);
}
