import type { CompanyRecruitmentProfileSeed } from "../types";
import { MOKA_JSON_CONFIG } from "../shared";

export const profile_servier_china = {
  companyId: "company-servier-china",
  sources: [
    {
      sourceId: "source-servier-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: MOKA_JSON_CONFIG,
          moka: {
              expectedOrgId: "shiweiya",
              expectedSiteId: "47734",
              expectedMode: "social",
              campaignUrl: "https://app.mokahr.com/social-recruitment/shiweiya/47734",
              allowedEntryRedirect: {
                  origin: "https://app.mokahr.com",
                  pathname: "/social-recruitment/shiweiya/47734"
              },
              hydrateMissingLocationsFromDetail: true,
              allowDetailSiteIdOmission: true
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
