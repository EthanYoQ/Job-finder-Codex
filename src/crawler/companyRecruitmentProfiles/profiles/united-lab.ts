import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_united_lab = {
  companyId: "company-united-lab",
  sources: [
    {
      sourceId: "source-united-lab-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
              changedWithinDays: 183,
              geographyScope: "DOMESTIC_OFFICIAL_TENANT",
              category: "1",
              pageSize: 100,
              maxPages: 5,
              detailPath: "social/detail"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
