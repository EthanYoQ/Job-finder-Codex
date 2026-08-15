import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_grifols_china = {
  companyId: "company-grifols-china",
  sources: [
    {
      sourceId: "source-grifols-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
          officialJsonFetch: {
              kind: "jobsyn-solr",
              endpointUrl: "https://prod-search-api.jobsyn.org/api/v1/solr/search",
              siteOrigin: "grifols.jobs",
              location: "chn",
              pageSize: 9,
              maxPages: 5,
              detailBaseUrl: "https://grifols.jobs"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
