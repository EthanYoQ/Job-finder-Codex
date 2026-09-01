import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_otsuka_china = {
  companyId: "company-otsuka-china",
  sources: [
    {
      sourceId: "source-otsuka-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: ".container.Box [data-job-id], .container.Box .job-item",
              completenessProof: {
                  kind: "STATIC_PUBLIC_LIST"
              },
              staticPublicList: {
                  containerSelector: ".container.Box",
                  nextControlSelector: ".container.Box .pagination, .container.Box a[rel='next'], .container.Box [data-page]",
                  explicitEmptyState: {
                      selector: ".container.Box",
                      pattern: "热招岗位[\\s\\S]*联系我们"
                  }
              },
              fields: {
                  sourceJobId: { selector: ":scope", attribute: "data-job-id" },
                  officialTitle: { selector: ":scope" },
                  officialUrl: { value: "https://www.chinaotsuka.com.cn/class/26" },
                  locationRaw: { value: "中国" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
