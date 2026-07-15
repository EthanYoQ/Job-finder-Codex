import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_roche_china = {
  companyId: "company-roche-china",
  sources: [
    {
      sourceId: "source-roche-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "phenom",
              detailBaseUrl: "https://careers.roche.com/cn/zh/job",
              allowedApplyOrigins: ["https://roche.wd3.myworkdayjobs.com"],
              facetScope: {
                  countryIncludeDescriptor: "中国大陆",
                  categoryExcludeDescriptors: ["实习 & 发展项目"]
              },
              requestBoundOmittedOffsetPolicy: "ROCHE_REQUEST_BOUND_OMITTED_OFFSET_V1",
              pageSize: 100,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
