import type { CompanyRecruitmentProfileSeed } from "../types";
import { HOTJOB_WECRUIT_JSON_CONFIG } from "../shared";

export const profile_cr_pharma = {
  companyId: "company-cr-pharma",
  sources: [
    {
      sourceId: "source-cr-pharma-social",
      executionConfig: {
          adapterId: "official-json",
          json: HOTJOB_WECRUIT_JSON_CONFIG,
          hotjobLegacy: {
              listUrl: "https://crc.wintalent.cn/wt/crpharma/web/json/position/list?operational=4319f781ebd22dcdc82a3d63a839b4e4480b851dc2aa80a7c13a4e46157692d92f30c07cd9fb7ca40e2238cb94dd7768650b5b2b62309867f9fbd8b3d7c3e118&positionType=0&comPart=&sicCorpCode=&brandCode=1&releaseTime=0&trademark=0&useForm=&recruitType=2&projectId=&lanType=1&positionName=&workPlace=&keyWord=&xuanJiangStr=&site=",
              suitePath: "wt/crpharma",
              paginationMode: "query-page",
              mimeCompatibilityPolicy: "CRPHARMA_WINTALENT_TEXT_HTML_JSON_V1",
              pageSize: 10,
              maxPages: 5
          }
      }
    },
  ]
} satisfies CompanyRecruitmentProfileSeed;
