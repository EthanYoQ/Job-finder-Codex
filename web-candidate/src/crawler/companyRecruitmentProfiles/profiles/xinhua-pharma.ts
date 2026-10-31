import {
  XINHUA_OFFICIAL_ANNOUNCEMENT_PROFILE_BOUND_SOURCE
} from "../../xinhuaOfficialAnnouncementSourceFetch";
import type {
  CompanyRecruitmentExecutionConfig,
  CompanyRecruitmentProfileSeed
} from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

const xinhuaExecutionConfig = {
  adapterId: "official-json",
  json: OFFICIAL_API_JSON_CONFIG,
  profileBoundSource: XINHUA_OFFICIAL_ANNOUNCEMENT_PROFILE_BOUND_SOURCE
} satisfies CompanyRecruitmentExecutionConfig;

export const profile_xinhua_pharma = {
  companyId: "company-xinhua-pharma",
  sources: [
    {
      sourceId: "source-xinhua-pharma-social",
      executionConfig: xinhuaExecutionConfig
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
