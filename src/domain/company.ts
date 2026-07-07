export type VerificationStatus =
  | "UNVERIFIED"
  | "ENTRY_FOUND_PENDING_ADAPTER"
  | "VERIFIED_SCRAPABLE"
  | "TEMP_UNSCRAPABLE"
  | "EXCLUDED";

export type SourceKind = "SOCIAL" | "CAMPUS";

export type ATSKind =
  | "OFFICIAL_HTML"
  | "OFFICIAL_JSON"
  | "MOKA"
  | "BEISEN_ZHIYE"
  | "WORKDAY"
  | "SUCCESSFACTORS"
  | "REDSEA"
  | "BROWSER_FALLBACK"
  | "UNKNOWN";

export type RequiredJobField = "company" | "title" | "officialUrl" | "location";

export interface CrawlObservation {
  id: string;
  sourceId: string;
  crawledAt: Date;
  successful: boolean;
  stableRequiredFields: RequiredJobField[];
  structuredJobCount: number;
  failureReason?: string;
}

export interface RecruitmentSource {
  id: string;
  companyId: string;
  kind: SourceKind;
  atsKind: ATSKind;
  officialEntryUrl: string;
  officialChainEvidenceUrl: string;
  campusEntryUrl?: string;
  status: VerificationStatus;
}

export interface Company {
  id: string;
  officialChineseName: string;
  officialWebsiteUrl: string;
  pinyinName: string;
  inclusionReason: string;
  sources: RecruitmentSource[];
}
