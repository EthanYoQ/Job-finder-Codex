import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_novo_nordisk_china = {
  companyId: "company-novo-nordisk-china",
  sources: [
    {
      sourceId: "source-novo-nordisk-china-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "novo-nordisk",
              endpointUrl: "https://www.novonordisk.com.cn/bin/nncorp/careersearch?keyword=&country=China&category=&locale=zh-cn",
              cityScopePolicy: "NOVO_CHINA_MAINLAND_JOB_CITY_V1"
          },
          transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
