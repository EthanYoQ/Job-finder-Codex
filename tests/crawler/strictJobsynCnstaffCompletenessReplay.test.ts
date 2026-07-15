import { describe, expect, it } from "vitest";
import {
  createOfficialJsonSourceFetch,
  type OfficialJsonHttpResponse
} from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl, type SourceFetchResult } from "../../src/crawler/runSourceCrawl";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const CAPTURED_AT = "2026-07-15T00:01:00.000Z";

type OfficialJsonPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;
type SuccessfulFetch = Extract<SourceFetchResult, { ok: true }>;

function stagedPlan(sourceId: string): OfficialJsonPlan {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies)
    .find((candidate) => candidate.source.id === sourceId);
  if (plan?.adapterId !== "official-json" || !plan.officialJsonFetch) {
    throw new Error(`Expected staged official JSON plan ${sourceId}`);
  }
  return plan;
}

function response(requestedUrl: string, body: unknown): OfficialJsonHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: requestedUrl,
    contentType: "application/json; charset=utf-8",
    capturedAt: CAPTURED_AT
  };
}

async function jobsynFixture(): Promise<{ plan: OfficialJsonPlan; fetched: SuccessfulFetch }> {
  const plan = stagedPlan("source-grifols-china-social");
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async (request) => response(request.url, {
      jobs: [{
        guid: "grifols-china-1",
        title_exact: "Field Service Engineer",
        title_slug: "field-service-engineer",
        location_exact: "Shanghai, China",
        city_exact: "Shanghai",
        country_exact: "China"
      }],
      pagination: { page: 1, page_size: 9, total: 1, total_pages: 1, has_more_pages: false }
    })
  });
  const fetched = await fetcher(plan);
  if (!fetched.ok) throw new Error(`Expected Jobsyn fixture fetch: ${fetched.failureReason}`);
  return { plan, fetched };
}

async function cnstaffFixture(): Promise<{ plan: OfficialJsonPlan; fetched: SuccessfulFetch }> {
  const plan = stagedPlan("source-daiichi-sankyo-china-social");
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async (request) => response(request.url, {
      total: 1,
      page: { total: 1, now: 1 },
      list: [{
        job_id: "daiichi-detail-1",
        job_publish_id: "daiichi-publish-1",
        job_name_show: "医学信息沟通岗位",
        job_address_name: "上海市"
      }]
    })
  });
  const fetched = await fetcher(plan);
  if (!fetched.ok) throw new Error(`Expected CNStaff fixture fetch: ${fetched.failureReason}`);
  return { plan, fetched };
}

function mutateEvidence(
  fetched: SuccessfulFetch,
  mutate: (evidence: NonNullable<SuccessfulFetch["fetchEvidence"]>) =>
    NonNullable<SuccessfulFetch["fetchEvidence"]>
): SuccessfulFetch {
  if (!fetched.fetchEvidence) throw new Error("Expected exact fetch evidence");
  return { ...fetched, fetchEvidence: mutate(fetched.fetchEvidence) };
}

function mutateFirstBody(
  fetched: SuccessfulFetch,
  mutate: (body: Record<string, unknown>) => void
): SuccessfulFetch {
  return mutateEvidence(fetched, (evidence) => ({
    ...evidence,
    artifacts: evidence.artifacts.map((artifact, index) => {
      if (index !== 0) return artifact;
      const body = JSON.parse(artifact.body as string) as Record<string, unknown>;
      mutate(body);
      return { ...artifact, body: JSON.stringify(body) };
    })
  }));
}

describe("Jobsyn and CNStaff strict source-bound completeness replay", () => {
  it.each([
    ["Jobsyn", jobsynFixture, "company-grifols-china"],
    ["CNStaff", cnstaffFixture, "company-daiichi-sankyo-china"]
  ] as const)("verifies the exact staged %s fetch only after independent replay", async (_label, fixture, companyId) => {
    const { plan, fetched } = await fixture();
    expect(fetched).toMatchObject({
      fetchEvidence: {
        fetchCounts: { rawCount: 1, parsedCount: 1, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 0 },
        fetchLosses: [],
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 1, scope: "SOURCE" }
      },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: false, derivedAnomalyCodes: [] }
    });

    expect(await runSourceCrawl(plan, { fetch: async () => fetched })).toMatchObject({
      status: "SUCCESS",
      jobs: [expect.objectContaining({ companyId })],
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1, structuredJobCount: 1 },
      reconciliation: { rawInputCount: 1, dedupeOutputCount: 1, adapterLosses: [] }
    });
  });

  it.each([
    ["Jobsyn", jobsynFixture],
    ["CNStaff", cnstaffFixture]
  ] as const)("rejects %s endpoint, locator, page-coordinate, and official-total drift", async (_label, fixture) => {
    const { plan, fetched } = await fixture();
    const endpointDrift = mutateEvidence(fetched, (evidence) => ({
      ...evidence,
      artifacts: evidence.artifacts.map((artifact, index) => index === 0
        ? { ...artifact, requestedUrl: `${artifact.requestedUrl}&drift=1`, finalUrl: `${artifact.finalUrl}&drift=1` }
        : artifact)
    }));
    const locatorDrift = mutateEvidence(fetched, (evidence) => ({
      ...evidence,
      artifacts: evidence.artifacts.map((artifact, index) => index === 0
        ? { ...artifact, extractorLocator: `${artifact.extractorLocator}|drift` }
        : artifact)
    }));
    const pageDrift = mutateEvidence(fetched, (evidence) => ({
      ...evidence,
      pages: evidence.pages.map((page, index) => index === 0 ? { ...page, returnedPage: 2 } : page)
    }));
    const totalDrift = mutateFirstBody(fetched, (body) => {
      if (Array.isArray(body.jobs)) {
        (body.pagination as Record<string, unknown>).total = 2;
      } else {
        body.total = 2;
      }
    });

    for (const attack of [endpointDrift, locatorDrift, pageDrift, totalDrift]) {
      expect((await runSourceCrawl(plan, { fetch: async () => attack })).truth.completenessVerified)
        .toBe(false);
    }
  });

  it("rejects Jobsyn source config transplant and a foreign archived payload", async () => {
    const { plan, fetched } = await jobsynFixture();
    const strategy = plan.officialJsonFetch;
    if (strategy?.kind !== "jobsyn-solr") throw new Error("Expected Jobsyn plan");
    const configDrift: OfficialJsonPlan = {
      ...plan,
      officialJsonFetch: { ...strategy, siteOrigin: "evil.example", location: "usa" }
    };
    const foreign = mutateFirstBody(fetched, (body) => {
      const jobs = body.jobs as Array<Record<string, unknown>>;
      jobs[0]!.location_exact = "Boston, United States";
      jobs[0]!.city_exact = "Boston";
      jobs[0]!.country_exact = "United States";
    });

    expect((await runSourceCrawl(configDrift, { fetch: async () => fetched })).truth.completenessVerified)
      .toBe(false);
    expect((await runSourceCrawl(plan, { fetch: async () => foreign })).truth.completenessVerified)
      .toBe(false);
  });

  it("rejects CNStaff config drift and a foreign archived payload", async () => {
    const { plan, fetched } = await cnstaffFixture();
    const strategy = plan.officialJsonFetch;
    if (strategy?.kind !== "cnstaff") throw new Error("Expected CNStaff plan");
    const configDrift: OfficialJsonPlan = {
      ...plan,
      officialJsonFetch: { ...strategy, pageSize: 16, maxPages: 11 }
    };
    const foreign = mutateFirstBody(fetched, (body) => {
      const list = body.list as Array<Record<string, unknown>>;
      list[0]!.job_address_name = "Boston, United States";
      list[0]!.Country = "United States";
    });

    expect((await runSourceCrawl(configDrift, { fetch: async () => fetched })).truth.completenessVerified)
      .toBe(false);
    expect((await runSourceCrawl(plan, { fetch: async () => foreign })).truth.completenessVerified)
      .toBe(false);
  });
});
