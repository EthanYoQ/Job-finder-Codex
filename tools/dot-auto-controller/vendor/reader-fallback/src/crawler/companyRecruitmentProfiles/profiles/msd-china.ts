import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";
import { MSD_AJINGA_CONFIG } from "../../msdAjingaSourceFetch";

export const profile_msd_china = {
  companyId: "company-msd-china",
  sources: [
    {
      sourceId: "source-msd-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          transientRetryPolicy: {
            maxRetries: 1,
            backoffMs: 10_000
          },
          profileBoundSource: {
            kind: "msd-ajinga",
            config: MSD_AJINGA_CONFIG
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
