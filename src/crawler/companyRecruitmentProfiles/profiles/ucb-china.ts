import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_ucb_china = {
  companyId: "company-ucb-china",
  sources: [
    {
      sourceId: "source-ucb-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: {
              ...OFFICIAL_API_JSON_CONFIG,
              fields: { ...OFFICIAL_API_JSON_CONFIG.fields, officialPublishedAt: "officialPublishedAt" }
          },
          officialJsonFetch: {
              kind: "phenom",
              postedDatePolicy: "UCB_PHENOM_POSTED_DATE_V1",
              cityScopePolicy: "UCB_PRIMARY_CITY_AGREEMENT_V1",
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
