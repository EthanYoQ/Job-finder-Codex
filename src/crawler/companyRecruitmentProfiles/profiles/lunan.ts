import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_lunan = {
  companyId: "company-lunan",
  sources: [
    {
      sourceId: "source-lunan-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "hcm-cloud",
              pageSize: 20,
              maxPages: 5,
              countCoordinatePolicy: "LUNAN_AGGREGATE_ROW",
              responsePrefixPolicy: "LUNAN_RANDOM_ALNUM3",
              listPaginationPolicy: "LUNAN_REQUEST_BOUND_PAGE_V1",
              defaultLocationRaw: "未披露"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
