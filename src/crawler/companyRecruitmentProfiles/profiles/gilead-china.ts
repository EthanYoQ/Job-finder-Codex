import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_gilead_china = {
  companyId: "company-gilead-china",
  sources: [
    {
      sourceId: "source-gilead-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "yello-job-board",
              boardId: "v42vD4vKxb3AkKvV93YsrQ",
              locationFilterId: 72,
              expectedLocationLabel: "China"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
