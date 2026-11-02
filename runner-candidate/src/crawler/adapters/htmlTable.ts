import { reviewedAbbvieCity, validateAbbvieChinaRowScope } from "../abbvieChinaRowScope";
import { CITY_PENDING } from "../../domain/jobLocation";
import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { AnyNode } from "domhandler";
import { JOB_CATEGORIES, type JobCategory } from "../../domain/search";
import {
  NormalizedJobRecordSchema,
  type NormalizedJobRecord
} from "../normalizedJob";
import { selectHtmlTableRows } from "../htmlTableRows";
import type {
  CrawlAdapterResult,
  HtmlTableAdapterInput,
  HtmlFieldSelector,
  SourceAdapter
} from "./types";
import { completenessObservationFields } from "./completeness";
import { emptyReconciliation, reconcileAdapterRows } from "./reconciliation";
import type { AdapterLoss } from "./types";
import { containsSensitiveAdapterValue, isSafeAdapterUrl, isSensitiveAdapterUrl } from "./safeAdapterValue";

const REQUIRED_FIELDS = ["company", "title", "officialUrl", "location"] as const;
const DEFAULT_CATEGORY: JobCategory = "其他";

export const htmlTableAdapter: SourceAdapter<HtmlTableAdapterInput> = {
  id: "html-table",
  extract(input) {
    if (input.source.kind !== "SOCIAL") {
      return failed(input, "Only SOCIAL sources are supported for P0 ingestion");
    }
    if (!validSourceJobIdConfig(input)) {
      return failed(input, "HTML source job ID config is invalid");
    }

    const $ = load(input.html);
    const rows = selectHtmlTableRows($, input.table);
    if (unsafeAdapterMetadata(input)) {
      const losses: AdapterLoss[] = rows.map((_row, rawIndex) => ({ stage: "VALIDATION", reason: "SENSITIVE_OUTPUT", rawIndex }));
      const reconciliation = reconcileAdapterRows(rows.length, rows.length, [], losses).reconciliation;
      return failed(redactedInput(input), "Adapter input metadata is unsafe", reconciliation);
    }
    const valid: NormalizedJobRecord[] = [];
    const adapterLosses: AdapterLoss[] = [];
    const abbvieReviewed = input.table.abbvieRowScopePolicy === "ABBVIE_CHINA_LISTED_ROWS_V1" &&
      input.source.id === "source-abbvie-china-social" && input.company.id === "company-abbvie-china" &&
      input.source.officialEntryUrl === "https://careers.abbvie.com/zh-hans/jobs" && validateAbbvieChinaRowScope(input.html);
    rows.forEach((row, rawIndex) => { const normalized = normalizeTableRow(input, $, row, abbvieReviewed);
      if ("job" in normalized) valid.push(normalized.job);
      else adapterLosses.push({ stage: normalized.stage, reason: normalized.reason, rawIndex }); });
    const { jobs, reconciliation } = reconcileAdapterRows(rows.length, rows.length, valid, adapterLosses);

    if (jobs.length === 0 && rows.length === 0 && matchesExplicitStaticZero(input)) {
      return {
        status: "SUCCESS",
        jobs: [],
        observation: observation(input, true, 0),
        reconciliation
      };
    }

    if (jobs.length === 0) {
      return failed(input, "No normalized jobs found in HTML table", reconciliation);
    }

    return {
      status: "SUCCESS",
      jobs,
      observation: observation(input, true, reconciliation.dedupeOutputCount, undefined, readExpectedJobCount(input)), reconciliation
    };
  }
};

function unsafeAdapterMetadata(input: HtmlTableAdapterInput): boolean {
  return [input.source.id, input.source.companyId, input.company.id, input.company.officialChineseName]
    .some(containsSensitiveAdapterValue);
}

function redactedInput(input: HtmlTableAdapterInput): HtmlTableAdapterInput {
  return { ...input, company: { id: "redacted-company", officialChineseName: "redacted-company" },
    source: { ...input.source, id: "redacted-source", companyId: "redacted-company" } };
}

function normalizeTableRow(input: HtmlTableAdapterInput, $: ReturnType<typeof load>, row: AnyNode, abbvieReviewed = false):
  { job: NormalizedJobRecord } | { stage: "VALIDATION"; reason: AdapterLoss["reason"] } {
  // Reuse the document that owns this row. Parsing the complete paginated HTML
  // again for every row multiplies allocation during acquisition and admission.
  const { fields } = input.table;
  const officialTitle = readField($, row, fields.officialTitle);
  const rawOfficialUrl = readField($, row, fields.officialUrl);
  const locationRaw = readField($, row, fields.locationRaw);

  if (!officialTitle) return { stage: "VALIDATION", reason: "TITLE_INVALID" };
  if (!rawOfficialUrl || !isSafeAdapterUrl(rawOfficialUrl, input.source.officialEntryUrl)) return { stage: "VALIDATION", reason: rawOfficialUrl && isSensitiveAdapterUrl(rawOfficialUrl, input.source.officialEntryUrl) ? "SENSITIVE_OUTPUT" : "URL_INVALID" };
  const officialUrl = absoluteUrl(rawOfficialUrl, input.source.officialEntryUrl)!;
  if (!locationRaw) return { stage: "VALIDATION", reason: "LOCATION_INVALID" };

  const categoryValue = fields.category ? readField($, row, fields.category) : undefined;
  if (categoryValue !== undefined && !isJobCategory(categoryValue)) return { stage: "VALIDATION", reason: "CATEGORY_INVALID" };
  const category = categoryValue ?? input.table.defaultCategory ?? DEFAULT_CATEGORY;
  const sourceJobIdParts = fields.sourceJobIdParts?.map((field) => readField($, row, field));
  if (sourceJobIdParts?.some((part) => part === undefined)) {
    return { stage: "VALIDATION", reason: "NORMALIZED_SCHEMA_INVALID" };
  }
  if (sourceJobIdParts?.some((part) => containsSensitiveAdapterValue(part!))) {
    return { stage: "VALIDATION", reason: "SENSITIVE_OUTPUT" };
  }
  const sourceJobId = sourceJobIdParts
    ? `html:sha256:${createHash("sha256").update(sourceJobIdParts.join("\u001f"), "utf8").digest("hex")}`
    : fields.sourceJobId
      ? readField($, row, fields.sourceJobId)
      : undefined;
  const auxiliaryTitle = fields.auxiliaryChineseTitle ? readField($, row, fields.auxiliaryChineseTitle) : undefined;
  if ([sourceJobId, officialTitle, locationRaw, rawOfficialUrl, auxiliaryTitle].some((value) => value !== undefined && containsSensitiveAdapterValue(value)))
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
    cities: abbvieReviewed ? [reviewedAbbvieCity(locationRaw) ?? CITY_PENDING] : citiesFromLocation(locationRaw),
    category,
    isBaseline: input.isBaseline ?? true,
    evidence: {
      officialEntryUrl: input.source.officialEntryUrl,
      ...(input.source.officialChainEvidenceUrl
        ? { officialChainEvidenceUrl: input.source.officialChainEvidenceUrl }
        : {}),
      capturedAt: input.capturedAt
    },
    ...optionalString(
      "sourceJobId",
      sourceJobId
    ),
    ...optionalString(
      "auxiliaryChineseTitle",
      auxiliaryTitle
    )
  });

  return parsed.success ? { job: parsed.data } : { stage: "VALIDATION", reason: "NORMALIZED_SCHEMA_INVALID" };
}

function readField(
  $: ReturnType<typeof load>,
  row: AnyNode,
  field: HtmlFieldSelector
): string | undefined {
  if ("value" in field) {
    return cleanString(field.value);
  }

  const element = field.selector === ":scope" ? $(row).first() : $(row).find(field.selector).first();
  const rawValue = field.attribute ? element.attr(field.attribute) : element.text();
  return cleanString(applyPattern(rawValue, field.pattern));
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function validSourceJobIdConfig(input: HtmlTableAdapterInput): boolean {
  const { sourceJobId, sourceJobIdParts } = input.table.fields;
  return !(sourceJobId && sourceJobIdParts) &&
    (sourceJobIdParts === undefined || sourceJobIdParts.length > 0);
}

function matchesExplicitStaticZero(input: HtmlTableAdapterInput): boolean {
  const config = input.table.staticPublicList;
  const empty = config?.explicitEmptyState;
  if (!config || !empty) return false;
  try {
    const $ = load(input.html);
    const containers = $(config.containerSelector);
    const markers = $(empty.selector);
    if (containers.length !== 1 || markers.length !== 1 || $(config.nextControlSelector).length !== 0) {
      return false;
    }
    const container = containers.get(0)!;
    const marker = markers.get(0)!;
    if (marker !== container && !$.contains(container, marker)) return false;
    const markerText = cleanString(markers.first().text());
    return markerText !== undefined && new RegExp(empty.pattern, "u").test(markerText);
  } catch {
    return false;
  }
}

function applyPattern(value: unknown, pattern: string | undefined): unknown {
  if (!pattern || typeof value !== "string") {
    return value;
  }

  const match = value.match(new RegExp(pattern));
  return match?.[1] ?? match?.[0];
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

function readExpectedJobCount(input: HtmlTableAdapterInput): number | undefined {
  const pagination = input.table.pagination;
  if (!pagination?.expectedJobCountSelector || !pagination.expectedJobCountAttribute) {
    return undefined;
  }

  const $ = load(input.html);
  const value = $(pagination.expectedJobCountSelector).first().attr(pagination.expectedJobCountAttribute);
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
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
  input: HtmlTableAdapterInput,
  successful: boolean,
  structuredJobCount: number,
  failureReason?: string,
  expectedJobCount?: number
): CrawlAdapterResult["observation"] {
  return {
    id: `${input.source.id}:html-table:${input.capturedAt}`,
    sourceId: input.source.id,
    crawledAt: new Date(input.capturedAt),
    successful,
    stableRequiredFields: successful && structuredJobCount > 0 ? [...REQUIRED_FIELDS] : [],
    structuredJobCount,
    ...completenessObservationFields({
      completeness: input.completeness,
      structuredJobCount,
      defaultEvidenceUrl: input.source.officialEntryUrl,
      ...(expectedJobCount === undefined ? {} : { expectedJobCount })
    }),
    ...(failureReason ? { failureReason } : {})
  };
}

function failed(input: HtmlTableAdapterInput, failureReason: string, reconciliation = emptyReconciliation()): CrawlAdapterResult {
  return {
    status: "FAILED",
    jobs: [],
    failureReason,
    observation: observation(input, false, 0, failureReason), reconciliation
  };
}
