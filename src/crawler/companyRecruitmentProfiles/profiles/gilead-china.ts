import type { CompanyRecruitmentProfileSeed } from "../types";
import { GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES, WORKDAY_JSON_CONFIG } from "../shared";

export const profile_gilead_china = {
  companyId: "company-gilead-china",
  sources: [
    {
      sourceId: "source-gilead-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          workday: {
              tenant: "gilead",
              site: "gileadcareers",
              searchText: "China",
              locationFacetPolicy: {
                  kind: "GILEAD_AUDITED_LOCATIONS_OVERLAP",
                  facetParameter: "locations",
                  foreignDescriptorAliases: GILEAD_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
              },
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
