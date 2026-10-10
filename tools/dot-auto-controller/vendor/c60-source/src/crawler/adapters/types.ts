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
  sanofiNativePolicy?: "SANOFI_EN_CN_NATIVE_CHAIN_V1";
  sanofiChineseEntryUrl?: string;
  abbvieRowScopePolicy?: "ABBVIE_CHINA_LISTED_ROWS_V1";
  astraZenecaDetails?: typeof import("../astraZenecaDetailContract").ASTRAZENECA_DETAIL_CONFIG;
  astellasPdfLocations?: typeof import("../astellasPdfCityContract").ASTELLAS_PDF_CITY_CONFIG;
  rowSelector: string;
  /**
   * Optional content-based refinement for a structurally shared list. The
   * selector remains the candidate-row universe; this filter decides which
   * candidates are recruitment rows without embedding company literals in
   * the shared adapter.
   */
  rowFilter?: {
    selector: string;
    pattern: string;
    requireAllCandidatesForCompleteness?: boolean;
  };
  fields: HtmlTableFieldMap;
  strictLocationScope?: {
    allowUnknownEnglishLocalityWithParenthesizedMainlandProvince: boolean;
  };
  /**
   * A source-bound proof recipe. Its presence never certifies a crawl by itself;
   * the independent gate must replay the archived page bodies, URLs and page
   * coordinates against this exact configuration.
   */
  completenessProof?:
    | {
        kind: "OFFICIAL_TOTAL_PAGES";
        sourcePolicy?:
          | "BAYER_CHINA_SUCCESSFACTORS_V1"
          | "NOVARTIS_CHINA_SLIDING_WINDOW_V1";
      }
    | { kind: "CONFIGURED_CHANNEL_TRAVERSAL" }
    | {
        kind: "STATIC_PUBLIC_LIST";
        sourcePolicy?:
          | "APELOA_SOCIAL_TABS_V1"
          | "ASTELLAS_CHINA_PDF_ACCORDION_V1"
          | "ASPEN_CHINA_EMPTY_PUBLIC_LIST_V1"
          | "OTSUKA_CHINA_EMPTY_PUBLIC_LIST_V1"
          | "OTSUKA_CHINA_JOIN_LIST_V1"
          | "GRAND_PHARMA_SOCIAL_ONLY_V1"
          | "HUAHAI_SOCIAL_TABLE_V1";
      };
  strictEmbeddedJsonZero?: {
    kind: "TEVA_SMARTAPPLY_CHINA";
    remoteGlobalForeignExclusionPolicy: "TEVA_US_REMOTE_GLOBAL_V1";
  };
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
    requestFirstPageExplicitly?: boolean;
    pageSearchParamMode?: "page" | "offset";
    pageUrlTemplate?: string;
    pageNumberOffset?: number;
    pageSize?: number;
    maxPages: number;
    expectedJobCountSelector?: string;
    expectedJobCountAttribute?: string;
    expectedJobCountPattern?: string;
    expectedJobCountValue?: number;
    explicitEmptyState?: {
      selector: string;
      pattern: string;
    };
    officialWindowMode?: "NOVARTIS_PAGE_WINDOW_V1";
    strictPageControls?: {
      containerSelector: string;
      pageNumberSelector: string;
      currentPageSelector: string;
      previousPageSelector: string;
      nextPageSelector: string;
      disabledClass: string;
      currentHref: string;
    };
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
      excludedPartitions?: Array<{
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
