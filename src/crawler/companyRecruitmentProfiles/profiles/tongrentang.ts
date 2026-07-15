import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_tongrentang = {
  companyId: "company-tongrentang",
  sources: [
    {
      sourceId: "source-tongrentang-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "a[href*='/menu54/newsDetail/']:contains('招聘')",
              completenessProof: { kind: "OFFICIAL_TOTAL_PAGES" },
              pagination: {
                  totalPagesSelector: "body",
                  totalPagesAttribute: "data-total-pages",
                  totalPagesPattern: "共\\s*(\\d+)\\s*页",
                  pageSearchParam: "page",
                  pageUrlTemplate: "https://www.tongrentang.com/newsList/54/{page}.html",
                  maxPages: 10
              },
              fields: {
                  sourceJobId: {
                      selector: ":scope",
                      attribute: "href",
                      pattern: "newsDetail/([^./]+)"
                  },
                  officialTitle: { selector: ":scope" },
                  officialUrl: { selector: ":scope", attribute: "href" },
                  locationRaw: { value: "未披露" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
