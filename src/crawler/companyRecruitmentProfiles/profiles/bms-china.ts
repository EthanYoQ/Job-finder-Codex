import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_bms_china = {
  companyId: "company-bms-china",
  sources: [
    {
      sourceId: "source-bms-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          officialJsonFetch: {
              kind: "eightfold-pcsx",
              domain: "bms.com",
              location: "china",
              detailBaseUrl: "https://jobs.bms.com/careers/job",
              pageSize: 10,
              maxPages: 5
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
