import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { officialJsonAdapter } from "../../src/crawler/adapters/officialJson";
import {
  getStrictLivzonCeccNetworkPolicy,
  validateStrictLivzonCeccEvidence
} from "../../src/crawler/livzonCeccEvidenceVerifier";
import {
  createLivzonCeccSourceFetch,
  type LivzonCeccFetchConfig,
  type LivzonCeccHttpRequest,
  type LivzonCeccHttpResponse
} from "../../src/crawler/livzonCeccSourceFetch";
import type { NormalizedJobRecord } from "../../src/crawler/normalizedJob";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  type SourceCrawlPlan
} from "../../src/crawler/sourcePlan";
import type { PersistentSourceFetchEvidence } from "../../src/crawler/sourceFetchEvidence";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-07-16T00:00:00.000Z";

type OfficialJsonPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;
type LivzonPlan = OfficialJsonPlan & {
  profileBoundSource: { kind: "livzon-cecc"; config: LivzonCeccFetchConfig };
};

interface VerifiedFixture {
  plan: LivzonPlan;
  evidence: PersistentSourceFetchEvidence;
  jobs: NormalizedJobRecord[];
}

function livzonPlan(): LivzonPlan {
  const plan = getPlanBySourceId(
    buildStagedSourceCrawlPlans(candidateCompanies),
    "source-livzon-social"
  );
  if (plan?.adapterId !== "official-json" ||
    plan.profileBoundSource?.kind !== "livzon-cecc") {
    throw new Error("Missing staged Livzon CECC plan");
  }
  return plan as LivzonPlan;
}

function response(
  request: LivzonCeccHttpRequest,
  body: string,
  contentType: string
): LivzonCeccHttpResponse {
  return {
    status: 200,
    body,
    finalUrl: request.url,
    contentType,
    capturedAt
  };
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}

function socialHtml(config: LivzonCeccFetchConfig): string {
  return `<html><body><div id="c_product_list_041-1735488276515"><div class="p_list">${
    config.auditedPartitions.map((partition) =>
      `<article class="p_loopitem"><div class="e_text-5"><a href="${partition.routePath}">${partition.categoryName}</a></div></article>`
    ).join("")
  }</div></div></body></html>`;
}

function routeHtml(
  config: LivzonCeccFetchConfig,
  partition: LivzonCeccFetchConfig["auditedPartitions"][number],
  totalCount: number
): string {
  const params = {
    size: config.pageSize,
    query: [{
      valueName: "",
      dataType: "string",
      operator: "eq",
      esField: "category.id",
      field: "categoryId",
      sourceType: "page",
      value: partition.categoryId
    }],
    header: { "Data-Query-Field": "list,page,title,summary" },
    from: 0,
    sort: [],
    _detailId: partition.categoryId
  };
  const embeddedConfig = escapeAttribute(JSON.stringify({
    params,
    api: new URL(config.listApiUrl).pathname + new URL(config.listApiUrl).search
  }));
  const pageParams = escapeAttribute(JSON.stringify({
    size: config.pageSize,
    from: 0,
    totalCount
  }));
  const unrelatedPageParams = escapeAttribute(JSON.stringify({
    size: config.pageSize,
    from: 0,
    totalCount: totalCount + 99
  }));
  return `<html><body>
    <section><input name="_config" value="${embeddedConfig}"><input name="pageParamsJson" value="${pageParams}"></section>
    <section><input name="pageParamsJson" value="${unrelatedPageParams}"></section>
  </body></html>`;
}

function jobsForPartition(
  config: LivzonCeccFetchConfig,
  partitionIndex: number,
  totalCount: number,
  liveShapedWhitespace = false
) {
  const partition = config.auditedPartitions[partitionIndex]!;
  return Array.from({ length: totalCount }, (_unused, jobIndex) => {
    const officialId = String((partitionIndex + 1) * 100_000 + jobIndex + 1);
    const location = liveShapedWhitespace && partitionIndex === 0 && jobIndex === 0
      ? "  珠海  金湾区\t "
      : jobIndex % 2 === 0 ? "珠海" : "上海";
    return {
      productId: officialId,
      code: officialId,
      title: liveShapedWhitespace && partitionIndex === 0 && jobIndex === 0
        ? `  ${partition.categoryName}  高级\t研究员  `
        : `${partition.categoryName}职位${jobIndex + 1}`,
      href: `/product/${officialId}.html`,
      categoryName: `HR园地->社会招聘->${partition.categoryName}`,
      attributeList: [{ attribute: "工作地点", value: location }]
    };
  });
}

async function fixture(
  firstPartitionTotal = 2,
  liveShapedWhitespace = false
): Promise<VerifiedFixture> {
  const plan = livzonPlan();
  const config = plan.profileBoundSource.config;
  const http = async (request: LivzonCeccHttpRequest): Promise<LivzonCeccHttpResponse> => {
    const url = new URL(request.url);
    if (request.method === "GET" && request.url === config.socialIndexUrl) {
      return response(request, socialHtml(config), "text/html; charset=utf-8");
    }
    const partitionIndex = config.auditedPartitions.findIndex(
      (partition) => partition.routePath === url.pathname
    );
    if (request.method === "GET" && partitionIndex >= 0) {
      const total = partitionIndex === 0 ? firstPartitionTotal : 0;
      return response(
        request,
        routeHtml(config, config.auditedPartitions[partitionIndex]!, total),
        "text/html; charset=utf-8"
      );
    }
    if (request.method === "POST" && request.url === config.listApiUrl) {
      const body = JSON.parse(request.body ?? "null") as Record<string, unknown>;
      const categoryQuery = Array.isArray(body.query)
        ? body.query.find((candidate) =>
            candidate && typeof candidate === "object" &&
            (candidate as Record<string, unknown>).field === "categoryId"
          ) as Record<string, unknown> | undefined
        : undefined;
      const apiPartitionIndex = config.auditedPartitions.findIndex(
        (partition) => partition.categoryId === categoryQuery?.value
      );
      if (apiPartitionIndex < 0) throw new Error("Unknown Livzon fixture partition");
      const total = apiPartitionIndex === 0 ? firstPartitionTotal : 0;
      const from = Number(body.from);
      const size = Number(body.size);
      const list = jobsForPartition(
        config,
        apiPartitionIndex,
        total,
        liveShapedWhitespace
      ).slice(from, from + size);
      return response(request, JSON.stringify({
        data: { code: 200, page: { size, from, totalCount: total }, list }
      }), "application/json");
    }
    throw new Error(`Unexpected fixture request: ${request.method} ${request.url}`);
  };

  const fetched = await createLivzonCeccSourceFetch({
    now: () => new Date(capturedAt),
    http
  })(plan);
  if (!fetched.ok || !("payload" in fetched) || !fetched.fetchEvidence) {
    throw new Error(fetched.ok ? "Missing Livzon payload/evidence" : fetched.failureReason);
  }
  const adapted = officialJsonAdapter.extract({
    company: plan.company,
    source: plan.source,
    capturedAt: fetched.capturedAt,
    payload: fetched.payload,
    json: plan.json,
    ...(fetched.completeness ? { completeness: fetched.completeness } : {}),
    isBaseline: false
  });
  if (adapted.status !== "SUCCESS") throw new Error(adapted.failureReason);
  return { plan, evidence: fetched.fetchEvidence, jobs: adapted.jobs };
}

describe("validateStrictLivzonCeccEvidence", () => {
  it("independently replays the exact 14-partition archive and accepts a dynamic total", async () => {
    const first = await fixture(2);
    const changed = await fixture(7);

    expect(validateStrictLivzonCeccEvidence(first.plan, first.evidence, first.jobs)).toBe(true);
    expect(first.jobs).toHaveLength(2);
    expect(validateStrictLivzonCeccEvidence(changed.plan, changed.evidence, changed.jobs)).toBe(true);
    expect(changed.jobs).toHaveLength(7);
    expect(getStrictLivzonCeccNetworkPolicy(first.plan)).toEqual({
      socialIndexUrl: first.plan.profileBoundSource.config.socialIndexUrl,
      listApiUrl: first.plan.profileBoundSource.config.listApiUrl,
      partitionRouteUrls: first.plan.profileBoundSource.config.auditedPartitions.map(
        (partition) => new URL(partition.routePath, first.plan.profileBoundSource.config.socialIndexUrl).toString()
      )
    });
  });

  it("accepts live-shaped repeated title and location whitespace after independent adapter-equivalent normalization", async () => {
    const shaped = await fixture(2, true);

    expect(shaped.jobs[0]).toMatchObject({
      officialTitle: "丽珠集团总部 高级 研究员",
      locationRaw: "珠海 金湾区",
      cities: ["珠海 金湾区"]
    });
    expect(validateStrictLivzonCeccEvidence(
      shaped.plan,
      shaped.evidence,
      shaped.jobs
    )).toBe(true);
  });

  it("rejects an archived API body changed after capture even when its fingerprint is also changed", async () => {
    const { plan, evidence, jobs } = await fixture();
    const tampered = structuredClone(evidence);
    const artifact = tampered.artifacts.find((candidate) =>
      candidate.logicalKey.startsWith("livzon-api-") &&
      String(candidate.body).includes("职位1")
    );
    if (!artifact || typeof artifact.body !== "string") throw new Error("Missing fixture API artifact");
    const parsed = JSON.parse(artifact.body) as {
      data: { list: Array<{ title: string }> };
    };
    parsed.data.list[0]!.title = "归档后被替换的职位标题";
    artifact.body = JSON.stringify(parsed);
    const page = tampered.pages.find((candidate) =>
      candidate.artifactLogicalKey === artifact.logicalKey
    );
    if (!page) throw new Error("Missing fixture page trace");
    page.responseFingerprintSha256 = createHash("sha256")
      .update(Buffer.from(artifact.body, "utf8"))
      .digest("hex");

    expect(validateStrictLivzonCeccEvidence(plan, tampered, jobs)).toBe(false);
  });

  it("rejects request-contract tampering even when archive URLs and bodies remain unchanged", async () => {
    const { plan, evidence, jobs } = await fixture();
    const tampered = structuredClone(evidence);
    const social = tampered.artifacts.find(
      (artifact) => artifact.logicalKey === "livzon-social-index"
    );
    if (!social) throw new Error("Missing social archive");
    social.extractorLocator = social.extractorLocator.replace(/[0-9a-f]$/u, (value) =>
      value === "0" ? "1" : "0"
    );

    expect(validateStrictLivzonCeccEvidence(plan, tampered, jobs)).toBe(false);
  });

  it("rejects profile configuration drift instead of accepting evidence tailored to a changed plan", async () => {
    const { plan, evidence, jobs } = await fixture();
    const tamperedPlan = structuredClone(plan) as LivzonPlan;
    tamperedPlan.profileBoundSource.config.pageSize = 7;

    expect(getStrictLivzonCeccNetworkPolicy(tamperedPlan)).toBeUndefined();
    expect(validateStrictLivzonCeccEvidence(tamperedPlan, evidence, jobs)).toBe(false);
  });
});
