import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_qilu = {
  companyId: "company-qilu",
  sources: [
    {
      sourceId: "source-qilu-social",
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
              scopeExclusionProof: "QILU_EXPLICIT_US_OR_HONG_KONG_ONLY_V2"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
