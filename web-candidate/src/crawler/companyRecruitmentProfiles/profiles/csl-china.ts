import type { CompanyRecruitmentProfileSeed } from "../types";
import { CSL_OFFICIAL_PORTAL_CONFIG, CSL_PORTAL_JSON_CONFIG } from "../../cslOfficialPortalSourceFetch";

export const profile_csl_china = {
  companyId: "company-csl-china",
  sources: [
    {
      sourceId: "source-csl-china-social",
      executionConfig: {
        adapterId: "official-json",
        json: CSL_PORTAL_JSON_CONFIG,
        profileBoundSource: {
          kind: "csl-official-portal",
          config: CSL_OFFICIAL_PORTAL_CONFIG
        }
      }
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
