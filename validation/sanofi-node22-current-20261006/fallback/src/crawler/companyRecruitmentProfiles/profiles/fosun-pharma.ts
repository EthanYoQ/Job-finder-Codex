import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_fosun_pharma = {
  companyId: "company-fosun-pharma",
  sources: [
    {
      sourceId: "source-fosun-pharma-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
              geographyScope: "DOMESTIC_OFFICIAL_TENANT",
              scopeExclusionProof: "FOSUN_EXPLICIT_HONG_KONG_ONLY_V1",
              category: "1",
              pageSize: 100,
              maxPages: 5,
              detailPath: "social/detail"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
