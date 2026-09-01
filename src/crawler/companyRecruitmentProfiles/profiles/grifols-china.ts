import type { CompanyRecruitmentProfileSeed } from "../types";
import { GRIFOLS_CHINA_FETCH_CONFIG } from "../../grifolsChinaSourceFetch";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";
export const profile_grifols_china = {
  companyId: "company-grifols-china",
  sources: [
    {
      sourceId: "source-grifols-china-social",
      executionConfig: {
          adapterId: "official-json",
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          json: OFFICIAL_API_JSON_CONFIG,
          profileBoundSource: {
              kind: "grifols-china-detail-scope",
              config: GRIFOLS_CHINA_FETCH_CONFIG
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
