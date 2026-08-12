import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_3sbio = {
  companyId: "company-3sbio",
  sources: [
    {
      sourceId: "source-3sbio-social",
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
              scopeExclusionProof: "THREESBIO_XIANYANG_HOMOGRAPH_V1"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
