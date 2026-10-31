import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_merck_china = {
  companyId: "company-merck-china",
  sources: [
    {
      sourceId: "source-merck-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: { ...OFFICIAL_API_JSON_CONFIG, fields: { ...OFFICIAL_API_JSON_CONFIG.fields, officialPublishedAt: "officialPublishedAt" } },
          officialJsonFetch: {
              kind: "phenom",
              postedDatePolicy: "MERCK_CHINA_PHENOM_POSTED_DATE_V1",
              cityScopePolicy: "MERCK_CHINA_LOCATION_TITLE_PENDING_V2",
              publicVisibilityPolicy: "MERCK_CHINA_PUBLIC_VISIBILITY_V1",
              detailBaseUrl: "https://careers.emdgroup.com/us/en/job",
              countryFilter: "China",
              allowOmittedOffsetForSinglePage: true,
              pageSize: 100,
              maxPages: 10
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
