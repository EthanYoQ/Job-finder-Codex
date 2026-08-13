import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_bayer_healthcare = {
  companyId: "company-bayer-healthcare",
  sources: [
    {
      sourceId: "source-bayer-healthcare-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "body:not(:has(label .attention.securitySearchString)) #searchresults tbody tr",
              completenessProof: {
                  kind: "OFFICIAL_TOTAL_PAGES",
                  sourcePolicy: "BAYER_CHINA_SUCCESSFACTORS_V1"
              },
              pagination: {
                  totalPagesSelector: "#searchresults[aria-label]",
                  totalPagesAttribute: "aria-label",
                  totalPagesPattern: "共\\s*([1-9]\\d*)\\s*页",
                  pageSearchParam: "startrow",
                  pageSearchParamMode: "offset",
                  pageSize: 10,
                  maxPages: 100,
                  expectedJobCountSelector: ".paginationLabel",
                  expectedJobCountPattern: "\\s*(\\d+)\\s*$",
                  explicitEmptyState: {
                      selector: "label:has(.attention.securitySearchString)",
                      pattern: "^当前没有符合\\s*[\"“]?China[\"”]?\\s*的空缺职位。?$"
                  }
              },
              fields: {
                  officialTitle: { selector: ".jobTitle.hidden-phone a.jobTitle-link" },
                  officialUrl: {
                      selector: ".jobTitle.hidden-phone a.jobTitle-link",
                      attribute: "href"
                  },
                  locationRaw: { selector: "td.colLocation" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
