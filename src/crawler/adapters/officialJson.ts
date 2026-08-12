import { JOB_CATEGORIES, type JobCategory } from "../../domain/search";
import {
  NormalizedJobRecordSchema,
  type NormalizedJobRecord
} from "../normalizedJob";
import type {
  AdapterPath,
  CrawlAdapterResult,
  OfficialJsonAdapterInput,
  SourceAdapter
} from "./types";
import { completenessObservationFields } from "./completeness";
import { emptyReconciliation, reconcileAdapterRows } from "./reconciliation";
import type { AdapterLoss } from "./types";
import { containsSensitiveAdapterValue, isSafeAdapterUrl, isSensitiveAdapterUrl } from "./safeAdapterValue";

const REQUIRED_FIELDS = ["company", "title", "officialUrl", "location"] as const;
const DEFAULT_CATEGORY: JobCategory = "其他";

export const officialJsonAdapter: SourceAdapter<OfficialJsonAdapterInput> = {
  id: "official-json",
  extract(input) {
    if (input.source.kind !== "SOCIAL") {
      return failed(input, "Only SOCIAL sources are supported for P0 ingestion");
    }

    const rawJobs = resolveJobs(input.payload, input.json.jobsPath);
    if (unsafeAdapterMetadata(input)) {
      const losses: AdapterLoss[] = rawJobs.map((_row, rawIndex) => ({ stage: "VALIDATION", reason: "SENSITIVE_OUTPUT", rawIndex }));
      const reconciliation = reconcileAdapterRows(rawJobs.length, rawJobs.length, [], losses).reconciliation;
      return failed(redactedInput(input), "Adapter input metadata is unsafe", reconciliation);
    }
    const valid: NormalizedJobRecord[] = [];
    const adapterLosses: AdapterLoss[] = [];
    rawJobs.forEach((rawJob, rawIndex) => {
      const normalized = normalizeJsonJob(input, rawJob);
      if ("job" in normalized) valid.push(normalized.job);
      else adapterLosses.push({ stage: normalized.stage, reason: normalized.reason, rawIndex });
    });
    const parsedCount = rawJobs.length - adapterLosses.filter((loss) => loss.stage === "PARSE").length;
    const { jobs, reconciliation } = reconcileAdapterRows(rawJobs.length, parsedCount, valid, adapterLosses);

    if (jobs.length === 0) {
      return failed(input, "No normalized jobs found in JSON payload", reconciliation);
    }

    return {
      status: "SUCCESS",
      jobs,
      observation: observation(input, true, reconciliation.dedupeOutputCount), reconciliation
    };
  }
};

function unsafeAdapterMetadata(input: OfficialJsonAdapterInput): boolean {
  return [input.source.id, input.source.companyId, input.company.id, input.company.officialChineseName]
    .some(containsSensitiveAdapterValue);
}

function redactedInput(input: OfficialJsonAdapterInput): OfficialJsonAdapterInput {
  return { ...input, company: { id: "redacted-company", officialChineseName: "redacted-company" },
    source: { ...input.source, id: "redacted-source", companyId: "redacted-company" } };
}

function resolveJobs(payload: unknown, jobsPath: AdapterPath | undefined): unknown[] {
  const jobs = jobsPath ? valueAtPath(payload, jobsPath) : payload;
  return Array.isArray(jobs) ? jobs : [];
}

function normalizeJsonJob(input: OfficialJsonAdapterInput, rawJob: unknown):
  { job: NormalizedJobRecord } | { stage: "PARSE" | "VALIDATION"; reason: AdapterLoss["reason"] } {
  if (!isObject(rawJob)) {
    return { stage: "PARSE", reason: "RAW_ROW_NOT_OBJECT" };
  }

  const { fields } = input.json;
  const officialTitle = stringAtPath(rawJob, fields.officialTitle);
  const rawOfficialUrl = stringAtPath(rawJob, fields.officialUrl);
  const locationRaw = stringAtPath(rawJob, fields.locationRaw);
  if (!officialTitle) return { stage: "VALIDATION", reason: "TITLE_INVALID" };
  if (!rawOfficialUrl || !isSafeAdapterUrl(rawOfficialUrl, input.source.officialEntryUrl)) return { stage: "VALIDATION", reason: rawOfficialUrl && isSensitiveAdapterUrl(rawOfficialUrl, input.source.officialEntryUrl) ? "SENSITIVE_OUTPUT" : "URL_INVALID" };
  const officialUrl = absoluteUrl(rawOfficialUrl, input.source.officialEntryUrl)!;
  if (!locationRaw) return { stage: "VALIDATION", reason: "LOCATION_INVALID" };

  const cities = fields.cities
    ? stringsAtPath(rawJob, fields.cities)
    : citiesFromLocation(locationRaw);
  if (fields.cities && cities.length === 0) return { stage: "VALIDATION", reason: "CITIES_INVALID" };
  const categoryValue = fields.category ? stringAtPath(rawJob, fields.category) : undefined;
  if (categoryValue !== undefined && !isJobCategory(categoryValue)) return { stage: "VALIDATION", reason: "CATEGORY_INVALID" };
  const category = categoryValue ?? input.json.defaultCategory ?? DEFAULT_CATEGORY;
  const publishedAt = stringAtOptionalPath(rawJob, fields.officialPublishedAt);
  if (publishedAt !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(publishedAt)) return { stage: "VALIDATION", reason: "DATE_INVALID" };
  const sourceJobId = stringAtOptionalPath(rawJob, fields.sourceJobId);
  const auxiliaryTitle = stringAtOptionalPath(rawJob, fields.auxiliaryChineseTitle);
  if ([sourceJobId, officialTitle, locationRaw, rawOfficialUrl, auxiliaryTitle, publishedAt, ...cities].some((value) => value !== undefined && containsSensitiveAdapterValue(value)))
    return { stage: "VALIDATION", reason: "SENSITIVE_OUTPUT" };

  const parsed = NormalizedJobRecordSchema.safeParse({
    companyId: input.company.id,
    sourceId: input.source.id,
    sourceKind: "SOCIAL",
    atsKind: input.source.atsKind,
    officialChineseCompanyName: input.company.officialChineseName,
    officialTitle,
    officialUrl,
    listUrl: input.source.officialEntryUrl,
    locationRaw,
    cities,
    category,
    isBaseline: input.isBaseline ?? true,
    evidence: {
      officialEntryUrl: input.source.officialEntryUrl,
      ...(input.source.officialChainEvidenceUrl
        ? { officialChainEvidenceUrl: input.source.officialChainEvidenceUrl }
        : {}),
      capturedAt: input.capturedAt
    },
    ...optionalString("sourceJobId", sourceJobId),
    ...optionalString(
      "auxiliaryChineseTitle",
      auxiliaryTitle
    ),
    ...optionalString(
      "officialPublishedAt",
      publishedAt
    )
  });

  return parsed.success ? { job: parsed.data } : { stage: "VALIDATION", reason: "NORMALIZED_SCHEMA_INVALID" };
}

function valueAtPath(value: unknown, path: AdapterPath): unknown {
  return pathSegments(path).reduce<unknown>((currentValue, segment) => {
    if (!isObject(currentValue)) {
      return undefined;
    }

    return currentValue[segment];
  }, value);
}

function stringAtPath(value: unknown, path: AdapterPath): string | undefined {
  return cleanString(valueAtPath(value, path));
}

function stringAtOptionalPath(value: unknown, path: AdapterPath | undefined): string | undefined {
  return path ? stringAtPath(value, path) : undefined;
}

function stringsAtPath(value: unknown, path: AdapterPath): string[] {
  const fieldValue = valueAtPath(value, path);
  if (Array.isArray(fieldValue)) {
    return fieldValue.map(cleanString).filter((city): city is string => Boolean(city));
  }

  return citiesFromLocation(cleanString(fieldValue) ?? "");
}

function pathSegments(path: AdapterPath): string[] {
  return typeof path === "string"
    ? path.split(".").map((segment) => segment.trim()).filter(Boolean)
    : [...path];
}

function cleanString(value: unknown): string | undefined {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function citiesFromLocation(locationRaw: string): string[] {
  return locationRaw
    .split(/[,，;；、/]/)
    .map((city) => city.trim())
    .filter(Boolean);
}

function isJobCategory(value: string | undefined): value is JobCategory {
  return JOB_CATEGORIES.includes(value as JobCategory);
}

function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value, baseUrl);
    if (!isSafeAdapterUrl(url.toString(), baseUrl)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function optionalString(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {};
}

function observation(
  input: OfficialJsonAdapterInput,
  successful: boolean,
  structuredJobCount: number,
  failureReason?: string
): CrawlAdapterResult["observation"] {
  return {
    id: `${input.source.id}:official-json:${input.capturedAt}`,
    sourceId: input.source.id,
    crawledAt: new Date(input.capturedAt),
    successful,
    stableRequiredFields: successful && structuredJobCount > 0 ? [...REQUIRED_FIELDS] : [],
    structuredJobCount,
    ...completenessObservationFields({
      completeness: input.completeness,
      structuredJobCount,
      defaultEvidenceUrl: input.source.officialEntryUrl
    }),
    ...(failureReason ? { failureReason } : {})
  };
}

function failed(input: OfficialJsonAdapterInput, failureReason: string, reconciliation = emptyReconciliation()): CrawlAdapterResult {
  return {
    status: "FAILED",
    jobs: [],
    failureReason,
    observation: observation(input, false, 0, failureReason), reconciliation
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
