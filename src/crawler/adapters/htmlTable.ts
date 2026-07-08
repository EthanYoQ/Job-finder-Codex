import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import { JOB_CATEGORIES, type JobCategory } from "../../domain/search";
import {
  NormalizedJobRecordSchema,
  type NormalizedJobRecord
} from "../normalizedJob";
import type {
  CrawlAdapterResult,
  HtmlTableAdapterInput,
  HtmlFieldSelector,
  SourceAdapter
} from "./types";

const REQUIRED_FIELDS = ["company", "title", "officialUrl", "location"] as const;
const DEFAULT_CATEGORY: JobCategory = "其他";

export const htmlTableAdapter: SourceAdapter<HtmlTableAdapterInput> = {
  id: "html-table",
  extract(input) {
    if (input.source.kind !== "SOCIAL") {
      return failed(input, "Only SOCIAL sources are supported for P0 ingestion");
    }

    const $ = load(input.html);
    const jobs = $(input.table.rowSelector)
      .toArray()
      .flatMap((row) => normalizeTableRow(input, row));

    if (jobs.length === 0) {
      return failed(input, "No normalized jobs found in HTML table");
    }

    return {
      status: "SUCCESS",
      jobs,
      observation: observation(input, true, jobs.length)
    };
  }
};

function normalizeTableRow(input: HtmlTableAdapterInput, row: AnyNode): NormalizedJobRecord[] {
  const $ = load(input.html);
  const { fields } = input.table;
  const officialTitle = readField($, row, fields.officialTitle);
  const officialUrl = absoluteUrl(readField($, row, fields.officialUrl), input.source.officialEntryUrl);
  const locationRaw = readField($, row, fields.locationRaw);

  if (!officialTitle || !officialUrl || !locationRaw) {
    return [];
  }

  const category = categoryFromValue(
    fields.category ? readField($, row, fields.category) : undefined,
    input.table.defaultCategory
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
    cities: citiesFromLocation(locationRaw),
    category,
    isBaseline: input.isBaseline ?? true,
    evidence: {
      officialEntryUrl: input.source.officialEntryUrl,
      officialChainEvidenceUrl: input.source.officialChainEvidenceUrl,
      capturedAt: input.capturedAt
    },
    ...optionalString(
      "sourceJobId",
      fields.sourceJobId ? readField($, row, fields.sourceJobId) : undefined
    ),
    ...optionalString(
      "auxiliaryChineseTitle",
      fields.auxiliaryChineseTitle ? readField($, row, fields.auxiliaryChineseTitle) : undefined
    )
  });

  return parsed.success ? [parsed.data] : [];
}

function readField(
  $: ReturnType<typeof load>,
  row: AnyNode,
  field: HtmlFieldSelector
): string | undefined {
  const element = field.selector === ":scope" ? $(row).first() : $(row).find(field.selector).first();
  const rawValue = field.attribute ? element.attr(field.attribute) : element.text();
  return cleanString(rawValue);
}

function cleanString(value: unknown): string | undefined {
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
  input: HtmlTableAdapterInput,
  successful: boolean,
  structuredJobCount: number,
  failureReason?: string
): CrawlAdapterResult["observation"] {
  return {
    id: `${input.source.id}:html-table:${input.capturedAt}`,
    sourceId: input.source.id,
    crawledAt: new Date(input.capturedAt),
    successful,
    stableRequiredFields: successful ? [...REQUIRED_FIELDS] : [],
    structuredJobCount,
    ...(failureReason ? { failureReason } : {})
  };
}

function failed(input: HtmlTableAdapterInput, failureReason: string): CrawlAdapterResult {
  return {
    status: "FAILED",
    jobs: [],
    failureReason,
    observation: observation(input, false, 0, failureReason)
  };
}
