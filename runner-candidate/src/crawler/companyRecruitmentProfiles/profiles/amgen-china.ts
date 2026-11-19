import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";
import { AMGEN_RADANCY_CONFIG } from "../../amgenRadancySourceFetch";

export const profile_amgen_china = {
  companyId: "company-amgen-china",
  sources: [{
    sourceId: "source-amgen-china-social",
    executionConfig: {
      adapterId: "official-json",
      json: WORKDAY_JSON_CONFIG,
      profileBoundSource: { kind: "amgen-radancy-china", config: AMGEN_RADANCY_CONFIG }
    }
  }]
} satisfies CompanyRecruitmentProfileSeed;
