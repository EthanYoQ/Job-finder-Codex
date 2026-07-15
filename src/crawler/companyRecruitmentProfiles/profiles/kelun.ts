import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_kelun = {
  companyId: "company-kelun",
  sources: [
    {
      sourceId: "source-kelun-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".jobsTable tr:not(.title)",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: "a[href*='PageIndex=']:not([href*='PageIndex=0'])",
                  totalPagesAttribute: "href",
                  totalPagesPattern: "PageIndex=(\\d+)(?:&|$)",
                  totalPagesMode: "max",
                  pageSearchParam: "PageIndex",
                  maxPages: 20
              },
              fields: {
                  officialTitle: { selector: "td:nth-child(1) a" },
                  officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
                  locationRaw: { selector: "td:nth-child(5)" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
