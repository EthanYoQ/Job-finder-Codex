import type {
  ATSKind,
  CompletenessEvidence,
  CrawlObservation,
  SourceKind,
  VerificationStatus
} from "../../domain/company";
import type { JobCategory } from "../../domain/search";
import type { NormalizedJobRecord } from "../normalizedJob";

export type AdapterStatus = "SUCCESS" | "FAILED";
export type AdapterPath = string | readonly string[];

export interface CrawlAdapterCompany {
  id: string;
  officialChineseName: string;
}

export interface CrawlAdapterSource {
  id: string;
  companyId: string;
  kind: SourceKind;
  atsKind: ATSKind;
  officialEntryUrl: string;
  officialChainEvidenceUrl?: string;
  status: VerificationStatus;
}

export interface OfficialJsonFieldMap {
  sourceJobId?: AdapterPath;
  officialTitle: AdapterPath;
  auxiliaryChineseTitle?: AdapterPath;
  officialUrl: AdapterPath;
  locationRaw: AdapterPath;
  cities?: AdapterPath;
  category?: AdapterPath;
  officialPublishedAt?: AdapterPath;
}

export interface OfficialJsonConfig {
  jobsPath?: AdapterPath;
  fields: OfficialJsonFieldMap;
  defaultCategory?: JobCategory;
}

export type HtmlFieldSelector =
  | {
      selector: string;
      attribute?: string;
      pattern?: string;
      value?: never;
    }
  | {
      value: string;
      selector?: never;
      attribute?: never;
      pattern?: never;
    };

export interface HtmlTableFieldMap {
  sourceJobId?: HtmlFieldSelector;
  sourceJobIdParts?: readonly HtmlFieldSelector[];
  officialTitle: HtmlFieldSelector;
  auxiliaryChineseTitle?: HtmlFieldSelector;
  officialUrl: HtmlFieldSelector;
  locationRaw: HtmlFieldSelector;
  category?: HtmlFieldSelector;
}

export interface HtmlTableConfig {
  rowSelector: string;
  fields: HtmlTableFieldMap;
  staticPublicList?: {
    containerSelector: string;
    nextControlSelector: string;
    excludedPartitionSelectors?: readonly string[];
    allowRedactedPositivePartial?: boolean;
    explicitEmptyState?: {
      selector: string;
      pattern: string;
    };
  };
  defaultCategory?: JobCategory;
  requestHeaders?: Record<string, string>;
  pagination?: {
    totalPagesSelector: string;
    totalPagesAttribute: string;
    totalPagesPattern?: string;
    totalPagesMode?: "first" | "max";
    totalPagesDeclaredOnEntryOnly?: boolean;
    pageSearchParam: string;
    pageSearchParamMode?: "page" | "offset";
    pageUrlTemplate?: string;
    pageNumberOffset?: number;
    pageSize?: number;
    maxPages: number;
    expectedJobCountSelector?: string;
    expectedJobCountAttribute?: string;
    expectedJobCountPattern?: string;
    expectedJobCountValue?: number;
    ajaxMode?: "talentbrew" | "tupu360";
    talentbrewScope?: {
      requiredActiveFacet: {
        id: string;
        facetType: number;
        descriptor: string;
      };
      allowedPartitions: Array<{
        channelId: string;
        id: string;
        facetType: number;
        fieldName: string;
        descriptor: string;
      }>;
    };
  };
}

export interface BaseCrawlAdapterInput {
  company: CrawlAdapterCompany;
  source: CrawlAdapterSource;
  capturedAt: string;
  isBaseline?: boolean;
  completeness?: CompletenessEvidence;
}

export interface OfficialJsonAdapterInput extends BaseCrawlAdapterInput {
  payload: unknown;
  json: OfficialJsonConfig;
}

export interface HtmlTableAdapterInput extends BaseCrawlAdapterInput {
  html: string;
  table: HtmlTableConfig;
}

export type CrawlAdapterInput = OfficialJsonAdapterInput | HtmlTableAdapterInput;

export type AdapterLossReason = "RAW_ROW_NOT_OBJECT" | "TITLE_INVALID" | "URL_INVALID" |
  "LOCATION_INVALID" | "CITIES_INVALID" | "CATEGORY_INVALID" | "DATE_INVALID" |
  "SENSITIVE_OUTPUT" | "NORMALIZED_SCHEMA_INVALID";
export interface AdapterLoss { stage: "PARSE" | "VALIDATION"; reason: AdapterLossReason; rawIndex: number }
export interface AdapterCollisionGroup {
  dedupeKeySha256: string;
  candidateKeySha256: string[];
  winnerKeySha256: string;
  droppedCount: number;
  dropReason: "DUPLICATE_DEDUPE_KEY_DETERMINISTIC_WINNER";
}
export interface AdapterReconciliation {
  rawInputCount: number;
  parsedCount: number;
  validBeforeDedupeCount: number;
  dedupeInputCount: number;
  dedupeOutputCount: number;
  adapterLosses: AdapterLoss[];
  collisionGroups: AdapterCollisionGroup[];
  outputJobKeyCommitments: string[];
  outputJobKeySetSha256: string;
  ledgerSha256: string;
}

export type CrawlAdapterResult =
  | {
      status: "SUCCESS";
      jobs: NormalizedJobRecord[];
      observation: CrawlObservation;
      reconciliation?: AdapterReconciliation;
    }
  | {
      status: "FAILED";
      jobs: [];
      failureReason: string;
      observation: CrawlObservation;
      reconciliation?: AdapterReconciliation;
    };

export interface SourceAdapter<Input extends BaseCrawlAdapterInput = BaseCrawlAdapterInput> {
  id: string;
  extract(input: Input): CrawlAdapterResult;
}
