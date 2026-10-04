import { describe, expect, it } from "vitest";
import { createHttpHtmlSourceFetch } from "../../src/crawler/httpHtmlSourceFetch";
import { validateStrictHtmlCompletenessProof } from "../../src/crawler/strictHtmlCompletenessProof";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";

const capturedAt = "2026-09-30T00:00:00.000Z";
function astraPlan() {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-astrazeneca-social");
  if (plan?.adapterId !== "html-table") throw new Error("Expected Astra HTML plan");
  return plan;
}
// Synthetic response pages exercise URL/evidence binding, not a live count claim.
const html = (page: string) => `<section id="search-results" data-total-pages="2" data-total-job-results="2"></section>
  <ul id="search-results-list"><li><a class="search-results-link" href="/job/test/${page}"><h2>Role ${page}</h2></a><span class="job-location">Shanghai, China</span></li></ul>`;

describe("Astra explicit first page reconstruction", () => {
  it("requests p=1 before p=2 and strictly replays both source-bound pages", async () => {
    const plan = astraPlan();
    const requests: string[] = [];
    const result = await createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http: async request => {
      requests.push(request.url);
      const page = new URL(request.url).searchParams.get("p");
      return { status: page ? 200 : 404, body: page ? html(page) : "landing boundary", finalUrl: request.url, contentType: "text/html", capturedAt };
    }})(plan);
    expect(requests.map(url => new URL(url).searchParams.get("p"))).toEqual(["1", "2"]);
    expect(result.ok).toBe(true);
    if (!result.ok || !result.fetchEvidence) throw new Error("Expected captured pages");
    expect(validateStrictHtmlCompletenessProof(plan, result.fetchEvidence)).toBe(true);
    const tampered = structuredClone(result.fetchEvidence);
    tampered.artifacts[0]!.requestedUrl = plan.source.officialEntryUrl;
    expect(validateStrictHtmlCompletenessProof(plan, tampered)).toBe(false);
  });

  it("does not enable the first-page option on any other canonical source", () => {
    const sources = buildStagedSourceCrawlPlans(candidateCompanies).filter(plan =>
      plan.adapterId === "html-table" && (plan.table.pagination as { requestFirstPageExplicitly?: boolean })?.requestFirstPageExplicitly);
    expect(sources.map(plan => plan.source.id)).toEqual(["source-astrazeneca-social"]);
  });

  it("fails closed on an explicit first-page error without falling back to the bare landing page", async () => {
    const requests: string[] = [];
    const result = await createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http: async request => {
      requests.push(request.url);
      return { status: 404, body: "not available", finalUrl: request.url, contentType: "text/html", capturedAt };
    }})(astraPlan());
    expect(result.ok).toBe(false);
    expect(requests.map(url => new URL(url).searchParams.get("p"))).toEqual(["1"]);
  });

  it.each(["duplicate-page", "total-drift"]) ("rejects %s during independent replay", async variant => {
    const plan = astraPlan();
    const result = await createHttpHtmlSourceFetch({ now: () => new Date(capturedAt), http: async request => {
      const page = new URL(request.url).searchParams.get("p")!;
      const body = variant === "duplicate-page" ? html("1") :
        page === "2" ? html(page).replace('data-total-job-results="2"', 'data-total-job-results="3"') : html(page);
      return { status: 200, body, finalUrl: request.url, contentType: "text/html", capturedAt };
    }})(plan);
    expect(result.fetchEvidence).toBeDefined();
    if (!result.fetchEvidence) throw new Error("Expected failure evidence");
    expect(validateStrictHtmlCompletenessProof(plan, result.fetchEvidence)).toBe(false);
  });
});
