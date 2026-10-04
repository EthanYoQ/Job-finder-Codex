/** Invented jobs and in-memory transport only. Never current official evidence. */
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, type SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { createOwnedSourceQualityFetch } from "../../src/crawler/sourceQualityAdmission";
import { runSourceCrawl, replayStrictSourceQualityEvidence } from "../../src/crawler/runSourceCrawl";

export const LILLY_SYNTHETIC_FIXTURE_KIND = "SYNTHETIC_LILLY_OFFLINE_TEST_ONLY_NO_LIVE_QUALIFICATION";
export const lillyBootstrap = { widgetApiEndpoint: "https://careers.lilly.com/widgets", country: "us", deviceType: "desktop",
  locale: "en_us", refNum: "LILLUS", pageName: "search-results", pageId: "page11-ds" };
const corporate = "At Lilly, we unite caring with discovery to make life better for people around the world. We are a global healthcare leader headquartered in Indianapolis, Indiana. Our employees around the world ";
export function syntheticLillyRow(index = 0, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const reqId = `R-${800000 + index}`;
  return { jobId: reqId, reqId, jobSeqNo: `LILLUS${reqId.replace("-", "")}EXTERNALENUS`,
    title: "Synthetic Quality Scientist", descriptionTeaser: "Synthetic pharmaceutical quality role.",
    ml_job_parser: {descriptionTeaser: "Synthetic pharmaceutical quality role.", descriptionTeaser_first200: `${corporate}wo...`,
      descriptionTeaser_keyword: `${corporate}work...`, descriptionTeaser_ats: `${corporate}work `},
    country: "China", city: "Shanghai", state: "Shanghai", location: "Shanghai, Shanghai, China",
    cityState: "Shanghai, Shanghai", cityStateCountry: "Shanghai, Shanghai, China", latitude: "31.22222", longitude: "121.45806",
    address: "16F No.288 Shimen 1RD, Shanghai, 200041 Shanghai, China", isMultiLocation: true,
    multi_location: ["Shanghai, Shanghai, China"],
    multi_location_array: [{location: "Shanghai, Shanghai, China", latlong: {lat: 31.22222, lon: 121.45806}}],
    applyUrl: `https://lilly.wd115.myworkdayjobs.com/LLY/job/China-Shang-Hai-/Synthetic-Quality-Scientist_${reqId}/apply`,
    siteType: "external", visibilityType: "External", jobVisibility: ["external"], externalApply: false, locale: "en_US",
    postedDate: "2025-11-12T00:00:00.000+0000", dateCreated: "2026-09-29T12:05:11.334+0000", ...overrides };
}
export function lillyPlan() { return getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-lilly-china-social")!; }
export function syntheticLillyNativeDetailBody(row: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  return `<script>window.workday = {postingAvailable: true};</script><script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting", identifier: {value: row.reqId}, title: row.title, description: "Synthetic pharmaceutical quality role.",
    datePosted: new Date(String(row.postedDate)).toISOString().slice(0, 10),
    jobLocation: {address: {addressCountry: "China", addressLocality: "Shang Hai"}}, ...overrides
  })}</script>`;
}
export async function captureSyntheticLilly(rows = [syntheticLillyRow()], options: {
  plan?: SourceCrawlPlan; owned?: boolean; pages?: unknown[][]; from?: number; totals?: number[]; bootstrap?: object;
  selection?: unknown; bodies?: string[]; entryBody?: string; detailBodies?: Record<string, string>;
} = {}) {
  const plan = options.plan ?? lillyPlan(), pages = options.pages ?? Array.from({length: Math.max(1, Math.ceil(rows.length / 50))}, (_, i) => rows.slice(i * 50, i * 50 + 50));
  const requests: {url: string; method: string; body: unknown}[] = [], originalFetch = globalThis.fetch, startedAt = new Date();
  const detailRows = new Map(pages.flat().filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map(row => [String(row.applyUrl), row]));
  const requestedDetails = new Set<string>();
  let pageIndex = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input), method = init?.method ?? "GET";
    requests.push({url, method, body: init?.body});
    let body: string;
    if (requests.length === 1 && url === plan.source.officialEntryUrl && method === "GET") {
      body = options.entryBody ?? `<script>var phApp=${JSON.stringify({...lillyBootstrap, ...options.bootstrap})};</script>`;
    } else if (requests.length > 1 && url === lillyBootstrap.widgetApiEndpoint && method === "POST" && pageIndex < pages.length && requestedDetails.size === 0) {
      const index = pageIndex++;
      body = options.bodies?.[index] ?? JSON.stringify({refineSearch: {status: 200, hits: pages[index]!.length, totalHits: options.totals?.[index] ?? pages.flat().length,
        ...(options.from === undefined ? {} : {from: options.from}), data: {jobs: pages[index], aggregations: [], ui_selections: options.selection ?? {country: ["China"]}}}});
    } else if (method === "GET" && pageIndex === pages.length && detailRows.has(url) && !requestedDetails.has(url)) {
      requestedDetails.add(url);
      body = options.detailBodies?.[url] ?? syntheticLillyNativeDetailBody(detailRows.get(url)!);
    } else {
      throw Error("SYNTHETIC_LILLY_UNEXPECTED_REQUEST_NO_NETWORK_FALLBACK");
    }
    const response = new Response(body, {status: 200, headers: {"content-type": method === "GET" ? "text/html" : "application/json"}});
    Object.defineProperty(response, "url", {value: url}); return response;
  };
  try {
    const result = await runSourceCrawl(plan, {fetch: options.owned ? createOwnedSourceQualityFetch() : createOfficialJsonSourceFetch({allowBrowserFallback: false}), isBaseline: false});
    return {plan, result, startedAt, requests};
  } finally { globalThis.fetch = originalFetch; }
}
export function replayLilly(input: Awaited<ReturnType<typeof captureSyntheticLilly>>, jobs = input.result.jobs, evidence = input.result.fetchEvidence!) {
  return replayStrictSourceQualityEvidence({plan: input.plan, evidence, jobs, capturedAt: input.result.observation.crawledAt.toISOString(),
    paginationEvaluation: input.result.paginationEvaluation!, reconciliation: input.result.reconciliation!});
}
