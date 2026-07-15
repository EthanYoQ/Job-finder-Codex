import type { CompanyRecruitmentProfileSeed } from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

export const profile_cspc = {
  companyId: "company-cspc",
  sources: [
    {
      sourceId: "source-cspc-social",
      executionConfig: {
          adapterId: "official-json",
          json: OFFICIAL_API_JSON_CONFIG,
          officialJsonFetch: {
              kind: "redsea-zp-channel",
              rootId: "cspc",
              channels: [
                  { channelQrId: "0beb3022-3214-4333-a2e7-20786c4916d5", purpose: "SOCIAL" },
                  { channelQrId: "623d3b53-0d75-4649-8d4c-df366532fb58", purpose: "CAMPUS" }
              ],
              paginationPolicy: "SINGLE_UNPAGINATED_RESPONSE_V1"
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
