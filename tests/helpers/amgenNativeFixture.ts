import { createHash } from "node:crypto";
export const AMGEN_ENTRY = "https://careers.amgen.com/en/search-jobs/China/87/2/1814991/35/105/50/2";
export const AMGEN_ENDPOINT = "https://careers.amgen.com/en/search-jobs/resultspost";
export const AMGEN_TIME = "2026-10-02T12:00:00.000Z";
export function amgenFixture(total = 13) {
  const rows = Array.from({ length: total }, (_, index) => {
    const id = String(100000000 + index), req = `R-${20000 + index}`;
    const title = `Representative Shanghai ${index}`;
    const url = `https://careers.amgen.com/en/job/shanghai/representative/87/${id}`;
    const path = `/job/China---Shanghai/Representative_${req}${index === 0 ? "-1" : ""}`;
    const externalUrl = `https://amgen.wd1.myworkdayjobs.com/Careers${path}`;
    const apiUrl = `https://amgen.wd1.myworkdayjobs.com/wday/cxs/amgen/Careers${path}`;
    const schema = { "@type": "JobPosting", title, url, identifier: req, description: "<p>Current official job description</p>", datePosted: "2026-9-25", hiringOrganization: { name: "Amgen" }, jobLocation: [{ address: { addressCountry: "China", addressRegion: "Shanghai", addressLocality: "Shanghai" } }] };
    const detail = `<link rel="canonical" href="${url}"><h1>${title}</h1><script type="application/ld+json">${JSON.stringify(schema)}</script><a class="job-apply" data-job-id="${id}" data-job-organization-id="87" data-apply-url="${externalUrl}/apply" href="${externalUrl}/apply">Apply</a>`;
    const info = { id: "a".repeat(32), title, jobDescription: schema.description, location: "China - Shanghai", jobReqId: req, jobPostingId: path.split("/").at(-1), jobPostingSiteId: "Careers", country: { descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4" }, jobRequisitionLocation: { descriptor: "China - Shanghai", country: { descriptor: "China", id: "6cb77610a8a543aea2d6bc10457e35d4", alpha2Code: "CN" } }, posted: true, canApply: true, externalUrl };
    return { id, req, title, url, path, externalUrl, apiUrl, detail, info, sourceJobId: `workday:sha256:${createHash("sha256").update(path).digest("hex")}` };
  });
  const page = (n: number) => `<section id="search-results" data-location="China" data-keywords="" data-location-type="2" data-location-path="1814991" data-organization-ids="87" data-latitude="35" data-longitude="105" data-distance="50" data-show-radius="False" data-total-job-results="${total}" data-total-pages="${Math.max(1, Math.ceil(total / 12))}" data-current-page="${n}" data-records-per-page="12" data-ajax-post-url="/en/search-jobs/resultspost" data-search-results-module-name="Search Results v2 - Module" data-active-facet-id="0" data-facet-type="0" data-facet-term="" data-sort-criteria="0" data-sort-direction="0" data-search-type="1" data-refined-keywords="[]" data-total-content-results="0"><ul id="search-results-jobs">${rows.slice((n - 1) * 12, n * 12).map(r => `<li><a href="${r.url}" data-job-id="${r.id}"><h3>${r.title}</h3><span class="job-location">China - Shanghai</span></a><button class="js-save-job-btn" data-job-id="${r.id}" data-org-id="87"></button></li>`).join("")}</ul><div class="pagination"><a class="next${n < Math.ceil(total / 12) ? "" : " disabled"}" data-display-type="Jobs">Next</a></div></section>`;
  const entry = page(1) + '<section id="search-filters" data-search-filters-module-name="Search Filters v2 - Module" data-radius-unit-type="0" data-filtered-categories="" data-filtered-locations="" data-filtered-custom-facet="" data-filtered-advanced-categories="" data-filtered-advanced-locations="" data-filtered-advanced-custom-facet=""></section>';
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  async function http(request: { url: string; method: string; body?: string }) {
    requests.push(request);
    let body: string;
    if (request.url === AMGEN_ENTRY && request.method === "GET") body = entry;
    else if (request.url === AMGEN_ENDPOINT && request.method === "POST") body = JSON.stringify({ hasJobs: total > 0, results: page(JSON.parse(request.body!).CurrentPage) });
    else { const row = rows.find(r => r.url === request.url || r.apiUrl === request.url); if (!row) throw Error(`Unexpected fixture request ${request.url}`); body = row.url === request.url ? row.detail : JSON.stringify({ userAuthenticated: false, jobPostingInfo: row.info }); }
    return { status: 200, finalUrl: request.url, contentType: body.startsWith("{") ? "application/json" : "text/html", capturedAt: AMGEN_TIME, body };
  }
  return { rows, entry, page, http, requests };
}
