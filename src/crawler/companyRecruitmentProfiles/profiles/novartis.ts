import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_novartis = {
  companyId: "company-novartis",
  sources: [
    {
      sourceId: "source-novartis-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "table.views-table tbody tr",
              strictLocationScope: {
                  allowUnknownEnglishLocalityWithParenthesizedMainlandProvince: true
              },
              completenessProof: {
                  kind: "OFFICIAL_TOTAL_PAGES",
                  sourcePolicy: "NOVARTIS_CHINA_SLIDING_WINDOW_V1"
              },
              pagination: {
                  totalPagesSelector: ".pagination .page-link[title*='out of'][title*='pages']",
                  totalPagesAttribute: "title",
                  totalPagesPattern: "out of\\s+([1-9]\\d*)\\s+pages",
                  totalPagesMode: "max",
                  pageSearchParam: "page",
                  pageNumberOffset: -1,
                  maxPages: 20,
                  totalPagesDeclaredOnEntryOnly: true,
                  officialWindowMode: "NOVARTIS_PAGE_WINDOW_V1"
              },
              fields: {
                  officialTitle: { selector: "td.views-field-field-job-title a" },
                  officialUrl: {
                      selector: "td.views-field-field-job-title a",
                      attribute: "href"
                  },
                  locationRaw: { selector: "td.views-field-field-job-work-location" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
