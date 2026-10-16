import type { CompanyRecruitmentProfileSeed } from "../types";
import { MOKA_JSON_CONFIG } from "../shared";

export const profile_jimin_kexin = {
  companyId: "company-jimin-kexin",
  sources: [
    {
      sourceId: "source-jimin-kexin-social",
      executionConfig: {
          adapterId: "official-json",
          json: MOKA_JSON_CONFIG,
          moka: {
              expectedOrgId: "jemincare",
              expectedSiteId: "78315",
              expectedMode: "social",
              campaignUrl: "https://app.mokahr.com/social-recruitment/jemincare/78315",
              hydrateMissingLocationsFromDetail: true
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
