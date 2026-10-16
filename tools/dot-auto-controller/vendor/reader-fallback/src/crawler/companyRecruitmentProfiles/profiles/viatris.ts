import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_viatris = {
  companyId: "company-viatris",
  sources: [
    {
      sourceId: "source-viatris-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".position-list-body .position-item",
              completenessProof: { kind: "CONFIGURED_CHANNEL_TRAVERSAL" },
              pagination: {
                  totalPagesSelector: "#pageTurnUl li:first-child",
                  totalPagesAttribute: "data-total-pages",
                  pageSearchParam: "offset",
                  pageSearchParamMode: "offset",
                  pageSize: 10,
                  maxPages: 60,
                  ajaxMode: "tupu360"
              },
              fields: {
                  sourceJobId: {
                      selector: ".e-title a",
                      attribute: "href",
                      pattern: "positionId=([^&]+)"
                  },
                  officialTitle: { selector: ".e-title a" },
                  officialUrl: { selector: ".e-title a", attribute: "href" },
                  locationRaw: { selector: ".e-city" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
