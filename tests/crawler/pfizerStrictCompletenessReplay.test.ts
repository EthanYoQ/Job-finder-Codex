import { describe, expect, it } from "vitest";
import { runSourceCrawl, type SourceFetchResult } from "../../src/crawler/runSourceCrawl";
import {
  createWorkdaySourceFetch,
  type WorkdayHttpRequest,
  type WorkdayHttpResponse
} from "../../src/crawler/workdaySourceFetch";
import { buildStagedSourceCrawlPlans, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const CAPTURED_AT = "2026-07-17T00:01:00.000Z";
const PFIZER_SOURCE_ID = "source-pfizer-china-social";
const OPAQUE_PATH = "/job/India---Vizag/Associate-Manager---Quality-Assurance_4958270-1";

type OfficialJsonPlan = Extract<SourceCrawlPlan, { adapterId: "official-json" }>;

function exactPfizerPlan(): OfficialJsonPlan {
  const plan = buildStagedSourceCrawlPlans(candidateCompanies)
    .find((candidate) => candidate.source.id === PFIZER_SOURCE_ID);
  if (plan?.adapterId !== "official-json" || !plan.workday) {
    throw new Error("Expected canonical staged Pfizer Workday plan");
  }
  return plan;
}

function response(request: Pick<WorkdayHttpRequest, "url">, body: unknown): WorkdayHttpResponse {
  return {
    status: 200,
    body: JSON.stringify(body),
    finalUrl: request.url,
    contentType: "application/json; charset=utf-8",
    capturedAt: CAPTURED_AT
  };
}

async function exactPfizerFetch(
  plan = exactPfizerPlan(),
  additionalLocation = "APAC - Any Pfizer Site"
): Promise<Extract<SourceFetchResult, { ok: true }>> {
  const fetcher = createWorkdaySourceFetch({
    now: () => new Date(CAPTURED_AT),
    http: async (request) => {
      const body = JSON.parse(request.body) as { appliedFacets: Record<string, string[]> };
      if (!body.appliedFacets.workerSubType) {
        return response(request, {
          total: 1,
          jobPostings: [],
          facets: [{
            facetParameter: "workerSubType",
            descriptor: "Job Type",
            values: [{ descriptor: "Regular", id: "regular-id", count: 1 }]
          }]
        });
      }
      return response(request, {
        total: 1,
        jobPostings: [{
          title: "Associate Manager - Quality Assurance",
          externalPath: OPAQUE_PATH,
          locationsText: "2 Locations",
          bulletFields: ["4958270"]
        }]
      });
    },
    detailHttp: async (request) => response(request, {
      jobPostingInfo: {
        title: "Associate Manager - Quality Assurance",
        jobPostingSiteId: "PfizerCareers",
        jobPostingId: "Associate-Manager---Quality-Assurance_4958270-1",
        jobReqId: "4958270",
        externalUrl: `https://pfizer.wd1.myworkdayjobs.com/PfizerCareers${OPAQUE_PATH}`,
        posted: true,
        canApply: true,
        location: "India - Vizag",
        additionalLocations: [additionalLocation]
      }
    })
  });
  const result = await fetcher(plan);
  if (!result.ok) throw new Error(`Expected safe Pfizer fixture fetch: ${result.failureReason}`);
  return result;
}

function mutateDetail(
  fetched: Extract<SourceFetchResult, { ok: true }>,
  location: string
): Extract<SourceFetchResult, { ok: true }> {
  if (!fetched.fetchEvidence) throw new Error("Expected Pfizer fetch evidence");
  return {
    ...fetched,
    fetchEvidence: {
      ...fetched.fetchEvidence,
      artifacts: fetched.fetchEvidence.artifacts.map((artifact) => {
        if (artifact.logicalKey !== "workday-detail-0000-0000") return artifact;
        const body = JSON.parse(artifact.body as string) as {
          jobPostingInfo: { additionalLocations: string[] };
        };
        body.jobPostingInfo.additionalLocations = [location];
        return { ...artifact, body: JSON.stringify(body) };
      })
    }
  };
}

describe("Pfizer strict source-bound completeness replay", () => {
  it("independently accepts the exact archived Pfizer listing and detail contract", async () => {
    const plan = exactPfizerPlan();
    const fetched = await exactPfizerFetch(plan);

    expect(await runSourceCrawl(plan, { fetch: async () => fetched })).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      observation: { completenessStatus: "VERIFIED", expectedJobCount: 1, structuredJobCount: 1 },
      jobs: [{
        locationRaw: "India - Vizag | APAC - Any Pfizer Site",
        cities: ["APAC - Any Pfizer Site"]
      }]
    });
  });

  it("also accepts a strict Pfizer detail that explicitly names mainland China", async () => {
    const plan = exactPfizerPlan();
    const fetched = await exactPfizerFetch(plan, "Shanghai, China");

    expect(await runSourceCrawl(plan, { fetch: async () => fetched })).toMatchObject({
      status: "SUCCESS",
      truth: { completenessVerified: true },
      jobs: [{ locationRaw: "India - Vizag | Shanghai, China", cities: ["上海"] }]
    });
  });

  it("rejects an archived Pfizer detail that replaces the exact audited APAC site with a broad region", async () => {
    const plan = exactPfizerPlan();
    const fetched = mutateDetail(await exactPfizerFetch(plan), "APAC");

    expect((await runSourceCrawl(plan, { fetch: async () => fetched })).truth.completenessVerified)
      .toBe(false);
  });
});
