/** Invented offline responses, never downloaded source bytes or publication evidence.
 * Preserve the regression's 27 list rows, 20 active applications and seven closures.
 * Row 12 is closed so retry tests retain their exact partial-artifact boundaries.
 */
export const NOVO_SYNTHETIC_CLOCK = "2026-10-02T01:44:06.473Z";
export const NOVO_SYNTHETIC_ENDPOINT = "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn";
export const NOVO_SYNTHETIC_APPLICATION_TITLE = "Synthetic application title overrides both earlier titles";
export const NOVO_SYNTHETIC_BODY_SHA256 = "20f3854f475824a98713411bafa060a3848d76b6f35b94a60a520956106df107";
export const NOVO_SYNTHETIC_BODY_BYTES = 19825;

interface SyntheticResponse { body: string; finalUrl: string; contentType: string }
const entry = "https://www.novonordisk.com.cn/careers/find-a-job/career-search-results.html?searchText=&countries=China&categories=";
const detailBase = "https://www.novonordisk.com.cn/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad";
const pair = (value: string) => ({ label: value, value });

export function createNovoSyntheticFixture(): { body: string; captures: Record<string, SyntheticResponse> } {
  const locations = [
    ...Array.from({ length: 21 }, () => ["Beijing", "Beijing"] as const),
    ["Shanghai", "Shanghai"], ["Shanghai", "Shanghai"], ["Hangzhou", "Zhejiang"],
    ["Daqing", "Heilongjiang"], ["Songyuan", "Jilin"], ["Changchun", "Jilin"]
  ] as ReadonlyArray<readonly [string, string]>;
  const closed = new Set([0, 6, 7, 8, 9, 12, 23]);
  const jobs = locations.map(([city, state], index) => ({
    jobId: `${800100 + index}.en_GB`, jobTitle: `Synthetic list title ${index}`,
    jobLocale: "en_GB", jobLocationLabel: `China, ${city}`, jobCountry: pair("China"),
    jobCategory: pair("Synthetic category"), jobSubCategory: pair("Synthetic subcategory"),
    jobState: pair(state), jobCity: pair(city)
  }));
  const body = JSON.stringify({ data: {
    executionTimeMs: 1, totalMatches: jobs.length, keywordParam: "", localeParam: "zh-cn",
    countriesParam: ["China"], categoriesParam: [], subCategories: [pair("Synthetic subcategory")],
    states: [...new Set(locations.map(([, state]) => state))].map(pair),
    cities: [...new Set(locations.map(([city]) => city))].map(pair), jobs
  }, status: 200, message: "success" }, null, 2);
  const captures: Record<string, SyntheticResponse> = {
    [entry]: { body: '<section id="careersearchresults"><input ref="jobAdUrl" value="/content/nncorp/cn/zh_cn/careers/find-a-job/job-ad"></section>', finalUrl: entry, contentType: "text/html" }
  };
  jobs.forEach((job, index) => {
    const id = String(800100 + index), postingId = String(900000 + index);
    const detailUrl = `${detailBase}.${job.jobId}.html`;
    const applicationUrl = `https://career2.successfactors.eu/career?career_job_req_id=${id}&company=novonordisk&career_ns=job_listing&navBarLevel=JOB_SEARCH&rcm_site_locale=en_GB&selected_lang=en_GB`;
    const finalUrl = `https://careers.novonordisk.com/job/synthetic-role-${index}/${postingId}/`;
    const description = `Invented offline role ${index}. Work on synthetic laboratory planning, sample review and quality documentation. This text exists only to exercise the complete native detail body contract. It describes no actual vacancy, candidate, employee or retained official response.`;
    captures[detailUrl] = { finalUrl: detailUrl, contentType: "text/html",
      body: `<main id="careerjobdisplay"><h1>Synthetic native detail title ${index}</h1><p>${description}</p><a href="${applicationUrl}">Apply</a></main>` };
    const title = index === 1 ? NOVO_SYNTHETIC_APPLICATION_TITLE : `Synthetic active application ${index}`;
    captures[applicationUrl] = { finalUrl, contentType: "text/html", body: closed.has(index)
      ? '<div class="jobDisplay"><div class="job">Thank you for your interest unfortunately, we are no longer accepting applicants to this position.</div></div>'
      : `<div class="jobDisplay"><div class="job"><h1 data-careersite-propertyid="title">${title}</h1><div class="jobGeoLocation">${job.jobCity.value}, CN</div><p>${description}</p></div><a class="apply" href="/talentcommunity/apply/${postingId}/?locale=en_GB">Apply now</a></div>` };
  });
  return { body, captures };
}
