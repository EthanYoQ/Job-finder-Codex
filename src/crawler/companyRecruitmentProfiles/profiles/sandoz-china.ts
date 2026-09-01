import type { CompanyRecruitmentProfileSeed } from "../types";

export const profile_sandoz_china = {
  companyId: "company-sandoz-china",
  sources: [
    {
      sourceId: "source-sandoz-china-social",
      executionConfig: {
          adapterId: "html-table",
          table: {
              rowSelector: "main a[href*='/jobs/'], .elementor-location-single a[href*='/jobs/']",
              completenessProof: {
                  kind: "STATIC_PUBLIC_LIST",
                  sourcePolicy: "ASPEN_CHINA_EMPTY_PUBLIC_LIST_V1"
              },
              staticPublicList: {
              containerSelector: ".elementor.elementor-1709",
                  nextControlSelector: "a[rel='next'], .pagination a.next",
                  explicitEmptyState: {
                  selector: ".elementor.elementor-1709",
                  pattern: "招聘|职位|岗位|警惕"
              }
              },
              fields: {
                  sourceJobId: { selector: ":scope", attribute: "href" },
                  officialTitle: { selector: ":scope" },
                  officialUrl: { selector: ":scope", attribute: "href" },
                  locationRaw: { value: "中国" }
              }
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
