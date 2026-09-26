import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_huahai = {
  companyId: "company-huahai",
  sources: [
    {
      sourceId: "source-huahai-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "tr.tr_title",
              completenessProof: {
                  kind: "STATIC_PUBLIC_LIST",
                  sourcePolicy: "HUAHAI_SOCIAL_TABLE_V1"
              },
              staticPublicList: {
                  containerSelector: "table:has(tr.tr_title)",
                  nextControlSelector: "table:has(tr.tr_title) .pagination, table:has(tr.tr_title) a[rel='next'], table:has(tr.tr_title) [data-page]"
              },
              fields: {
                  sourceJobIdParts: [
                      { selector: "td:nth-child(1)" },
                      { selector: "td:nth-child(2)" },
                      { selector: "td:nth-child(5)" }
                  ],
                  officialTitle: { selector: "td:nth-child(1)" },
                  officialUrl: { value: "https://www.huahaipharm.com/zpgw.html" },
                  locationRaw: { selector: "td:nth-child(2)" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
