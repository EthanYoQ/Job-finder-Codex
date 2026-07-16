import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_merck_china = {
  companyId: "company-merck-china",
  sources: [
    {
      sourceId: "source-merck-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "phenom",
              detailBaseUrl: "https://careers.emdgroup.com/us/en/job",
              facetScope: {
                  countryIncludeDescriptor: "China",
                  includeFacet: {
                      field: "businessSector",
                      descriptor: "Healthcare"
                  },
                  exclusionFacet: {
                      field: "jobLevelId",
                      descriptors: [
                          "A - Current Student",
                          "B - Recent University Graduate(<1 year of experience)"
                      ]
                  },
                  partitionProofPolicy: "MERCK_HEALTHCARE_PARTITION_V1"
              },
              allowOmittedOffsetForSinglePage: true,
              pageSize: 50,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
