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
    <tr class="data-row"><td class="colDate hidden-phone"><span class="jobDate">Sep 1, 2026</span></td><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Shanghai-Marketing-Assistant/1429532033/">Marketing Assistant</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Shanghai, CN</span></td></tr>
    <tr class="data-row"><td class="colDate hidden-phone"><span class="jobDate">Sep 1, 2026</span></td><td class="jobTitle hidden-phone"><a class="jobTitle-link" href="/job/Home-Office-%E7%8F%BE%E5%A0%B4%E6%9C%8D%E5%8B%99%E5%B7%A5%E7%A8%8B%E5%B8%AB-Field-Service-Engineer/1409962833/">現場服務工程師 / Field Service Engineer</a></td><td class="colLocation hidden-phone"><span class="jobLocation">Home Office, CN</span></td></tr>
  </tbody></table>`;

function detail(url: string, streetAddress: string, officialLocation: string): string {
  return `<link rel="canonical" href="${url}">
    <div class="jobDisplayShell" itemscope itemtype="http://schema.org/JobPosting">
      <meta itemprop="datePosted" content="Tue Sep 01 00:00:00 UTC 2026">
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
    expect(requiresAGradeOfficialTotalCertificate(plan)).toBe(true);
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


// These are newly constructed offline regression examples, not recovered official captures.
const MAINLAND_LOCATION = "APAC : China : Shanghai:Shangai";
const HONG_KONG_LOCATION = "APAC : Hong Kong : Home Office:Hong Kong";
const COUNTRYWIDE_LOCATION = "Open to candidates across China, not limited to Shanghai.";

function detailContent(url: string, streetAddress: string, content: string): string {
  return detail(url, streetAddress, "__CONTENT__")
    .replace("<p><b>Location: __CONTENT__</b></p>", content);
}

async function fetchSyntheticDetails(options: {
  marketingContent?: string;
  fieldContent?: string;
  fieldStreetAddress?: string;
  listHtml?: string;
  marketingUrl?: string;
} = {}) {
  const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-grifols-china-social");
  if (plan?.adapterId !== "official-json") throw new Error("Expected Grifols plan");
  const fetch = createGrifolsChinaSourceFetch({
    now: () => new Date(NOW),
    http: async (request) => {
      if (request.url === ENTRY) return response(request.url, options.listHtml ?? list);
      if (request.url === MARKETING) return response(request.url, detailContent(
        options.marketingUrl ?? request.url,
        "Shanghai, CN",
        options.marketingContent ?? `<p><b>Location: ${MAINLAND_LOCATION}</b></p>`
      ));
      if (request.url === FIELD_SERVICE) return response(request.url, detailContent(
        request.url,
        options.fieldStreetAddress ?? "Home Office, CN",
        options.fieldContent ?? `<p><b>Location: ${HONG_KONG_LOCATION}</b></p>`
      ));
      throw new Error("Unexpected synthetic fixture request");
    }
  });
  return { plan, fetched: await fetch(plan) };
}

async function verifiedSyntheticDetails(options: Parameters<typeof fetchSyntheticDetails>[0] = {}) {
  const { plan, fetched } = await fetchSyntheticDetails(options);
  expect(fetched.ok).toBe(true);
  if (!fetched.ok || !fetched.fetchEvidence || !("payload" in fetched)) {
    throw new Error("Expected successful offline Grifols evidence");
  }
  const crawl = await runSourceCrawl(plan, { fetch: async () => fetched });
  expect(crawl.truth).toEqual({ transportSuccess: true, adapterSuccess: true, completenessVerified: true });
  expect(validateStrictGrifolsChinaEvidence(plan, fetched.fetchEvidence, crawl.jobs)).toBe(true);
  return { plan, fetched, crawl, evidence: fetched.fetchEvidence };
}

describe("Grifols location semantic reconstruction", () => {
  it.each(["b", "strong"])("reads a split %s Location label within its immediate paragraph", async (tag) => {
    const { evidence, crawl } = await verifiedSyntheticDetails({
      marketingContent: `<p><${tag}>Location:</${tag}> ${MAINLAND_LOCATION}</p>`,
      fieldContent: `<p><${tag}>Location:</${tag}> ${HONG_KONG_LOCATION}</p>`
    });
    expect(crawl.jobs).toHaveLength(1);
    expect(crawl.jobs[0]).toMatchObject({ locationRaw: "Shanghai, CN", cities: ["上海"] });
    expect(evidence.fetchCounts).toEqual({
      rawCount: 2, parsedCount: 2, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 1
    });
  });

  it.each(["b", "strong"])("preserves a standalone complete %s Location label", async (tag) => {
    const { crawl } = await verifiedSyntheticDetails({
      marketingContent: `<${tag}>Location: ${MAINLAND_LOCATION}</${tag}>`,
      fieldContent: `<${tag}>Location: ${HONG_KONG_LOCATION}</${tag}>`
    });
    expect(crawl.jobs).toHaveLength(1);
  });

  it("deduplicates repeated statements after whitespace and colon-spacing normalization", async () => {
    const { crawl } = await verifiedSyntheticDetails({
      marketingContent: `<p><b>Location: ${MAINLAND_LOCATION}</b></p>
        <p><strong>Location :</strong> APAC:China:Shanghai : Shangai</p>`,
      fieldContent: `<p><strong>Location: ${HONG_KONG_LOCATION}</strong></p>
        <p><b>Location:</b> APAC : Hong   Kong : Home Office : Hong Kong</p>`
    });
    expect(crawl.jobs).toHaveLength(1);
  });

  it("keeps unrelated following paragraphs outside a complete location statement", async () => {
    const { crawl } = await verifiedSyntheticDetails({
      marketingContent: `<p><b>Location: ${MAINLAND_LOCATION}</b></p><p>Collaborate with the Hong Kong team.</p>`
    });
    expect(crawl.jobs).toHaveLength(1);
  });

  it.each([
    `<p><b>Location: ${COUNTRYWIDE_LOCATION}</b></p>`,
    `<p><strong>Location:</strong> ${COUNTRYWIDE_LOCATION}</p>`,
    `<p><b>Location:</b> ${COUNTRYWIDE_LOCATION}</p><p><strong>Location: ${COUNTRYWIDE_LOCATION}</strong></p>`
  ])("keeps a bound nationwide statement countrywide: %s", async (fieldContent) => {
    const { evidence, crawl } = await verifiedSyntheticDetails({ fieldContent });
    expect(crawl.jobs).toHaveLength(2);
    expect(crawl.jobs.find((job) => job.sourceJobId === "1409962833"))
      .toMatchObject({ locationRaw: "Home Office, CN", cities: ["全国"] });
    expect(evidence.fetchCounts).toEqual({
      rawCount: 2, parsedCount: 2, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 0
    });
    expect(evidence.fetchLosses).toEqual([]);
  });

  it.each([
    ["conflicting complete statements", `<p><b>Location: ${MAINLAND_LOCATION}</b></p><p><strong>Location: ${HONG_KONG_LOCATION}</strong></p>`],
    ["conflicting split statements", `<p><b>Location:</b> ${MAINLAND_LOCATION}</p><p><strong>Location:</strong> ${HONG_KONG_LOCATION}</p>`],
    ["unbolded foreign suffix", `<p><b>Location: ${MAINLAND_LOCATION}</b> or Hong Kong</p>`],
    ["nearby foreign span", `<p><strong>Location: ${MAINLAND_LOCATION}</strong><span> or Singapore</span></p>`],
    ["mixed foreign suffix", `<p><b>Location: ${MAINLAND_LOCATION}; Singapore</b></p>`],
    ["mixed country path", `<p><b>Location: APAC : China : Shanghai:Hong Kong</b></p>`],
    ["unproven tail", `<p><b>Location: APAC : China : Shanghai:Unknown</b></p>`],
    ["empty China path", "<p><b>Location: APAC : China :</b></p>"],
    ["partial bold label", "<p><b>Location: APAC</b> : China : Shanghai:Shangai</p>"],
    ["different bold label", `<p><b>Location details:</b> ${MAINLAND_LOCATION}</p>`],
    ["preceding unrelated content", `<p>Requirements <b>Location:</b> ${MAINLAND_LOCATION}</p>`],
    ["standalone complete label with foreign tail", `<b>Location: ${MAINLAND_LOCATION}</b>; Singapore`],
    ["standalone complete label with foreign span", `<strong>Location: ${MAINLAND_LOCATION}</strong><span> or Hong Kong</span>`],
    ["unbounded content parent", `<b>Location:</b> ${MAINLAND_LOCATION}`],
    ["following paragraph", `<p><b>Location:</b></p><p>${MAINLAND_LOCATION}</p>`],
    ["oversized parent", `<p><b>Location:</b> ${MAINLAND_LOCATION} ${"x".repeat(1024)}</p>`]
  ])("fails closed for %s in both fetch and archived replay", async (_name, marketingContent) => {
    const { fetched } = await fetchSyntheticDetails({ marketingContent });
    expect(fetched).toMatchObject({ ok: false, failureReason: "GRIFOLS_DETAIL_SCOPE_AMBIGUOUS" });
    const { plan, evidence, crawl } = await verifiedSyntheticDetails();
    const changed = structuredClone(evidence);
    changed.artifacts.find((artifact) => artifact.logicalKey === "grifols-detail-0000")!.body =
      detailContent(MARKETING, "Shanghai, CN", marketingContent);
    expect(validateStrictGrifolsChinaEvidence(plan, changed, crawl.jobs)).toBe(false);
  });

  it.each([
    `<p><span><b>Location:</b> ${COUNTRYWIDE_LOCATION}</span>; Singapore</p>`,
    `<p><span><b>Location:</b> ${COUNTRYWIDE_LOCATION}</span><span> or Hong Kong</span></p>`,
    `<p><span><span><strong>Location:</strong> ${COUNTRYWIDE_LOCATION}</span>; Singapore</span></p>`,
    `<p><span><b>Location: ${COUNTRYWIDE_LOCATION}</b></span>; Singapore</p>`,
    `<p><span><strong>Location: ${COUNTRYWIDE_LOCATION}</strong></span><span> or Hong Kong</span></p>`,
    `<p><span><span><b>Location: ${COUNTRYWIDE_LOCATION}</b></span>; Singapore</span></p>`
  ])("rejects contradictions outside an inline wrapper in fetch and replay: %s", async (fieldContent) => {
    const { fetched } = await fetchSyntheticDetails({ fieldContent });
    expect.soft(fetched).toMatchObject({ ok: false, failureReason: "GRIFOLS_DETAIL_SCOPE_AMBIGUOUS" });
    const { plan, evidence, crawl } = await verifiedSyntheticDetails({
      fieldContent: `<p><b>Location:</b> ${COUNTRYWIDE_LOCATION}</p>`
    });
    const changed = structuredClone(evidence);
    changed.artifacts.find((artifact) => artifact.logicalKey === "grifols-detail-0001")!.body =
      detailContent(FIELD_SERVICE, "Home Office, CN", fieldContent);
    expect(validateStrictGrifolsChinaEvidence(plan, changed, crawl.jobs)).toBe(false);
  });

  it.each(["b", "strong"])("accepts a clean wrapped %s split label without borrowing later paragraphs", async (tag) => {
    const { crawl } = await verifiedSyntheticDetails({
      fieldContent: `<p><span><${tag}>Location:</${tag}> ${COUNTRYWIDE_LOCATION}</span></p>
        <p>Collaborate with the Singapore and Hong Kong teams.</p>`
    });
    expect(crawl.jobs.find((job) => job.sourceJobId === "1409962833")?.cities).toEqual(["全国"]);
  });

  it.each([
    "Open to candidates across China, not limited to Shanghai",
    "Open to candidates across China.",
    "Open to candidates across China, not limited to Shanghai. Or Hong Kong.",
    "APAC : China : Home Office",
    "APAC : Home Office"
  ])("rejects unproven nationwide wording: %s", async (location) => {
    const { fetched } = await fetchSyntheticDetails({ fieldContent: `<p><b>Location: ${location}</b></p>` });
    expect(fetched).toMatchObject({ ok: false, failureReason: "GRIFOLS_DETAIL_SCOPE_AMBIGUOUS" });
  });

  it.each(["Shanghai, CN", "Home Office, US"])("rejects nationwide wording bound to %s", async (location) => {
    const { fetched } = await fetchSyntheticDetails({
      listHtml: list.replace("Home Office, CN", location),
      fieldStreetAddress: location,
      fieldContent: `<p><b>Location: ${COUNTRYWIDE_LOCATION}</b></p>`
    });
    expect(fetched).toMatchObject({ ok: false, failureReason: "GRIFOLS_DETAIL_SCOPE_AMBIGUOUS" });
  });

  it("retains canonical URL and list/detail address binding", async () => {
    const wrongCanonical = await fetchSyntheticDetails({ marketingUrl: FIELD_SERVICE });
    expect(wrongCanonical.fetched).toMatchObject({ ok: false, failureReason: "GRIFOLS_DETAIL_INVALID" });
    const wrongAddress = await fetchSyntheticDetails({
      fieldStreetAddress: "Shanghai, CN",
      fieldContent: `<p><b>Location: ${COUNTRYWIDE_LOCATION}</b></p>`
    });
    expect(wrongAddress.fetched).toMatchObject({ ok: false, failureReason: "GRIFOLS_DETAIL_INVALID" });
  });

  it.each([
    { cities: ["上海"] },
    { cities: ["China", "Shanghai"] },
    { locationRaw: "Shanghai, CN" },
    { officialTitle: "Invented title" },
    { officialUrl: MARKETING },
    { sourceJobId: "not-the-official-id" }
  ])("rejects normalized nationwide output tampering: %j", async (change) => {
    const { plan, evidence, crawl } = await verifiedSyntheticDetails({
      fieldContent: `<p><b>Location:</b> ${COUNTRYWIDE_LOCATION}</p>`
    });
    const output = crawl.jobs.map((job) => job.sourceJobId === "1409962833" ? { ...job, ...change } : job);
    expect(validateStrictGrifolsChinaEvidence(plan, evidence, output)).toBe(false);
  });

  it("retains raw-count, exclusion, and pagination replay gates", async () => {
    const { plan, evidence, crawl } = await verifiedSyntheticDetails({
      marketingContent: `<p><b>Location:</b> ${MAINLAND_LOCATION}</p>`
    });
    const wrongRawCount = structuredClone(evidence);
    wrongRawCount.fetchCounts.rawCount += 1;
    expect(validateStrictGrifolsChinaEvidence(plan, wrongRawCount, crawl.jobs)).toBe(false);
    const wrongExclusion = structuredClone(evidence);
    wrongExclusion.fetchLosses[0]!.details.recordIndex = 0;
    expect(validateStrictGrifolsChinaEvidence(plan, wrongExclusion, crawl.jobs)).toBe(false);
    const wrongPage = structuredClone(evidence);
    wrongPage.pages[0]!.declaredPages = 2;
    expect(validateStrictGrifolsChinaEvidence(plan, wrongPage, crawl.jobs)).toBe(false);
  });
});
