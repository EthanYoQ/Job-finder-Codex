import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_organon_china = {
  companyId: "company-organon-china",
  sources: [
    {
      sourceId: "source-organon-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "phenom",
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
