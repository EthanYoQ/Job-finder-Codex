import type { CompanyRecruitmentProfileSeed } from "../types";
import { MOKA_JSON_CONFIG } from "../shared";

export const profile_gsk_china = {
  companyId: "company-gsk-china",
  sources: [{
    sourceId: "source-gsk-china-social",
    executionConfig: {
      adapterId: "official-json",
      // Native GSK publishedAt has no timezone. Keep the original date in raw evidence;
      // the normalized timestamp field requires a proven instant.
      json: MOKA_JSON_CONFIG,
      transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
      moka: {
        expectedOrgId: "gsk", expectedSiteId: "148067", expectedMode: "social",
        campaignUrl: "https://app.mokahr.com/social-recruitment/gsk/148067",
        hydrateMissingLocationsFromDetail: true,
        allowDetailSiteIdOmission: true,
        requisitionStatusPolicy: "GSK_NATIVE_OPEN_REQUISITIONS_V1"
      }
    }
  }]
} satisfies CompanyRecruitmentProfileSeed;
