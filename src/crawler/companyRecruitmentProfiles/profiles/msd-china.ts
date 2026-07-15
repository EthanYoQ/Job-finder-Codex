import type { CompanyRecruitmentProfileSeed } from "../types";
import { WORKDAY_JSON_CONFIG } from "../shared";

export const profile_msd_china = {
  companyId: "company-msd-china",
  sources: [
    {
      sourceId: "source-msd-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: WORKDAY_JSON_CONFIG,
          workday: {
              tenant: "msd",
              site: "SearchJobs",
              searchText: "China",
              opaqueMultiLocationDetailPolicy: "MSD_AUDITED_CHINA_DETAIL_V1",
              locationFacetPolicy: {
                  kind: "MSD_AUDITED_NON_CHINA_DUPLICATE_DESCRIPTORS",
                  facetParameter: "locations",
                  allowedDuplicateDescriptors: ["IND - Telangana - Hyderabad"]
              },
              facetDescriptorBoundary: {
                  facetParameter: "workerSubType",
                  allowedDescriptors: ["Regular"]
              },
              pageSize: 20,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
