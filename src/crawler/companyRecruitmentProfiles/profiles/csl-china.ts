import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_csl_china = {
  companyId: "company-csl-china",
  sources: [
    {
      sourceId: "source-csl-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "a[href^='https://jobs.csl.com/en/jobs/']",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: "body",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "page",
                  pageSize: 25,
                  maxPages: 5,
                  expectedJobCountSelector: "body",
                  expectedJobCountPattern: "Showing\\s+\\d+\\s+to\\s+\\d+\\s+of\\s+(\\d+)\\s+results"
              },
              fields: {
                  sourceJobId: {
                      selector: ":scope",
                      attribute: "href"
                  },
                  officialTitle: { selector: "p.text-18" },
                  officialUrl: { selector: ":scope", attribute: "href" },
                  locationRaw: { selector: "p:has(svg[aria-hidden='true'])" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
