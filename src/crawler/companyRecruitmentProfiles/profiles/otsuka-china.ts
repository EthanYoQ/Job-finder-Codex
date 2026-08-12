import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_otsuka_china = {
  companyId: "company-otsuka-china",
  sources: [
    {
      sourceId: "source-otsuka-china-social-2",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".join-list > .join-item",
              staticPublicList: {
                  containerSelector: ".join-list",
                  nextControlSelector: ".join-list .pagination, .join-list a[rel='next'], .join-list [data-page]"
              },
              fields: {
                  sourceJobIdParts: [
                      { selector: ".table-td .career-title" },
                      { selector: ".table-td .col2" }
                  ],
                  officialTitle: { selector: ".table-td .career-title" },
                  officialUrl: { value: "https://www.otsuka.com.cn/join-us/index.html" },
                  locationRaw: { selector: ".table-td .col2" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
