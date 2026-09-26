import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";

export const profile_pfizer_china = {
  companyId: "company-pfizer-china",
  sources: [
    {
      sourceId: "source-pfizer-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          workday: {
              tenant: "pfizer",
              site: "PfizerCareers",
              laterZeroTotalPolicy: "PFIZER_AUDITED_EXACT_RECONCILIATION",
              appliedFacets: {
                  Location_Country: ["6cb77610a8a543aea2d6bc10457e35d4"]
              },
              pageSize: 20,
              maxPages: 20
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
