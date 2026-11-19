import type { CompanyRecruitmentProfileSeed } from "../types";
import { PFIZER_OFFICIAL_PORTAL_CONFIG, PFIZER_PORTAL_JSON_CONFIG } from "../../pfizerOfficialPortalSourceFetch";

export const profile_pfizer_china = {
  companyId: "company-pfizer-china",
  sources: [
    {
      sourceId: "source-pfizer-china-social",
      executionConfig: {
        adapterId: "official-json",
        json: PFIZER_PORTAL_JSON_CONFIG,
        profileBoundSource: {
          kind: "pfizer-official-portal",
          config: PFIZER_OFFICIAL_PORTAL_CONFIG
        },
        transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 }
      }
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
