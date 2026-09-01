import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";

export const profile_amgen_china = {
  companyId: "company-amgen-china",
  sources: [
    {
      sourceId: "source-amgen-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          workday: {
              tenant: "amgen",
              site: "Careers",
              laterZeroTotalPolicy: "AMGEN_AUDITED_EXACT_RECONCILIATION",
              appliedFacets: {
                  LocationCountry: ["6cb77610a8a543aea2d6bc10457e35d4"]
              },
              pageSize: 20,
              maxPages: 3
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
