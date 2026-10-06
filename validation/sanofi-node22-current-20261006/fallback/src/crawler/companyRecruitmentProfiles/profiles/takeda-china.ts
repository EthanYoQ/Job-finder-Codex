import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_takeda_china = {
  companyId: "company-takeda-china",
  sources: [
    {
      sourceId: "source-takeda-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "#search-results-list li:has(button.js-save-job-btn)",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: "#search-results",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "page",
                  maxPages: 30,
                  expectedJobCountSelector: "#search-results",
                  expectedJobCountAttribute: "data-total-job-results",
                  ajaxMode: "talentbrew"
              },
              fields: {
                  sourceJobId: { selector: "button.js-save-job-btn", attribute: "data-job-id" },
                  officialTitle: { selector: "h2.title" },
                  officialUrl: { selector: "a[href*='/job/']", attribute: "href" },
                  locationRaw: { selector: ".location" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
