import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_fosun_pharma = {
  companyId: "company-fosun-pharma",
  sources: [
    {
      sourceId: "source-fosun-pharma-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "table tr:has(td:nth-child(1) a[href*='/socialxq?jobId='])",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: ".page a[href*='/social/?PageIndex=']",
                  totalPagesAttribute: "href",
                  totalPagesPattern: "PageIndex=([1-9]\\d*)(?:&|$)",
                  totalPagesMode: "max",
                  totalPagesDeclaredOnEntryOnly: true,
                  pageSearchParam: "PageIndex",
                  maxPages: 20
              },
              fields: {
                  officialTitle: { selector: "td:nth-child(1) a" },
                  officialUrl: { selector: "td:nth-child(1) a", attribute: "href" },
                  locationRaw: { selector: "td:nth-child(4) a" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
