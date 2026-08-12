import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_teva_china = {
  companyId: "company-teva-china",
  sources: [
    {
      sourceId: "source-teva-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".position, .job-card, [data-testid='job-card']",
              strictEmbeddedJsonZero: { kind: "TEVA_SMARTAPPLY_CHINA" },
              fields: {
                  sourceJobId: { selector: "a", attribute: "href" },
                  officialTitle: { selector: "a" },
                  officialUrl: { selector: "a", attribute: "href" },
                  locationRaw: { value: "China" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
