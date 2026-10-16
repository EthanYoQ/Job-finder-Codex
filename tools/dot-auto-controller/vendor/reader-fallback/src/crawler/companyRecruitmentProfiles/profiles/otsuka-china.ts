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
                  kind: "STATIC_PUBLIC_LIST",
                  // Retired zero-only policy; historical manual zero is not
                  // current completeness evidence for this pharmaceutical source.
                  sourcePolicy: "OTSUKA_CHINA_EMPTY_PUBLIC_LIST_V1"
              },
              staticPublicList: {
                  containerSelector: ".container.Box",
                  // Generic HR prose and contact information do not prove zero jobs.
                  nextControlSelector: ".container.Box .pagination, .container.Box a[rel='next'], .container.Box [data-page]"
              },
              fields: {
                  sourceJobId: { selector: ":scope", attribute: "data-job-id" },
                  officialTitle: { selector: ":scope" },
                  officialUrl: { value: "https://chinaotsuka.com.cn/class/26" },
                  locationRaw: { value: "中国" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
