import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_boehringer_ingelheim_china = {
  companyId: "company-boehringer-ingelheim-china",
  sources: [
    {
      sourceId: "source-boehringer-ingelheim-china-social",
      executionConfig: {
        adapterId: "official-json",
        json: OFFICIAL_API_JSON_CONFIG,
        officialJsonFetch: {
          kind: "51job-coapi",
          ctmid: "3479",
          uiScriptUrl: "https://campus.51job.com/BI/scripts/recruit.js?v=1",
          detailBaseUrl: "https://campus.51job.com/BI/recruit_article_detail3.html",
          pageSize: 500
        }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
