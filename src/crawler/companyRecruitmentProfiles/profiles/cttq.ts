import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_cttq = {
  companyId: "company-cttq",
  sources: [
    {
      sourceId: "source-cttq-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
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
