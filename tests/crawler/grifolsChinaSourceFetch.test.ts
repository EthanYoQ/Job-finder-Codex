import { describe, expect, it } from "vitest";
import {
  GRIFOLS_CHINA_FETCH_CONFIG,
  createGrifolsChinaSourceFetch,
  validateStrictGrifolsChinaEvidence,
  type GrifolsChinaHttpResponse
} from "../../src/crawler/grifolsChinaSourceFetch";
import { buildStagedSourceCrawlPlans, getPlanBySourceId } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { requiresAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";

const NOW = "2026-09-02T05:00:00.000Z";
const ENTRY = "https://jobsearch.grifols.com/search/?createNewAlert=false&q=&locationsearch=China";
const MARKETING = "https://jobsearch.grifols.com/job/Shanghai-Marketing-Assistant/1429532033/";
const FIELD_SERVICE = "https://jobsearch.grifols.com/job/Home-Office-%E7%8F%BE%E5%A0%B4%E6%9C%8D%E5%8B%99%E5%B7%A5%E7%A8%8B%E5%B8%AB-Field-Service-Engineer/1409962833/";

const list = `<span class="paginationLabel">Results <b>1 – 2</b> of <b>2</b></span>
  <table id="searchresults" aria-label="Search results for China. Page 1 of 1, Results 1 to 2 of 2"><tbody>
    <tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Shanghai-Marketing-Assistant/1429532033/">Marketing Assistant</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Shanghai, CN</span></td></tr>
    <tr class="data-row"><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Home-Office-%E7%8F%BE%E5%A0%B4%E6%9C%8D%E5%8B%99%E5%B7%A5%E7%A8%8B%E5%B8%AB-Field-Service-Engineer/1409962833/">現場服務工程師 / Field Service Engineer</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Home Office, CN</span></td></tr>
  </tbody></table>`;

function detail(url: string, streetAddress: string, officialLocation: string): string {
  return `<link rel="canonical" href="${url}">
    <div class="jobDisplayShell" itemscope itemtype="http://schema.org/JobPosting">
      <span itemprop="jobLocation"><span itemprop="address"><meta itemprop="streetAddress" content="${streetAddress}"></span></span>
      <div class="jobDisplay"><div class="content"><p><b>Location: ${officialLocation}</b></p></div></div>
    </div>`;
}

function response(url: string, body: string): GrifolsChinaHttpResponse {
  return { status: 200, body, finalUrl: url, contentType: "text/html; charset=utf-8", capturedAt: NOW };
}

describe("Grifols China detail-scoped source", () => {
  it("keeps raw two, proves the Hong Kong exclusion from its detail, and publishes one", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-grifols-china-social");
    expect(plan).toMatchObject({
      adapterId: "official-json",
      profileBoundSource: { kind: "grifols-china-detail-scope", config: GRIFOLS_CHINA_FETCH_CONFIG }
    });
    if (plan?.adapterId !== "official-json" || plan.profileBoundSource?.kind !== "grifols-china-detail-scope") {
      throw new Error("Expected Grifols detail-scoped plan");
    }
    expect(requiresAGradeOfficialTotalCertificate(plan)).toBe(false);
    const requested: string[] = [];
    const fetch = createGrifolsChinaSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => {
        requested.push(request.url);
        if (request.url === ENTRY) return response(request.url, list);
        if (request.url === MARKETING) {
          return response(request.url, detail(request.url, "Shanghai, CN", "APAC : China : Shanghai:Shangai"));
        }
        if (request.url === FIELD_SERVICE) {
          return response(request.url, detail(request.url, "Home Office, CN", "APAC : Hong Kong : Home Office:Hong Kong"));
        }
        throw new Error("unexpected URL");
      }
    });
    const fetched = await fetch(plan);

    expect(requested).toEqual([ENTRY, MARKETING, FIELD_SERVICE]);
    expect(fetched).toMatchObject({
      ok: true,
      payload: { jobs: [{ title: "Marketing Assistant", locationRaw: "Shanghai, CN" }] },
      fetchEvidence: {
        declaredCompleteness: { kind: "OFFICIAL_TOTAL_COUNT", value: 2, scope: "SOURCE" },
        fetchCounts: { rawCount: 2, parsedCount: 2, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 1 },
        fetchLosses: [{
          stage: "VALIDATION",
          reason: "official detail places the job outside mainland China",
          details: { code: "VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE", recordIndex: 1 }
        }]
      }
    });
    if (!fetched.ok || !fetched.fetchEvidence || !("payload" in fetched)) throw new Error("Expected evidence-backed fetch");
    const crawl = await runSourceCrawl(plan, { fetch: async () => fetched });
    expect(crawl.jobs).toHaveLength(1);
    expect(validateStrictGrifolsChinaEvidence(plan, fetched.fetchEvidence, crawl.jobs)).toBe(true);
    expect(crawl.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
  });

  it("fails closed when a detail lacks an explicit official mainland or non-mainland location", async () => {
    const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-grifols-china-social");
    if (plan?.adapterId !== "official-json") throw new Error("Expected Grifols plan");
    const fetch = createGrifolsChinaSourceFetch({
      now: () => new Date(NOW),
      http: async (request) => {
        if (request.url === ENTRY) return response(request.url, list);
        if (request.url === MARKETING) {
          return response(request.url, detail(request.url, "Shanghai, CN", "APAC : China : Shanghai:Shangai"));
        }
        return response(request.url, detail(request.url, "Home Office, CN", "APAC : Home Office"));
      }
    });
    await expect(fetch(plan)).resolves.toMatchObject({ ok: false, failureReason: "GRIFOLS_DETAIL_SCOPE_AMBIGUOUS" });
  });
});
