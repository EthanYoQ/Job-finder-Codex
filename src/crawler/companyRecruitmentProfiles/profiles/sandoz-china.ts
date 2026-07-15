import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_sandoz_china = {
  companyId: "company-sandoz-china",
  sources: [
    {
      sourceId: "source-sandoz-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "sandoz-jsonapi",
              endpointUrl: "https://sandoz-com.cms.sandoz.com/jsonapi/views/job_search/job_search",
              taxonomyEndpointUrl: "https://sandoz-com.cms.sandoz.com/jsonapi/taxonomy_term/job_location",
              countryTermName: "LOC_CN",
              countryTermTargetId: 806,
              countryTermUuid: "2f829192-01a9-4909-b729-baab0b0bad0c",
              pageSize: 10,
              maxPages: 50,
              detailBaseUrl: "https://www.sandoz.com",
              cityScopePolicy: "SANDOZ_CHINA_TAXONOMY_LOCATION_V1"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
