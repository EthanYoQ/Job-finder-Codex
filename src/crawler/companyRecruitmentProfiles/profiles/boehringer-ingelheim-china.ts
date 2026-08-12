import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_boehringer_ingelheim_china = {
  companyId: "company-boehringer-ingelheim-china",
  sources: [
    {
      sourceId: "source-boehringer-ingelheim-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "#job-tile-list li.job-tile",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: "#tile-search-results-label",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "startrow",
                  pageSearchParamMode: "offset",
                  pageSize: 25,
                  maxPages: 10,
                  expectedJobCountSelector: "#tile-search-results-label",
                  expectedJobCountPattern: "of\\s+(\\d+)\\s+Jobs"
              },
              fields: {
                  officialTitle: { selector: ".jobTitle-link" },
                  officialUrl: { selector: ".jobTitle-link", attribute: "href" },
                  locationRaw: { selector: '.section-field.location div[id$="-value"]' }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
