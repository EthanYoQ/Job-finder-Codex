import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";
import { SOURCE_NATIVE_HALF_YEAR_WINDOW_DAYS } from "../../../domain/jobRecencyPolicy";

export const profile_hansoh = {
  companyId: "company-hansoh",
  sources: [
    {
      sourceId: "source-hansoh-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "beisen-zhiye-2022",
              postDateWithinDays: SOURCE_NATIVE_HALF_YEAR_WINDOW_DAYS,
              geographyScope: "DOMESTIC_OFFICIAL_TENANT",
              category: "1",
              displayFields: ["Category", "Kind", "LocId", "Salary", "Degree", "YearsOfWorking",
                "ClassificationOne", "WorkWeChatQrCode", "PostDate"],
              pageSize: 100,
              maxPages: 10,
              detailPath: "social/detail"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
