import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_grand_pharma = {
  companyId: "company-grand-pharma",
  sources: [
    {
      sourceId: "source-grand-pharma-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".job-card:has(a[href='#login'])",
              staticPublicList: {
                  containerSelector: ".job-list",
                  nextControlSelector: ".job-list .pagination, .job-list a[rel='next'], .job-list [data-page]",
                  excludedPartitionSelectors: [".job-card:has(a[href='schooldetail.html'])"]
              },
              fields: {
                  sourceJobIdParts: [
                      { selector: ".job-title" },
                      { selector: ".job-meta span:nth-child(1)" }
                  ],
                  officialTitle: { selector: ".job-title" },
                  officialUrl: { value: "https://job.grandpharma.cn/" },
                  locationRaw: { selector: ".job-meta span:nth-child(1)" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
