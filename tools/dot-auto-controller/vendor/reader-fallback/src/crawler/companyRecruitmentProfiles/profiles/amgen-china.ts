import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";
import { AMGEN_MANUAL_WORKDAY_CONFIG } from "../../amgenManualWorkdaySourceFetch";
export const profile_amgen_china = {
  companyId: "company-amgen-china",
  sources: [{ sourceId: "source-amgen-china-social", executionConfig: {
    adapterId: "official-json", json: WORKDAY_JSON_CONFIG,
    profileBoundSource: { kind: "amgen-manual-workday-lookup", config: AMGEN_MANUAL_WORKDAY_CONFIG }
  } }]
} satisfies CompanyRecruitmentProfileSeed;
