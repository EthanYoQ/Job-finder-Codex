import type { CompanyRecruitmentProfileSeed } from "../types";
import { BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES, BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES, WORKDAY_JSON_CONFIG } from "../shared";

export const profile_bms_china = {
  companyId: "company-bms-china",
  sources: [
    {
      sourceId: "source-bms-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          workday: {
              tenant: "bristolmyerssquibb",
              site: "BMS",
              searchText: "China",
              laterZeroTotalPolicy: "BMS_AUDITED_EXACT_RECONCILIATION",
              locationFacetPolicy: {
                  kind: "BMS_AUDITED_FOREIGN_DESCRIPTOR_ALLOWLIST",
                  facetParameter: "locationHierarchy2",
                  foreignSiteDescriptorAliases: BMS_AUDITED_FOREIGN_SITE_DESCRIPTOR_ALIASES,
                  foreignCountryDescriptorAliases: BMS_AUDITED_FOREIGN_COUNTRY_DESCRIPTOR_ALIASES
              },
              facetDescriptorBoundary: {
                  facetParameter: "workerSubType",
                  allowedDescriptors: ["Fixed Term (Fixed Term)", "Permanent"]
              },
              pageSize: 20,
              maxPages: 5
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
