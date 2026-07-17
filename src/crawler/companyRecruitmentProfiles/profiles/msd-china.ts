import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";
import { MSD_DUAL_OFFICIAL_FETCH_CONFIG } from "../../msdDualOfficialSourceFetch";

export const profile_msd_china = {
  companyId: "company-msd-china",
  sources: [
    {
      sourceId: "source-msd-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          transientRetryPolicy: {
            maxRetries: 1,
            backoffMs: 10_000
          },
          profileBoundSource: {
            kind: "msd-dual-official",
            config: MSD_DUAL_OFFICIAL_FETCH_CONFIG
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
