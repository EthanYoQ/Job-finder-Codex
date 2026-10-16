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

async function cnstaffFixture(location = "上海市"): Promise<{ plan: OfficialJsonPlan; fetched: SuccessfulFetch }> {
  const plan = stagedPlan("source-daiichi-sankyo-china-social");
  const fetcher = createOfficialJsonSourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async (request) => response(request.url, {
      total: 1,
      page: { code: "<div class=\"pageBar2\"></div>", limit: "0,15", now: 1, pageSize: 15, total: 1 },
      list: [{
        job_id: "daiichi-detail-1",
        job_publish_id: "daiichi-publish-1",
        job_name_show: "医学信息沟通岗位",
        job_address_name: location
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

describe("CNStaff strict source-bound completeness replay", () => {
  it("verifies the exact staged CNStaff fetch only after independent replay", async () => {
    const { plan, fetched } = await cnstaffFixture();
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
      jobs: [expect.objectContaining({ companyId: "company-daiichi-sankyo-china" })],
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1, structuredJobCount: 1 },
      reconciliation: { rawInputCount: 1, dedupeOutputCount: 1, adapterLosses: [] }
    });
  });

  it("rejects CNStaff endpoint, locator, page-coordinate, and official-total drift", async () => {
    const { plan, fetched } = await cnstaffFixture();
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

  it.each(["中山", "台州", "开封", "扬州", "温州", "潍坊", "烟台", "茂名", "临沂", "平顶山", "淮南", "淮安", "佛山", "新乡"])(
    "independently accepts the official CNStaff mainland city %s",
    async (location) => {
      const { plan, fetched } = await cnstaffFixture(location);
      expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified).toBe(true);
    }
  );

});
