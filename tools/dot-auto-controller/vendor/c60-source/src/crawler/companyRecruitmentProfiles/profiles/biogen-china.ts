import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";

export const profile_biogen_china = {
  companyId: "company-biogen-china",
  sources: [
    {
      sourceId: "source-biogen-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          workday: {
              tenant: "biibhr",
              site: "external",
              appliedFacets: {
                  locationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"]
              },
              pageSize: 20,
              maxPages: 3,
              listGeographyPolicy: "BIOGEN_MAINLAND_CITY_PENDING_V1"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
