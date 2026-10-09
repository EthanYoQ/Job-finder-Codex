import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_apeloa = {
  companyId: "company-apeloa",
  sources: [
    {
      sourceId: "source-apeloa-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".join2 .tab-content > .main:first-child > .ev",
              completenessProof: {
                  kind: "STATIC_PUBLIC_LIST",
                  sourcePolicy: "APELOA_SOCIAL_TABS_V1"
              },
              staticPublicList: {
                  containerSelector: ".join2 .tab-content > .main:first-child",
                  nextControlSelector: ".join2 .pagination, .join2 a[rel='next'], .join2 [data-page]",
                  excludedPartitionSelectors: [".join2 .tab-content > .main:nth-child(2)"]
              },
              fields: {
                  sourceJobIdParts: [
                      { selector: ".table99.name > div:nth-child(1) > p" },
                      { selector: ".table99.name > div:nth-child(4) > p" },
                      { selector: ".down .mailto:first-of-type p" }
                  ],
                  officialTitle: { selector: ".table99.name > div:nth-child(1) > p" },
                  officialUrl: { value: "https://www.apeloa.com/join.html" },
                  locationRaw: { selector: ".table99.name > div:nth-child(4) > p" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
