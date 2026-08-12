import type { CompanyRecruitmentProfileSeed } from "../types";
import { JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES, JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES, WORKDAY_JSON_CONFIG } from "../shared";

export const profile_johnson_innovative_medicine = {
  companyId: "company-johnson-innovative-medicine",
  sources: [
    {
      sourceId: "source-johnson-innovative-medicine-social",
      executionConfig: {
          formalEligibility: "QUARANTINED_PENDING_TRUSTED_ORACLE",
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          workday: {
              tenant: "jj",
              site: "JJ",
              searchText: "China",
              opaqueMultiLocationDetailPolicy: "JNJ_AUDITED_CHINA_DETAIL_V1",
              locationFacetPolicy: {
                  kind: "JNJ_AUDITED_LOCATIONS_OVERLAP",
                  facetParameter: "locations",
                  mainlandDescriptorAliases: JNJ_AUDITED_MAINLAND_DESCRIPTOR_ALIASES,
                  foreignDescriptorAliases: JNJ_AUDITED_FOREIGN_DESCRIPTOR_ALIASES
              },
              facetDescriptorBoundary: {
                  facetParameter: "workerSubType",
                  allowedDescriptors: ["Fixed Term Employee (Non-Intern) (Fixed Term)", "Regular"],
                  excludedDescriptors: ["College Recruit", "Intern (Fixed Term)", "Temporary Agency Worker"]
              },
              pageSize: 20,
              maxPages: 20
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
