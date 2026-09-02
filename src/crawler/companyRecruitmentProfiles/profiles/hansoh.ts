import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";
import { RECENT_JOB_WINDOW_DAYS } from "../../../domain/jobRecencyPolicy";

export const profile_hansoh = {
  companyId: "company-hansoh",
  sources: [
    {
      sourceId: "source-hansoh-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
              changedWithinDays: RECENT_JOB_WINDOW_DAYS,
              geographyScope: "DOMESTIC_OFFICIAL_TENANT",
              category: "1",
              pageSize: 100,
              maxPages: 10,
              detailPath: "social/detail"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
