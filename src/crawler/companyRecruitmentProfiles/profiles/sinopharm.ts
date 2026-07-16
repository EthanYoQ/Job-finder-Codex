import type { SinopharmIguopinFetchConfig } from "../../sinopharmIguopinSourceFetch";
import type {
  CompanyRecruitmentExecutionConfig,
  CompanyRecruitmentProfileSeed
} from "../types";
import { OFFICIAL_API_JSON_CONFIG } from "../shared";

type SinopharmExecutionConfig = Extract<
  CompanyRecruitmentExecutionConfig,
  { adapterId: "official-json" }
> & {
  profileBoundSource: {
    kind: "sinopharm-iguopin";
    config: SinopharmIguopinFetchConfig;
  };
};

const executionConfig: SinopharmExecutionConfig = {
  adapterId: "official-json",
  json: OFFICIAL_API_JSON_CONFIG,
  transientRetryPolicy: { maxRetries: 1, backoffMs: 10_000 },
  profileBoundSource: {
    kind: "sinopharm-iguopin",
    config: {
      officialTalentHubUrl: "https://www.sinopharm.com/talents.html",
      officialRecruitmentUrl: "https://www.sinopharm.com/recruitment.html",
      officialWechatArticleUrl: "https://mp.weixin.qq.com/s/HHzjsHj-iLo9jlsf6LH0Vg",
      exclusiveEntryUrl: "https://sinopharm-global.iguopin.com/job",
      exclusiveInfoUrl:
        "https://gp-api.iguopin.com/api/activity/exclusive/v1/info?domain=sinopharm-global",
      projectJobsUrl: "https://gp-api.iguopin.com/api/jobs/v1/project-job",
      expectedDomain: "sinopharm-global",
      expectedCompanyId: "10685286902763068",
      expectedCompanyName: "中国医药集团有限公司",
      pageSize: 100,
      maxPages: 20
    }
  }
};

export const profile_sinopharm = {
  companyId: "company-sinopharm",
  sources: [
    {
      sourceId: "source-sinopharm-social",
      executionConfig
    }
  ]
} satisfies CompanyRecruitmentProfileSeed;
