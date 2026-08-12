import type { ATSKind } from "../../domain/company";
import type { HtmlTableConfig, OfficialJsonConfig } from "../adapters/types";
import type { HotjobLegacyFetchConfig } from "../hotjobLegacySourceFetch";
import type { HotjobWecruitFetchConfig } from "../hotjobWecruitSourceFetch";
import type { LivzonCeccFetchConfig } from "../livzonCeccSourceFetch";
import type { MsdDualOfficialFetchConfig } from "../msdDualOfficialSourceFetch";
import type { OfficialJsonFetchConfig } from "../officialJsonSourceFetch";
import type { SinopharmIguopinFetchConfig } from "../sinopharmIguopinSourceFetch";
import type { WorkdayFetchConfig } from "../workdaySourceFetch";
import type { XinhuaOfficialAnnouncementFetchConfig } from "../xinhuaOfficialAnnouncementSourceFetch";

export interface MokaFetchConfig {
  expectedOrgId: string;
  expectedSiteId: string;
  expectedMode: "social";
  campaignUrl: string;
  allowedEntryRedirect?: {
    origin: string;
    pathname: string;
  };
  hydrateMissingLocationsFromDetail?: boolean;
  allowDetailSiteIdOmission?: boolean;
}

export type ProfileBoundSourceConfig =
  | {
      kind: "msd-dual-official";
      config: MsdDualOfficialFetchConfig;
      expectedChannelIds?: readonly string[];
    }
  | {
      kind: "livzon-cecc";
      config: LivzonCeccFetchConfig;
      expectedChannelIds?: readonly string[];
    }
  | {
      kind: "sinopharm-iguopin";
      config: SinopharmIguopinFetchConfig;
      expectedChannelIds?: readonly string[];
    }
  | {
      kind: "xinhua-official-announcements";
      config: XinhuaOfficialAnnouncementFetchConfig;
      expectedChannelIds: readonly ["desktop", "mobile"];
    };

export type CompanyRecruitmentExecutionConfig = {
  formalEligibility?: "QUARANTINED_PENDING_TRUSTED_ORACLE";
  transientRetryPolicy?: {
    maxRetries: 1 | 2;
    backoffMs: number;
  };
} & (
  | {
      adapterId: "official-json";
      json: OfficialJsonConfig;
      officialJsonFetch?: OfficialJsonFetchConfig;
      workday?: WorkdayFetchConfig;
      hotjob?: HotjobWecruitFetchConfig;
      hotjobLegacy?: HotjobLegacyFetchConfig;
      profileBoundSource?: ProfileBoundSourceConfig;
      moka?: MokaFetchConfig;
    }
  | {
      adapterId: "html-table";
      table: HtmlTableConfig;
    }
);

export interface CompanyRecruitmentSourceSeed {
  sourceId: string;
  executionConfig: CompanyRecruitmentExecutionConfig;
}

export interface CompanyRecruitmentProfileSeed {
  companyId: string;
  sources: readonly CompanyRecruitmentSourceSeed[];
}

export type CompanyCompletenessStrategy =
  | "STRICT_OFFICIAL_SOURCE_EVIDENCE"
  | "OFFICIAL_HTML_PAGINATION_EVIDENCE"
  | "STATIC_PUBLIC_LIST_EXHAUSTION";

export interface CompanyRecruitmentSourceProfile {
  companyId: string;
  sourceId: string;
  officialEntryAllowedUrls: readonly string[];
  officialChainEvidenceUrl: string;
  atsKind: ATSKind;
  chinaSocialScope: {
    channel: "SOCIAL";
    geography: "MAINLAND_CHINA";
    authority: "OFFICIAL_LINK_OR_EXPLICIT_ENDORSEMENT";
  };
  completenessStrategy: CompanyCompletenessStrategy;
  failureDisplayStrategy: "VERIFYING_KEEP_OFFICIAL_ENTRY";
  officialChainVerification: {
    checkedAt: string;
    reason: string;
  };
  executionConfig: CompanyRecruitmentExecutionConfig;
}

export interface CompanyRecruitmentProfile {
  companyId: string;
  sources: readonly CompanyRecruitmentSourceProfile[];
}
