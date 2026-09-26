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
          transientRetryPolicy: {
              maxRetries: 1,
              backoffMs: 10_000
          },
          officialJsonFetch: {
              kind: "phenom",
              detailBaseUrl: "https://careers.roche.com/cn/zh/job",
              allowedApplyOrigins: ["https://roche.wd3.myworkdayjobs.com"],
              mixedLocationScopePolicy: "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1",
              facetScope: {
                  countryIncludeDescriptor: "中国大陆",
                  categoryExcludeDescriptors: []
              },
              requestBoundOmittedOffsetPolicy: "ROCHE_REQUEST_BOUND_OMITTED_OFFSET_V1",
              exactDuplicateReconciliationPolicy: "ROCHE_IDENTICAL_CROSS_PAGE_V1",
              pageSize: 100,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
