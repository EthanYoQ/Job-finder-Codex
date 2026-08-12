import type { CompanyRecruitmentProfileSeed } from "../types";
import { MOKA_JSON_CONFIG } from "../shared";

export const profile_hengrui = {
  companyId: "company-hengrui",
  sources: [
    {
      sourceId: "source-hengrui-social",
      executionConfig: {
          adapterId: "official-json",
          json: MOKA_JSON_CONFIG,
          moka: {
              expectedOrgId: "hengrui",
              expectedSiteId: "145996",
              expectedMode: "social",
              campaignUrl: "https://app.mokahr.com/social-recruitment/hengrui/145996",
              hydrateMissingLocationsFromDetail: true
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
