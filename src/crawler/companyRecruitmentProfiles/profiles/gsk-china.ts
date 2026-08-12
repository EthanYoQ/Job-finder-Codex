import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_gsk_china = {
  companyId: "company-gsk-china",
  sources: [
    {
      sourceId: "source-gsk-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "phenom",
              detailBaseUrl: "https://jobs.gsk.com/gb/en/job",
              derivedDetailIdField: "jobSeqNo",
              mixedLocationScopePolicy: "EXACTLY_ONE_MAINLAND_ALTERNATIVE_V1",
              countryFilter: "China",
              allowedApplyOrigins: ["https://gsk.wd5.myworkdayjobs.com"],
              allowedEntryRedirect: {
                  origin: "https://jobs.gsk.com",
                  pathname: "/gb/en"
              },
              pageSize: 50,
              maxPages: 3
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
