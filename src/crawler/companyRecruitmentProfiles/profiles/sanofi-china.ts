import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_sanofi_china = {
  companyId: "company-sanofi-china",
  sources: [
    {
      sourceId: "source-sanofi-china-social",
      executionConfig: {
          adapterId: "html-table",
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          table: {
              rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: "#search-results",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "page",
                  pageUrlTemplate: "https://jobs.sanofi.com/en/location/china-jobs/2649/1814991/2/{page}",
                  maxPages: 25,
                  expectedJobCountSelector: "#search-results",
                  expectedJobCountAttribute: "data-total-job-results",
                  ajaxMode: "talentbrew"
              },
              fields: {
                  sourceJobId: { selector: "button.js-save-job-btn", attribute: "data-job-id" },
                  officialTitle: { selector: "h2" },
                  officialUrl: { selector: "a[href*='/job/']", attribute: "href" },
                  locationRaw: { selector: "span.job-location" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
