import type {
  ATSKind,
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
  officialChainEvidenceUrl: string;
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

export interface HtmlFieldSelector {
  selector: string;
  attribute?: string;
}

export interface HtmlTableFieldMap {
  sourceJobId?: HtmlFieldSelector;
  officialTitle: HtmlFieldSelector;
  auxiliaryChineseTitle?: HtmlFieldSelector;
  officialUrl: HtmlFieldSelector;
  locationRaw: HtmlFieldSelector;
  category?: HtmlFieldSelector;
}

export interface HtmlTableConfig {
  rowSelector: string;
  fields: HtmlTableFieldMap;
  defaultCategory?: JobCategory;
}

export interface CrawlAdapterInput {
  company: CrawlAdapterCompany;
  source: CrawlAdapterSource;
  capturedAt: string;
  payload?: unknown;
  html?: string;
  json?: OfficialJsonConfig;
  table?: HtmlTableConfig;
  isBaseline?: boolean;
}

export type CrawlAdapterResult =
  | {
      status: "SUCCESS";
      jobs: NormalizedJobRecord[];
      observation: CrawlObservation;
    }
  | {
      status: "FAILED";
      jobs: [];
      failureReason: string;
      observation: CrawlObservation;
    };

export interface SourceAdapter {
  id: string;
  extract(input: CrawlAdapterInput): CrawlAdapterResult;
}
