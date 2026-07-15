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
                  exclusionFacet: {
                      field: "jobLevelId",
                      descriptors: [
                          "A - Current Student",
                          "B - Recent University Graduate(<1 year of experience)"
                      ]
                  }
              },
              allowOmittedOffsetForSinglePage: true,
              pageSize: 50,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
