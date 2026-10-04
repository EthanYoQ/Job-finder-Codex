import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_lilly_china = {
  companyId: "company-lilly-china",
  sources: [
    {
      sourceId: "source-lilly-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: { ...OFFICIAL_API_JSON_CONFIG, fields: { ...OFFICIAL_API_JSON_CONFIG.fields, officialPublishedAt: "officialPublishedAt" } },
          officialJsonFetch: {
              kind: "phenom",
              postedDatePolicy: "LILLY_CHINA_PHENOM_POSTED_DATE_V1",
              cityScopePolicy: "LILLY_CHINA_REVIEWED_LOCATION_PENDING_V1",
              publicVisibilityPolicy: "LILLY_CHINA_PUBLIC_VISIBILITY_V1",
              detailBaseUrl: "https://careers.lilly.com/us/en/job",
              countryFilter: "China",
              allowedApplyOrigins: ["https://lilly.wd115.myworkdayjobs.com"],
              pageSize: 50,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
