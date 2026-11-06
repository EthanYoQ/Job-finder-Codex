import { hasExactFosunMainlandGeography } from "./fosunScopeGeography";
import { z } from "zod";
import { manualCaptureError, manualCaptureSha256, parseManualCaptureJson } from "./manualChromeCaptureEvidence";

const reviewedNationwideLocations = new Set(["全国", "中国", "中国大陆"]);
const reviewedForeignLocations = new Set(["美国", "香港", "香港特别行政区", "united states", "usa", "hong kong"]);

export function qiluOfficialLocationParts(raw:Record<string,unknown>):string[]{
 if(Array.isArray(raw.LocNames)&&raw.LocNames.length)return raw.LocNames.filter((v):v is string=>typeof v==='string').map(v=>v.trim());
 const fallback=[raw.LocName,raw.LocationName,raw.City].find(v=>typeof v==='string'&&v.trim());return typeof fallback==='string'?[fallback.trim()]:[];
}
/** Country and mainland geography bind scope; display aliases need no exact text equality. */
export function qiluReviewedRowGeography(raw: unknown): "EXPLICIT_MAINLAND" | "NATIONWIDE_ONLY" | "AUDITED_FOREIGN_ONLY" | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  if(Array.isArray(row.LocNames)&&row.LocNames.some(value=>typeof value!=='string'))return undefined;
  const locations=qiluOfficialLocationParts(row).map(value=>value.normalize('NFKC').trim());if(!locations.length)return undefined;
  const foreignGroup = (value:string):string|undefined => /^(?:美国|united states|usa)$/iu.test(value) ? "US" : /^(?:香港|香港特别行政区|hong kong)$/iu.test(value) ? "HK" : undefined;
  const mainland = hasExactFosunMainlandGeography({...row,LocNames:locations});
  if(mainland)return locations.every(value=>reviewedNationwideLocations.has(value))?"NATIONWIDE_ONLY":"EXPLICIT_MAINLAND";
  const foreign = locations.every(value => reviewedForeignLocations.has(value.toLowerCase()));
  if (locations.some(value => !value) || !foreign) return undefined;
  for (const field of ["Country", "CountryName", "LocName", "LocationName", "City"] as const) {
    const value = row[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return undefined;
    const normalized = value.normalize("NFKC").trim();
    if (!normalized) continue;
    if (field === "Country" || field === "CountryName") {
      if (!foreignGroup(normalized)||locations.some(location=>foreignGroup(location)!==foreignGroup(normalized)))return undefined;
    } else {
      // A city may repeat an exact component of an already-reviewed full label.
      // No province prefix, foreign substring, or guessed location is accepted.
      const exactPrimaryPart = locations.some(location => location === normalized || location.split("·").includes(normalized));
      const sameForeign = foreignGroup(normalized) !== undefined && locations.every(location => foreignGroup(location) === foreignGroup(normalized));
      if (!exactPrimaryPart && !sameForeign) return undefined;
    }
  }
  return "AUDITED_FOREIGN_ONLY";
}

const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const pageSchema = z.object({
  started_at: z.string().datetime({ offset: true }),
  url: z.literal("https://qilu-pharma.zhiye.com/api/Jobad/GetJobAdPageList"),
  method: z.literal("POST"), http_status: z.literal(200),
  request_json_text: z.string().min(1).max(1_000_000), response_json_text: z.string().min(1).max(16_000_000),
  request_text_sha256: sha, response_text_sha256: sha
});
const businessSchema = z.object({
  entries: z.array(pageSchema).min(1).max(100),
  terminal_ui_observation: z.object({ at: z.string().datetime({ offset: true }), selected_page: z.number().int().positive(),
    next_page_visibly_disabled: z.literal(true), final_page_rows_visible: z.number().int().nonnegative() }).optional()
});
const requestSchema = z.object({
  PageIndex: z.number().int().nonnegative(), PageSize: z.literal(15), Category: z.tuple([z.literal("1")]),
  KeyWords: z.literal(""), SpecialType: z.literal(0), PortalId: z.literal(""),
  DisplayFields: z.array(z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,63}$/u)).min(1).max(64)
}).strict();
const rowSchema = z.object({
  Id: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu),
  JobAdId: z.number().int().positive().safe(), JobAdName: z.string().trim().min(1), CategoryId: z.literal("1"), Status: z.literal(1),
  LocNames: z.array(z.string()), PostDate: z.string().optional(), ChangeDate: z.string().optional(),
  EndTime: z.string().optional(), EndTimeInt: z.number().optional(), Channel4IsLong: z.boolean().optional()
}).passthrough();

export interface ManualQiluReplay {
  sourceId: "source-qilu-social";
  partitionIds: readonly ["qilu-non-marketing"];
  observedRequestStartedAt: string;
  lastRequestStartedAt: string;
  rawCount: number;
  uniqueOfficialIdCount: number;
  officialDeclaredPartitionTotal: number;
  pageCount: number;
  pageRowCounts: number[];
  officialIds: string[];
  canonicalOfficialIdSetSha256: string;
  geographyCounts: { explicitMainland: number; nationwideOnly: number; auditedForeignOnly: number; unresolvedOrMixed: number };
  dateDiagnostics: { fractionalSecondRows: number; expirySentinelRows: number; explicitLongTermRows: number; appliedDateFilter: null };
  terminalObservationStatus: "REPORTED_ONLY_NOT_ARTIFACT_REPLAYED" | "MISSING";
  gaps: string[];
}

export function replayManualQiluCapture(input: { business: unknown; now: Date }): ManualQiluReplay {
  const parsed = businessSchema.safeParse(input.business);
  if (!parsed.success) manualCaptureError("QILU_MANUAL_BUSINESS_INVALID");
  if (!Number.isFinite(input.now.getTime())) manualCaptureError("MANUAL_CAPTURE_CLOCK_INVALID");
  const business = parsed.data;
  const rows: Array<z.infer<typeof rowSchema>> = [];
  const pageRowCounts: number[] = [];
  let total: number | undefined;
  let previousStartedAt = -Infinity;
  for (let index = 0; index < business.entries.length; index += 1) {
    const page = business.entries[index]!;
    const startedAt = Date.parse(page.started_at);
    if (startedAt < previousStartedAt || startedAt > input.now.getTime()) manualCaptureError("MANUAL_CAPTURE_CLOCK_INVALID");
    previousStartedAt = startedAt;
    if (manualCaptureSha256(page.request_json_text) !== page.request_text_sha256 ||
        manualCaptureSha256(page.response_json_text) !== page.response_text_sha256) manualCaptureError("MANUAL_CAPTURE_BODY_HASH_INVALID");
    const request = requestSchema.safeParse(parseManualCaptureJson(page.request_json_text));
    if (!request.success || request.data.PageIndex !== index || !request.data.DisplayFields.includes("LocId") ||
        new Set(request.data.DisplayFields).size !== request.data.DisplayFields.length) manualCaptureError("QILU_MANUAL_REQUEST_INVALID");
    const response = z.object({ Code: z.literal(200), Count: z.number().int().nonnegative().max(1500), Data: z.array(z.unknown()).max(15) })
      .safeParse(parseManualCaptureJson(page.response_json_text));
    if (!response.success) manualCaptureError("QILU_MANUAL_RESPONSE_INVALID");
    total ??= response.data.Count;
    if (response.data.Count !== total || response.data.Data.length !== Math.min(15, Math.max(0, total - index * 15))) {
      manualCaptureError("QILU_MANUAL_PAGINATION_INVALID");
    }
    pageRowCounts.push(response.data.Data.length);
    for (const raw of response.data.Data) {
      const row = rowSchema.safeParse(raw);
      if (!row.success) manualCaptureError("QILU_MANUAL_ROW_INVALID");
      rows.push(row.data);
    }
  }
  if (total === undefined || business.entries.length !== Math.max(1, Math.ceil(total / 15)) || rows.length !== total) {
    manualCaptureError("QILU_MANUAL_PAGINATION_INVALID");
  }
  const ids = rows.map((row) => row.Id.toLowerCase());
  if (new Set(ids).size !== ids.length || new Set(rows.map((row) => row.JobAdId)).size !== rows.length) {
    manualCaptureError("QILU_MANUAL_IDENTITY_INVALID");
  }
  const geographyCounts = { explicitMainland: 0, nationwideOnly: 0, auditedForeignOnly: 0, unresolvedOrMixed: 0 };
  for (const row of rows) {
    const scope = qiluReviewedRowGeography(row);
    if (scope === "NATIONWIDE_ONLY") geographyCounts.nationwideOnly += 1;
    else if (scope === "EXPLICIT_MAINLAND") geographyCounts.explicitMainland += 1;
    else if (scope === "AUDITED_FOREIGN_ONLY") geographyCounts.auditedForeignOnly += 1;
    else geographyCounts.unresolvedOrMixed += 1;
  }
  const terminal = business.terminal_ui_observation;
  if (terminal && (terminal.selected_page !== business.entries.length || terminal.final_page_rows_visible !== pageRowCounts.at(-1) ||
      Date.parse(terminal.at) < previousStartedAt || Date.parse(terminal.at) > input.now.getTime())) manualCaptureError("QILU_MANUAL_TERMINAL_INVALID");
  const gaps = ["PER_PAGE_RENDERED_PROJECTION_MISSING", "TERMINAL_UI_ARTIFACT_NOT_REPLAYED", "MARKETING_PARTITION_NOT_CAPTURED",
    "MAIN_CAPTURE_COMPARISON_MISSING", "SEQUENTIAL_COLLECTION_NOT_ATOMIC", "GEOGRAPHY_AND_DATE_POLICY_NOT_FORMALLY_BOUND"];
  if (total === 0) gaps.push("EXPLICIT_RENDERED_ZERO_NOT_VERIFIED");
  return {
    sourceId: "source-qilu-social", partitionIds: ["qilu-non-marketing"],
    observedRequestStartedAt: business.entries[0]!.started_at, lastRequestStartedAt: business.entries.at(-1)!.started_at,
    rawCount: rows.length, uniqueOfficialIdCount: ids.length, officialDeclaredPartitionTotal: total,
    pageCount: business.entries.length, pageRowCounts, officialIds: ids,
    canonicalOfficialIdSetSha256: manualCaptureSha256(JSON.stringify([...ids].sort())), geographyCounts,
    dateDiagnostics: {
      fractionalSecondRows: rows.filter((row) => /T\d{2}:\d{2}:\d{2}\.\d+/u.test(row.PostDate ?? "")).length,
      expirySentinelRows: rows.filter((row) => row.EndTime === "0001-01-01T00:00:00" && row.EndTimeInt === 0).length,
      explicitLongTermRows: rows.filter((row) => row.Channel4IsLong === true).length, appliedDateFilter: null
    },
    terminalObservationStatus: terminal ? "REPORTED_ONLY_NOT_ARTIFACT_REPLAYED" : "MISSING", gaps
  };
}
