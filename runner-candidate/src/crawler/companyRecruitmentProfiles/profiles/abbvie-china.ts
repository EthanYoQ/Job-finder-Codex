import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_abbvie_china = {
  companyId: "company-abbvie-china",
  sources: [
    {
      sourceId: "source-abbvie-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              abbvieRowScopePolicy: "ABBVIE_CHINA_LISTED_ROWS_V1",
              rowSelector: ".attrax-vacancy-tile",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: ".attrax-pagination__results-of--2",
                  totalPagesAttribute: "data-total-pages",
                  totalPagesPattern: "(\\d+)",
                  pageSearchParam: "page",
                  // Retained in the historical plan binding; the owned fetcher follows the official total.
                  maxPages: 10,
                  expectedJobCountSelector: ".attrax-pagination__total-results",
                  expectedJobCountPattern: "(\\d+)"
              },
              fields: {
                  sourceJobId: {
                      selector: ".attrax-vacancy-tile__title",
                      attribute: "href",
                      pattern: "jid-(\\d+)"
                  },
                  officialTitle: { selector: ".attrax-vacancy-tile__title" },
                  officialUrl: {
                      selector: ".attrax-vacancy-tile__title",
                      attribute: "href"
                  },
                  locationRaw: {
                      selector: ".attrax-vacancy-tile__location-freetext .attrax-vacancy-tile__item-value"
                  }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
