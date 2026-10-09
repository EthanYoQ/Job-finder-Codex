import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_yangzijiang = {
  companyId: "company-yangzijiang",
  sources: [
    {
      sourceId: "source-yangzijiang-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
              geographyScope: "DOMESTIC_OFFICIAL_TENANT",
              category: "1",
              pageSize: 100,
              maxPages: 5,
              detailPath: "social/detail",
              defaultLocationRaw: "未披露"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
