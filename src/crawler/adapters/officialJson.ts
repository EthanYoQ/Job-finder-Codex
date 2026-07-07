import { JOB_CATEGORIES, type JobCategory } from "../../domain/search";
import {
  NormalizedJobRecordSchema,
  type NormalizedJobRecord
} from "../normalizedJob";
import type {
  AdapterPath,
  CrawlAdapterInput,
  CrawlAdapterResult,
  SourceAdapter
} from "./types";

const REQUIRED_FIELDS = ["company", "title", "officialUrl", "location"] as const;
const DEFAULT_CATEGORY: JobCategory = "其他";

export const officialJsonAdapter: SourceAdapter = {
  id: "official-json",
  extract(input) {
    if (input.source.kind !== "SOCIAL") {
      return failed(input, "Only SOCIAL sources are supported for P0 ingestion");
    }

    if (!input.json) {
      return failed(input, "Missing official JSON adapter configuration");
    }

    const rawJobs = resolveJobs(input.payload, input.json.jobsPath);
    const jobs = rawJobs.flatMap((rawJob) => normalizeJsonJob(input, rawJob));

    if (jobs.length === 0) {
      return failed(input, "No normalized jobs found in JSON payload");
    }

    return {
      status: "SUCCESS",
      jobs,
      observation: observation(input, true, jobs.length)
    };
  }
};

function resolveJobs(payload: unknown, jobsPath: AdapterPath | undefined): unknown[] {
  const jobs = jobsPath ? valueAtPath(payload, jobsPath) : payload;
  return Array.isArray(jobs) ? jobs : [];
}

function normalizeJsonJob(input: CrawlAdapterInput, rawJob: unknown): NormalizedJobRecord[] {
  if (!isObject(rawJob) || !input.json) {
    return [];
  }

  const { fields } = input.json;
  const officialTitle = stringAtPath(rawJob, fields.officialTitle);
  const officialUrl = absoluteUrl(stringAtPath(rawJob, fields.officialUrl), input.source.officialEntryUrl);
  const locationRaw = stringAtPath(rawJob, fields.locationRaw);

  if (!officialTitle || !officialUrl || !locationRaw) {
    return [];
  }

  const cities = fields.cities
    ? stringsAtPath(rawJob, fields.cities)
    : citiesFromLocation(locationRaw);
  const category = categoryFromValue(
    fields.category ? stringAtPath(rawJob, fields.category) : undefined,
    input.json.defaultCategory
  );

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
      officialChainEvidenceUrl: input.source.officialChainEvidenceUrl,
      capturedAt: input.capturedAt
    },
    ...optionalString("sourceJobId", stringAtOptionalPath(rawJob, fields.sourceJobId)),
    ...optionalString(
      "auxiliaryChineseTitle",
      stringAtOptionalPath(rawJob, fields.auxiliaryChineseTitle)
    ),
    ...optionalString(
      "officialPublishedAt",
      stringAtOptionalPath(rawJob, fields.officialPublishedAt)
    )
  });

  return parsed.success ? [parsed.data] : [];
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

function categoryFromValue(value: string | undefined, defaultCategory?: JobCategory): JobCategory {
  if (isJobCategory(value)) {
    return value;
  }

  return defaultCategory ?? DEFAULT_CATEGORY;
}

function isJobCategory(value: string | undefined): value is JobCategory {
  return JOB_CATEGORIES.includes(value as JobCategory);
}

function absoluteUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function optionalString(key: string, value: string | undefined): Record<string, string> {
  return value ? { [key]: value } : {};
}

function observation(
  input: CrawlAdapterInput,
  successful: boolean,
  structuredJobCount: number,
  failureReason?: string
): CrawlAdapterResult["observation"] {
  return {
    id: `${input.source.id}:official-json:${input.capturedAt}`,
    sourceId: input.source.id,
    crawledAt: new Date(input.capturedAt),
    successful,
    stableRequiredFields: successful ? [...REQUIRED_FIELDS] : [],
    structuredJobCount,
    ...(failureReason ? { failureReason } : {})
  };
}

function failed(input: CrawlAdapterInput, failureReason: string): CrawlAdapterResult {
  return {
    status: "FAILED",
    jobs: [],
    failureReason,
    observation: observation(input, false, 0, failureReason)
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
