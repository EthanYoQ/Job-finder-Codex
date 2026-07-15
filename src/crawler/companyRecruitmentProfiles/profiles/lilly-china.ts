import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_lilly_china = {
  companyId: "company-lilly-china",
  sources: [
    {
      sourceId: "source-lilly-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "phenom",
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
