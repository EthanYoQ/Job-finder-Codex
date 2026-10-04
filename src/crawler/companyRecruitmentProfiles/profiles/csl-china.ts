import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";

export const profile_csl_china = {
  companyId: "company-csl-china",
  sources: [
    {
      sourceId: "source-csl-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          workday: {
              mainlandQualityPolicy: "CSL_MAINLAND_DETAIL_V1",
              tenant: "csl",
              site: "CSL_External",
              appliedFacets: {
                  locationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"]
              },
              pageSize: 20,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
