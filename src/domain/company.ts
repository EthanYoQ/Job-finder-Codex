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
  | "HOTJOB_WECRUIT"
  | "SUCCESSFACTORS"
  | "REDSEA"
  | "BROWSER_FALLBACK"
  | "UNKNOWN";

export type RequiredJobField = "company" | "title" | "officialUrl" | "location";

export type CompletenessStatus =
  | "VERIFIED"
  | "NEEDS_MANUAL_COMPLETENESS_REVIEW"
  | "INCOMPLETE"
  | "FAILED";

export type CompletenessEvidenceKind =
  | "OFFICIAL_TOTAL_COUNT"
  | "OFFICIAL_TOTAL_PAGES"
  | "COMPLETE_PAGE_TRAVERSAL"
  | "WEAK_MANUAL_SAMPLE"
  | "FETCH_FAILURE";

export interface CompletenessEvidence {
  completenessStatus: CompletenessStatus;
  expectedJobCount?: number;
  completenessEvidenceKind?: CompletenessEvidenceKind;
  completenessEvidenceUrl?: string;
  completenessBlockerReason?: string;
  totalPages?: number;
  pageSize?: number;
  pagesVisited?: number;
}

export interface CrawlObservation {
  id: string;
  sourceId: string;
  crawledAt: Date;
  successful: boolean;
  stableRequiredFields: RequiredJobField[];
  structuredJobCount: number;
  expectedJobCount?: number;
  completenessStatus?: CompletenessStatus;
  completenessEvidenceKind?: CompletenessEvidenceKind;
  completenessEvidenceUrl?: string;
  completenessBlockerReason?: string;
  totalPages?: number;
  pageSize?: number;
  pagesVisited?: number;
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
  category: "FOREIGN_PHARMA" | "DOMESTIC_PHARMA";
  targetStatus:
    | "ACTIVE"
    | "NO_PUBLIC_OFFICIAL_CAREERS_LINK_AT_CAPTURE_TIME"
    | "BLOCKED_EVIDENCE_GAP"
    | typeof import("../data/phase1ScopePolicy").USER_AUTHORIZED_PHASE1_EXCLUSION;
  sources: RecruitmentSource[];
}
