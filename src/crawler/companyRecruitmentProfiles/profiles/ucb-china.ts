import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_ucb_china = {
  companyId: "company-ucb-china",
  sources: [
    {
      sourceId: "source-ucb-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "phenom",
              detailBaseUrl: "https://careers.ucb.com/global/en/job",
              countryFilter: "China",
              allowOmittedOffsetForSinglePage: true,
              pageSize: 50,
              maxPages: 5
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
