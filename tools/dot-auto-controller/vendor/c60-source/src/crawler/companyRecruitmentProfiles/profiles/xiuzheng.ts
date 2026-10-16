import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_xiuzheng = {
  companyId: "company-xiuzheng",
  sources: [
    {
      sourceId: "source-xiuzheng-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "xiuzheng-job-list",
              endpointUrl: "https://www.xiuzheng.com/front/human-resource/job-list",
              detailBaseUrl: "https://www.xiuzheng.com/#/recruitDetail",
              defaultLocationRaw: "未披露",
              pageSize: 10,
              maxPages: 5,
              scopeExclusionProof: "XIUZHENG_NON_RECRUITMENT_TITLE_V1"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
