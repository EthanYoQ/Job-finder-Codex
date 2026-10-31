// Explicit synthetic source pages. These are not recovered or live web bytes.
import { NOVO_CHINA_ENDPOINT } from "../src/crawler/novoChinaQuality";
export const ENTRY = "https://www.novonordisk.com.cn/careers/find-a-job/career-search-results.html?searchText=&countries=China&categories=";
const id = (n: number) => `34600${n}.en_GB`;
export const detail = (n: number) => `https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad.${id(n)}.html`;
export const apply = (n: number) => `https://career2.successfactors.eu/career?company=novonordisk&career_job_req_id=34600${n}&career_ns=job_listing&navBarLevel=JOB_SEARCH&rcm_site_locale=en_GB&selected_lang=en_GB`;
export const final = (n: number) => `https://careers.novonordisk.com/job/Synthetic-Test/34600${n}/`;
const pair = (value: string) => ({ label: value, value });
export const listing = JSON.stringify({ data: { executionTimeMs: 1, totalMatches: 3, keywordParam: "", localeParam: "zh-cn", countriesParam: ["China"], categoriesParam: [],
  subCategories: [pair("Synthetic")], states: [pair("Beijing")], cities: [pair("Beijing")], jobs: [1, 2, 3].map(n => ({
    jobId: id(n), jobTitle: `Synthetic role ${n}`, jobLocale: "en_GB", jobLocationLabel: "China, Beijing", jobCountry: pair("China"),
    jobCategory: pair("Synthetic"), jobSubCategory: pair("Synthetic"), jobState: pair("Beijing"), jobCity: pair("Beijing") })) }, status: 200, message: "success" });
export const pages = new Map<string, { body: string; finalUrl: string; contentType: string }>([
  [NOVO_CHINA_ENDPOINT, { body: listing, finalUrl: NOVO_CHINA_ENDPOINT, contentType: "application/json" }],
  [ENTRY, { body: '<div id="careersearchresults"><input ref="jobAdUrl" value="/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad"></div>', finalUrl: ENTRY, contentType: "text/html" }],
  ...[1, 2, 3].flatMap(n => [
    [detail(n), { body: `<div id="careerjobdisplay"><h1>Synthetic role ${n}</h1><div class="job-display-details right-column"><p>Develop synthetic laboratory procedures and maintain documented quality controls for research teams.</p></div><a href="${apply(n).replaceAll("&", "&amp;")}">Apply</a></div>`, finalUrl: detail(n), contentType: "text/html" }],
    [apply(n), { body: n === 3 ? '<div class="jobDisplay"><div class="job">Thank you for your interest unfortunately, we are no longer accepting applicants to this position.</div></div>' :
      `<div class="jobDisplay"><div class="job"><h1 data-careersite-propertyid="title">Synthetic role ${n}</h1><span class="jobGeoLocation">Beijing, CN</span></div><a class="apply" href="/talentcommunity/apply/34600${n}/?locale=en_GB">Apply now</a></div>`, finalUrl: final(n), contentType: "text/html" }]
  ] as Array<[string, { body: string; finalUrl: string; contentType: string }]> )
]);
