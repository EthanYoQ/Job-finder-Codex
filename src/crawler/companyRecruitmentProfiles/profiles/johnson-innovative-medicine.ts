import type { CompanyRecruitmentProfileSeed } from "../types";
import { JNJ_CAREERS_CHINA_FETCH_CONFIG } from "../../jnjCareersChinaSourceFetch";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_johnson_innovative_medicine = {
  companyId: "company-johnson-innovative-medicine",
  sources: [
    {
      sourceId: "source-johnson-innovative-medicine-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          profileBoundSource: {
              kind: "jnj-careers-china",
              config: JNJ_CAREERS_CHINA_FETCH_CONFIG
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
