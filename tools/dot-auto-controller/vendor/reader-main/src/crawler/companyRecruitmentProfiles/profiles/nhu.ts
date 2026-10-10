import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_nhu = {
  companyId: "company-nhu",
  sources: [
    {
      sourceId: "source-nhu-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
              geographyScope: "DOMESTIC_OFFICIAL_TENANT",
              mixedLocationPolicy: "INCLUDE_MAINLAND_JAPAN_ALTERNATIVES",
              category: "1",
              pageSize: 100,
              maxPages: 5,
              detailPath: "social/detail",
              scopeExclusionProof: "NHU_EXPLICIT_JAPAN_ONLY_V1"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
