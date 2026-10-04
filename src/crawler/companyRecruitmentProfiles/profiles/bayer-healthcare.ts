import type { CompanyRecruitmentProfileSeed } from "../types";
import { MOKA_RECENT_JSON_CONFIG } from "../shared";

export const profile_bayer_healthcare = {
  companyId: "company-bayer-healthcare",
  sources: [{
    sourceId: "source-bayer-healthcare-social",
    executionConfig: {
      adapterId: "official-json",
      json: MOKA_RECENT_JSON_CONFIG,
      moka: {
        expectedOrgId: "bayer",
        expectedSiteId: "148387",
        expectedMode: "social",
        campaignUrl: "https://app.mokahr.com/social-recruitment/bayer/148387",
        hydrateMissingLocationsFromDetail: true,
        allowDetailSiteIdOmission: true,
        scopeExclusionProof: "BAYER_MEDICAL_OPEN_REQUISITIONS_V1"
      }
    }
  }]
} satisfies CompanyRecruitmentProfileSeed;
