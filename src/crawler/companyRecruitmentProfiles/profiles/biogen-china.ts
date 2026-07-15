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
              searchText: "China",
              facetDescriptorBoundary: {
                  facetParameter: "workerSubType",
                  allowedDescriptors: ["Regular"]
              },
              pageSize: 20,
              maxPages: 3
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
