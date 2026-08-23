import { describe, expect, it } from "vitest";
import { runSourceCrawl, type SourceFetchResult } from "../../src/crawler/runSourceCrawl";
import {
  BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
  createWorkdaySourceFetch,
  type WorkdayHttpRequest,
  type WorkdayHttpResponse
} from "../../src/crawler/workdaySourceFetch";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const CAPTURED_AT = "2026-07-15T00:01:00.000Z";
const BMS_SOURCE_ID = "source-bms-china-social";
const SEATTLE_ALIAS = "WA04 PSA Celgene - Seattle Dexter Avenue - WA";
const SAN_DIEGO_RAYZEBIO_ALIAS = "CA15 San Diego RayzeBio";
const DEVENS_ALIAS = "MA03 PSA Devens - MA";

type OfficialJsonPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;

function exactBmsPlan(): OfficialJsonPlan {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies)
    .find((candidate) => candidate.source.id === BMS_SOURCE_ID);
  if (plan?.adapterId !== "official-json" || !plan.workday) {
    throw new Error("Expected canonical staged BMS Workday plan");
  }
  return plan;
}

function response(request: WorkdayHttpRequest, body: unknown): WorkdayHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: request.url,
    contentType: "application/json; charset=utf-8",
    capturedAt: CAPTURED_AT
  };
}

function bmsFixtureFetch() {
  const jobs = Array.from({ length: 21 }, (_, index) => ({
    title: `BMS China Role ${index + 1}`,
    externalPath: `/job/China/bms-china-role-${index + 1}`,
    locationsText: index % 2 === 0 ? "Shanghai, China" : "Beijing, China",
    workerSubType: index < 20 ? "Fixed Term (Fixed Term)" : "Permanent"
  }));
  const locationFacet = {
    facetParameter: "locationHierarchy2",
    descriptor: "Country",
    values: [
      { descriptor: "China", id: "bms-china-id", count: 21 },
      { descriptor: SEATTLE_ALIAS, id: "bms-seattle-id", count: 1 }
    ]
  };
  const workerFacet = {
    facetParameter: "workerSubType",
    descriptor: "Job Type",
    values: [
      { descriptor: "Fixed Term (Fixed Term)", id: "bms-fixed-term-id", count: 20 },
      { descriptor: "Permanent", id: "bms-permanent-id", count: 1 }
    ]
  };
  return createWorkdaySourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async (request) => {
      const body = JSON.parse(request.body) as {
        appliedFacets: Record<string, string[]>;
        limit: number;
        offset: number;
      };
      if (!body.appliedFacets.locationHierarchy2) {
        return response(request, { total: 22, jobPostings: [], facets: [locationFacet] });
      }
      if (!body.appliedFacets.workerSubType) {
        return response(request, { total: 21, jobPostings: [], facets: [workerFacet] });
      }
      return response(request, {
        total: body.offset === 0 ? 21 : 0,
        jobPostings: jobs.slice(body.offset, body.offset + body.limit),
        facets: body.offset === 0 ? [locationFacet, workerFacet] : [],
        userAuthenticated: false
      });
    }
  });
}

async function exactBmsFetch(plan = exactBmsPlan()): Promise<Extract<SourceFetchResult, { ok: true }>> {
  const result = await bmsFixtureFetch()(plan);
  if (!result.ok) throw new Error(`Expected safe BMS fixture fetch: ${result.failureReason}`);
  return result;
}

function mutateEvidence(
  fetched: Extract<SourceFetchResult, { ok: true }>,
  mutate: (evidence: NonNullable<Extract<SourceFetchResult, { ok: true }>["fetchEvidence"]>) =>
    NonNullable<Extract<SourceFetchResult, { ok: true }>["fetchEvidence"]>
): Extract<SourceFetchResult, { ok: true }> {
  if (!fetched.fetchEvidence) throw new Error("Expected BMS fetch evidence");
  return { ...fetched, fetchEvidence: mutate(fetched.fetchEvidence) };
}

describe("BMS strict source-bound completeness replay", () => {
  it("verifies the canonical BMS fetch only after independently replaying its China, worker, and later-zero proof", async () => {
    expect(BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES).toContain(SEATTLE_ALIAS);
    expect(BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES).toContain(SAN_DIEGO_RAYZEBIO_ALIAS);
    expect(BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES).toContain(DEVENS_ALIAS);
    const plan = exactBmsPlan();
    const fetched = await exactBmsFetch(plan);

    expect(fetched).toMatchObject({
      completeness: { expectedJobCount: 21 },
      fetchEvidence: {
        fetchCounts: {
          rawCount: 21,
          parsedCount: 21,
          validCount: 21,
          parseDiscardCount: 0,
          validationDiscardCount: 0
        },
        fetchLosses: []
      },
      paginationEvaluation: { safeCompleteness: true, derivedAnomalyCodes: [] }
    });

    expect(await runSourceCrawl(plan, { fetch: async () => fetched })).toMatchObject({
      status: "SUCCESS",
      truth: { transportSuccess: true, adapterSuccess: true, completenessVerified: true },
      jobs: expect.arrayContaining([expect.objectContaining({ companyId: "company-bms-china" })]),
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 21, structuredJobCount: 21 },
      reconciliation: { rawInputCount: 21, dedupeOutputCount: 21, adapterLosses: [] }
    });
  });

  it("rejects deletion of one audited BMS foreign-site alias", async () => {
    const plan = exactBmsPlan();
    const fetched = await exactBmsFetch(plan);
    const policy = plan.workday?.locationFacetPolicy;
    if (policy?.kind !== "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST") throw new Error("Expected BMS policy");
    const driftedPlan: OfficialJsonPlan = {
      ...plan,
      workday: {
        ...plan.workday!,
        locationFacetPolicy: {
          ...policy,
          foreignSiteDescriptorAliases: policy.foreignSiteDescriptorAliases.slice(0, -1)
        }
      }
    };

    expect((await runSourceCrawl(driftedPlan, { fetch: async () => fetched })).truth.completenessVerified)
      .toBe(false);
  });

  it("rejects an unknown foreign descriptor injected into the archived BMS location facet", async () => {
    const plan = exactBmsPlan();
    const fetched = mutateEvidence(await exactBmsFetch(plan), (evidence) => ({
      ...evidence,
      artifacts: evidence.artifacts.map((artifact) => {
        if (artifact.logicalKey !== "workday-preflight-0000") return artifact;
        const body = JSON.parse(artifact.body as string) as { facets: Array<{ values: unknown[] }> };
        body.facets[0]!.values.push({ descriptor: "Unknown Offshore Campus", id: "unknown-id", count: 1 });
        return { ...artifact, body: JSON.stringify(body) };
      })
    }));

    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified)
      .toBe(false);
  });

  it("rejects BMS plan tenant and request-contract hash drift", async () => {
    const plan = exactBmsPlan();
    const fetched = await exactBmsFetch(plan);
    const tenantDrift: OfficialJsonPlan = {
      ...plan,
      workday: { ...plan.workday!, tenant: "bristolmyerssquibb-drift" }
    };
    const hashDrift = mutateEvidence(fetched, (evidence) => ({
      ...evidence,
      artifacts: evidence.artifacts.map((artifact) => artifact.logicalKey === "workday-preflight-0000"
        ? { ...artifact, extractorLocator: `${artifact.extractorLocator.replace(/[0-9a-f]{64}$/u, "")}${"0".repeat(64)}` }
        : artifact)
    }));

    expect((await runSourceCrawl(tenantDrift, { fetch: async () => fetched })).truth.completenessVerified)
      .toBe(false);
    expect((await runSourceCrawl(plan, { fetch: async () => hashDrift })).truth.completenessVerified)
      .toBe(false);
  });

  it("rejects archived BMS page-coordinate drift", async () => {
    const plan = exactBmsPlan();
    const fetched = mutateEvidence(await exactBmsFetch(plan), (evidence) => ({
      ...evidence,
      pages: evidence.pages.map((page) => page.sequence === 0
        ? { ...page, requestedPage: 1 }
        : page)
    }));

    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified)
      .toBe(false);
  });
});
