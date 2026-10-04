import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_shanghai_pharma = {
  companyId: "company-shanghai-pharma",
  sources: [
    {
      sourceId: "source-shanghai-pharma-social",
      executionConfig: {
        adapterId: "official-json",
        json: { ...OFFICIAL_API_JSON_CONFIG, fields: { ...OFFICIAL_API_JSON_CONFIG.fields, officialPublishedAt: "officialPublishedAt" } },
        officialJsonFetch: {
          kind: "beisen-zhiye-2022",
          detailPostedDatePolicy: "BEISEN_NATIVE_DETAIL_POSTDATE_V1",
          geographyScope: "DOMESTIC_OFFICIAL_TENANT",
          mixedLocationPolicy: "INHERIT_MAINLAND_PARENT_FOR_SIBLING_LOCATIONS",
          category: "1",
          pageSize: 100,
          detailPath: "social/detail"
        }
      }
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
