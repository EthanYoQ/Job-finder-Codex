import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";
import { QILU_DUAL_PARTITION_PROFILE } from "../../qiluDualPartitionConfig";
export const profile_qilu = {
  companyId: "company-qilu",
  sources: [{ sourceId: "source-qilu-social", executionConfig: {
    adapterId: "official-json", json: OFFICIAL_API_JSON_CONFIG, profileBoundSource: QILU_DUAL_PARTITION_PROFILE
  } }]
} satisfies CompanyRecruitmentProfileSeed;
