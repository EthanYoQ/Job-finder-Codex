import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_dongyangguang = {
  companyId: "company-dongyangguang",
  sources: [
    {
      sourceId: "source-dongyangguang-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
              geographyScope: "DOMESTIC_OFFICIAL_TENANT",
              category: "1",
              pageSize: 100,
              maxPages: 5,
              detailPath: "Social/detail",
              scopeExclusionProof: "DONGYANGGUANG_EXPLICIT_FOREIGN_ONLY_V1"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
