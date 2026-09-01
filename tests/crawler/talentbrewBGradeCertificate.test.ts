import { describe, expect, it } from "vitest";
import { createHttpHtmlSourceFetch, type HttpHtmlRequest } from "../../src/crawler/httpHtmlSourceFetch";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import {
  buildStagedSourceCrawlPlans,
  getPlanBySourceId,
  sourcePlanConfigSha256
} from "../../src/crawler/sourcePlan";
import {
  createPlanBoundHtmlBrowserTraversalValidation,
  issueBGradeTraversalCertificate
} from "../../src/crawler/traversalCertificate";
import { candidateCompanies } from "../../src/data/companyRegistry";

const CAPTURED_AT = "2026-09-02T00:00:00.000Z";

describe("unpartitioned TalentBrew B-grade certificate", () => {
  it.each([
    ["source-sanofi-china-social", "company-sanofi-china", "https://jobs.sanofi.com/en/job/beijing/role/2649/"],
    ["source-takeda-china-social", "company-takeda-china", "https://jobs.takeda.com/job/beijing/role/1113/"]
  ] as const)("certifies an exact official-total traversal for %s", async (sourceId, companyId, jobPrefix) => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), sourceId);
    if (plan?.adapterId !== "html-table" || !plan.source.surfaceId || !plan.expectedChannels?.[0]) {
      throw new Error(`Missing TalentBrew plan ${sourceId}`);
    }
    let requestIndex = 0;
    const fetcher = createHttpHtmlSourceFetch({
      now: () => new Date(CAPTURED_AT),
      http: async (request: HttpHtmlRequest) => {
        const capturedAt = new Date(Date.parse(CAPTURED_AT) + requestIndex++ * 1_000).toISOString();
        if (request.url === plan.source.officialEntryUrl) {
          return response(request.url, entryHtml(), "text/html", capturedAt);
        }
        const currentPage = Number(new URL(request.url).searchParams.get("CurrentPage"));
        const id = currentPage === 1 ? "10001" : "10002";
        return response(request.url, JSON.stringify({
          results: resultsHtml(currentPage, id, `${jobPrefix}${id}`),
          filters: `<section id="search-filters"><input class="filter-checkbox"></section>`,
          hasJobs: true,
          hasContent: false
        }), "application/json", capturedAt);
      }
    });
    const fetched = await fetcher(plan);
    const result = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(result.status).toBe("SUCCESS");
    expect(result.jobs).toHaveLength(2);
    if (!result.fetchEvidence || !result.paginationEvaluation || !result.reconciliation) {
      throw new Error("Missing TalentBrew main traversal evidence");
    }
    const keys = result.jobs.map(buildJobDedupeKey).sort();
    const independentValidation = createPlanBoundHtmlBrowserTraversalValidation({
      sourceId,
      companyId,
      sourceConfigSha256: sourcePlanConfigSha256(plan),
      surfaceIds: [plan.source.surfaceId],
      channelIds: plan.expectedChannels.map(({ channelId }) => channelId),
      pages: keys.map((key, index) => ({
        pageNumber: index + 1,
        declaredTotalPages: keys.length,
        matchKeys: [key],
        nextControlPresent: index < keys.length - 1
      })),
      observedAt: CAPTURED_AT,
      expiresAt: "2026-09-09T00:00:00.000Z"
    });
    const decision = issueBGradeTraversalCertificate({
      binding: {
        releaseCandidateId: "rc-talentbrew",
        batchId: "batch-talentbrew",
        sourceResultId: `result-${sourceId}`,
        sourceConfigSha256: sourcePlanConfigSha256(plan)
      },
      plan,
      transportSuccess: true,
      adapterSuccess: true,
      evidence: result.fetchEvidence,
      paginationEvaluation: result.paginationEvaluation,
      reconciliation: result.reconciliation,
      jobs: result.jobs,
      independentValidation,
      validationExecution: "CURRENT_RUN",
      trigger: "INITIAL_QUALIFICATION",
      now: new Date("2026-09-02T00:05:00.000Z")
    });

    expect(decision.status, JSON.stringify({
      decision,
      declaration: result.fetchEvidence.declaredCompleteness,
      counts: result.fetchEvidence.fetchCounts,
      pages: result.fetchEvidence.pages.map((page) => ({
        declaredPages: page.declaredPages,
        termination: page.termination,
        validCount: page.validJobIds.length
      })),
      pagination: result.paginationEvaluation
    })).toBe("CERTIFIED");
  });
});

function entryHtml(): string {
  return `<div id="search-results" data-ajax-url="/search-results" data-total-pages="2" ` +
    `data-total-job-results="2" data-records-per-page="1" data-active-facet-id="0"></div>` +
    `<div id="search-filters"></div>`;
}

function resultsHtml(page: number, id: string, officialUrl: string): string {
  return `<div id="search-results" data-current-page="${page}" data-total-pages="2" ` +
    `data-total-job-results="2" data-records-per-page="1">` +
    `<ul id="search-results-list"><li><button class="js-save-job-btn" data-job-id="${id}"></button>` +
    `<h2 class="title">Role ${id}</h2><a href="${officialUrl}">Role ${id}</a>` +
    `<span class="job-location location">Beijing, China</span></li></ul></div>`;
}

function response(url: string, body: string, contentType: string, capturedAt: string) {
  return { status: 200, body, finalUrl: url, contentType, capturedAt };
}
