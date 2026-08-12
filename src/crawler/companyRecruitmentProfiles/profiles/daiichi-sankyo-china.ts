import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_daiichi_sankyo_china = {
  companyId: "company-daiichi-sankyo-china",
  sources: [
    {
      sourceId: "source-daiichi-sankyo-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "cnstaff",
              pageSize: 15,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
