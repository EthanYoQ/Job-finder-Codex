import { ASTRAZENECA_DETAIL_CONFIG } from "../../astraZenecaDetailContract";
import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_astrazeneca = {
  companyId: "company-astrazeneca",
  sources: [
    {
      sourceId: "source-astrazeneca-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              astraZenecaDetails: ASTRAZENECA_DETAIL_CONFIG,
              rowSelector: "#search-results-list li",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: "#search-results",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "p",
                  requestFirstPageExplicitly: true,
                  maxPages: 25,
                  expectedJobCountSelector: "#search-results",
                  expectedJobCountAttribute: "data-total-job-results"
              },
              fields: {
                  sourceJobId: { selector: "a.search-results-link", attribute: "data-job-id" },
                  officialTitle: { selector: "a.search-results-link h2" },
                  officialUrl: { selector: "a.search-results-link", attribute: "href" },
                  locationRaw: { selector: "span.job-location" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
