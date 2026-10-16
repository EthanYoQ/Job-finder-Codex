import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_organon_china = {
  companyId: "company-organon-china",
  sources: [
    {
      sourceId: "source-organon-china-social",
      executionConfig: {
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          adapterId: "official-json",
          json: {
              ...OFFICIAL_API_JSON_CONFIG,
              fields: { ...OFFICIAL_API_JSON_CONFIG.fields, officialPublishedAt: "officialPublishedAt" }
          },
          officialJsonFetch: {
              kind: "phenom",
              postedDatePolicy: "ORGANON_PHENOM_POSTED_DATE_V1",
              cityScopePolicy: "ORGANON_MAINLAND_LOCATION_PENDING_V1",
              publicVisibilityPolicy: "ORGANON_PUBLIC_VISIBILITY_V1",
              requestBoundOmittedOffsetPolicy: "ORGANON_REQUEST_BOUND_OMITTED_OFFSET_V1",
              detailBaseUrl: "https://jobs.organon.com/cn/zh/job",
              countryFilter: "China",
              allowedApplyOrigins: ["https://organon.wd5.myworkdayjobs.com"],
              pageSize: 50,
              maxPages: 5
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
