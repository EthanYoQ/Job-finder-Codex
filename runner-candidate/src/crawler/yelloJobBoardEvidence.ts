import { load } from "cheerio";
import { createHash } from "node:crypto";
import { classifyGileadPublicAge, exactGileadPublicAgePlan, GILEAD_PUBLIC_AGE_POLICY, GILEAD_YELLO_BOARD, gileadOfficialCities, type GileadPublicAgeClassification, type GileadPublicAgeEvidence } from "./gileadPublicAge";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceCrawlPlan } from "./sourcePlan";
import {sanitizeEvidenceHttpUrl,type PersistentSourceFetchEvidence,type SourceFetchArtifactDraft} from './sourceFetchEvidence';
import {type JobQuarantine} from './jobQuarantine';
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import {
  explicitlyForeignOrNonMainlandLocation,
  explicitlyGenericOrAmbiguousLocation,
  persistentOfficialJsonJobId,
  officialJsonRawLocator
} from "./officialJsonEvidence";
import {irreversibleOfficialJsonEvidenceId} from './officialJsonEvidence';

export interface YelloJobBoardConfig {
  kind: "yello-job-board";
  boardId: string;
  locationFilterId: number;
  expectedLocationLabel: "China";
  publicAgePolicy: typeof GILEAD_PUBLIC_AGE_POLICY;
}

interface ParsedYelloIdentity {
  rowIndex: number;
  officialId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  rawHtml: string;
  publicAgeRaw: string;
}
export interface ParsedYelloJob extends ParsedYelloIdentity {
  scopeDecision: "INCLUDED_MAINLAND";
  cities: string[];
  publicAgeClassification: GileadPublicAgeClassification;
}
export interface ParsedYelloExcludedJob extends ParsedYelloIdentity {
  scopeDecision: "EXCLUDED_HONG_KONG";
  publicAgeStatus: "NOT_EVALUATED_OUT_OF_SCOPE";
}
export interface ParsedYelloQuarantinedJob{
  scopeDecision:'QUARANTINED';rowIndex:number;rawHtml:string;code:string;officialId?:string;officialUrl?:string;
}
function rowIdentity(row:ReturnType<ReturnType<typeof load>>,config:YelloJobBoardConfig):{officialId:string;officialUrl:string}|undefined{
  try{const link=row.find('a.search-results__req_title');if(link.length!==1)return undefined;
    const url=new URL(link.attr('href')?.trim()??'','https://gilead.yello.co'),id=/^\/jobs\/([A-Za-z0-9_-]{22})$/u.exec(url.pathname)?.[1],query=[...url.searchParams];
    return id&&url.origin==='https://gilead.yello.co'&&!url.username&&!url.password&&!url.hash&&query.length===1&&query[0]![0]==='job_board_id'&&query[0]![1]===config.boardId?{officialId:id,officialUrl:url.href}:undefined;
  }catch{return undefined;}
}
export function yelloJobQuarantine(row:ParsedYelloQuarantinedJob):JobQuarantine{
 return {pageSequence:0,recordIndex:row.rowIndex,rawLocator:officialJsonRawLocator(row.rawHtml,row.rowIndex),code:row.code,
  validJobId:row.officialId?irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(row.officialId)):`unidentified:0:${row.rowIndex}`,
  ...(row.officialId?{sourceJobId:persistentOfficialJsonJobId(row.officialId)}:{}),...(row.officialUrl?{officialUrl:sanitizeEvidenceHttpUrl(row.officialUrl)}:{})};
}

export class YelloScopeReviewError extends Error {
  constructor(readonly rawRows: string[], readonly rowIndex: number) {
    super(`GILEAD_SCOPE_REVIEW_REQUIRED:row:${rowIndex}`);
    this.name = "YelloScopeReviewError";
  }
}

export function yelloJobBoardBinding(entryUrl: string, config: YelloJobBoardConfig): {
  entryUrl: string;
  endpointUrl: string;
  extractorLocator: string;
} {
  const entry = new URL(entryUrl);
  if (entry.origin !== "https://gilead.yello.co" || entry.search || entry.hash ||
      entry.pathname !== `/job_boards/${config.boardId}` ||
      config.boardId !== GILEAD_YELLO_BOARD || config.locationFilterId !== 72 ||
      config.publicAgePolicy !== GILEAD_PUBLIC_AGE_POLICY || config.expectedLocationLabel !== "China" ||
      !exactKeys(config as unknown as Record<string, unknown>, ["kind", "boardId", "locationFilterId", "expectedLocationLabel", "publicAgePolicy"])) throw new Error("Yello source configuration is invalid");
  const endpoint = new URL(`${entry.pathname}/search`, entry.origin);
  endpoint.searchParams.set("query", "");
  endpoint.searchParams.set("filters", String(config.locationFilterId));
  return { entryUrl: entry.toString(), endpointUrl: endpoint.toString(),
    extractorLocator: `yello-job-board-v2|board:${config.boardId}|location-filter:${config.locationFilterId}|public-age:${config.publicAgePolicy}` };
}

export function parseYelloJobBoardResponse(body: string, config: YelloJobBoardConfig): {
  declaredTotal: number;
  rows: Array<ParsedYelloJob | ParsedYelloExcludedJob|ParsedYelloQuarantinedJob>;
  jobs: ParsedYelloJob[];
  excludedJobs: ParsedYelloExcludedJob[];
  quarantinedJobs:ParsedYelloQuarantinedJob[];
} {
  yelloJobBoardBinding(`https://gilead.yello.co/job_boards/${GILEAD_YELLO_BOARD}`, config);
  if (!hasUniqueJsonObjectKeys(body)) throw new Error("Yello response is not strict JSON");
  const root = JSON.parse(body) as unknown;
  if (!isRecord(root) || !exactKeys(root, ["html", "count_on_page", "more_requisitions", "query",
    "filters", "text_filters", "display_count_text"]) || typeof root.html !== "string" ||
      !nonnegativeInteger(root.count_on_page)) throw new Error("Yello response schema is invalid");
  const count = root.count_on_page;
  const expectedDisplay = count === 1 ? "1 Result" : `${String(count)} Results`;
  if (root.more_requisitions !== false || root.query !== "" || root.display_count_text !== expectedDisplay ||
      !exactLocationFilter(root.filters, config) || !exactEmptyJsonArray(root.text_filters)) {
    throw new Error("Yello China partition declaration is invalid");
  }
  const $ = load(root.html);
  const rows = $("li.search-results__item").toArray();
  if (rows.length !== count) throw new Error("Yello result count does not match rendered rows");
  const seen = new Set<string>();
  const rawRows = rows.map(element => $.html(element));
  const parsedRows = rows.map((element, rowIndex): ParsedYelloJob | ParsedYelloExcludedJob|ParsedYelloQuarantinedJob => {
    const row = $(element);
    const bound=rowIdentity(row,config);
    if(bound){if(seen.has(bound.officialId))throw Error('YELLO_DUPLICATE_OFFICIAL_ID');seen.add(bound.officialId);}
    try{
    const link = row.find("a.search-results__req_title");
    const jobInfo = row.find(".search-results__jobinfo");
    const locationContainer = jobInfo.children("div");
    const locationSpans = locationContainer.children("span");
    const flag = row.find(".search-results__flag img");
    if (link.length !== 1 || jobInfo.length !== 1 || locationContainer.length !== 1 || locationSpans.length < 1) {
      throw new Error("Yello result row structure is invalid");
    }
    const title = link.text().trim();
    const locationRaw = locationSpans.first().text().trim();
    if(!title||!bound)throw new Error('Yello result identity or title is invalid');
    const {officialId,officialUrl}=bound;
    const age = row.find(".search-results__post-time");
    const publicAgeRaw = age.text();
    const identity = { rowIndex, officialId, title, officialUrl, locationRaw,
      rawHtml: rawRows[rowIndex]!, publicAgeRaw };
    // Only this exact, mutually consistent location/flag pair is a proven exclusion.
    // A China filter is not a mainland guarantee; unresolved rows retain prior data.
    if (locationRaw === "China - Hong Kong" && flag.attr("alt") === "Hong Kong flag" &&
        flag.attr("src") === "/assets/images/flags/hk.png" && locationSpans.length === 3 &&
        locationSpans.toArray().every(span => $(span).children().length === 0)) {
      // The location container and flag establish the exclusion, not age/CSS decoration.
      if (row.find('img[alt$="flag"]').length !== 1 || locationContainer.length !== 1) throw new YelloScopeReviewError(rawRows, rowIndex);
      const extraContent = row.clone();
      extraContent.find(".search-results__flag, .search-results__jobinfo, .search-results__post-time").remove();
      const locationMarker = /\b(?:location|country|city)\b/iu;
      const locationClassToken = /(?:^|[\s_-])location(?:[\s_-]|$)|(?:^|[\s_-])(?:country|city)(?=\s|$)/iu;
      const additionalLocation = extraContent.find("*").addBack().toArray().some(node => "attribs" in node && Object.entries(node.attribs).some(([name, value]) =>
        locationMarker.test(name) || ["class", "role"].includes(name) && locationClassToken.test(value)));
      if (additionalLocation || /\bChina\s*-\s*\S/iu.test(extraContent.text())) throw new YelloScopeReviewError(rawRows, rowIndex);
      return { ...identity, scopeDecision: "EXCLUDED_HONG_KONG", publicAgeStatus: "NOT_EVALUATED_OUT_OF_SCOPE" };
    }
    if (!/^China - \S/u.test(locationRaw) || explicitlyForeignOrNonMainlandLocation(locationRaw) ||
        explicitlyGenericOrAmbiguousLocation(locationRaw)) {
      throw new YelloScopeReviewError(rawRows, rowIndex);
    }
    const publicAgeClassification = classifyGileadPublicAge(publicAgeRaw);
    return { ...identity, scopeDecision: "INCLUDED_MAINLAND", cities: gileadOfficialCities(locationRaw), publicAgeClassification };
    }catch(error){return {scopeDecision:'QUARANTINED',rowIndex,rawHtml:rawRows[rowIndex]!,code:error instanceof YelloScopeReviewError?'GILEAD_JOB_SCOPE_UNRESOLVED':'GILEAD_JOB_ROW_UNVERIFIED',...(bound??{})};}
  });
  return { declaredTotal: count, rows: parsedRows,
    jobs: parsedRows.filter((row): row is ParsedYelloJob => row.scopeDecision === "INCLUDED_MAINLAND"),
    excludedJobs: parsedRows.filter((row): row is ParsedYelloExcludedJob => row.scopeDecision === "EXCLUDED_HONG_KONG"),
    quarantinedJobs:parsedRows.filter((row):row is ParsedYelloQuarantinedJob=>row.scopeDecision==='QUARANTINED') };
}

/** The original artifact retains the official ID, full row and unclassified age.
 * The loss locator binds that complete row at its original position, never a compacted index. */
export function yelloScopeExclusionLoss(row: ParsedYelloExcludedJob,
  artifact: Pick<SourceFetchArtifactDraft, "capturedAt">): PersistentSourceFetchEvidence["fetchLosses"][number] {
  return { stage: "VALIDATION", reason: "Yello row is explicitly outside mainland China scope",
    rawLocator: officialJsonRawLocator(row.rawHtml, row.rowIndex),
    details: { code: "GILEAD_VERIFIED_HONG_KONG_ONLY", field: "location", pageSequence: 0,
      recordIndex: row.rowIndex, noteCode: "PUBLIC_AGE_NOT_EVALUATED_OUT_OF_SCOPE" },
    recordedAt: artifact.capturedAt };
}

export function yelloPublicAgeEvidence(row: ParsedYelloJob, rowIndex: number, artifact: Pick<SourceFetchArtifactDraft, "logicalKey" | "capturedAt">): GileadPublicAgeEvidence {
  return {policy: GILEAD_PUBLIC_AGE_POLICY, rawLabel: row.publicAgeRaw, classification: row.publicAgeClassification,
    exactDateStatus: "UNKNOWN", timeWindowStatus: "TIME_WINDOW_UNAVAILABLE", capturedAt: artifact.capturedAt,
    artifactLogicalKey: artifact.logicalKey, rowLocator: `$.html|li.search-results__item[${rowIndex}]|.search-results__post-time`,
    rowSha256: createHash("sha256").update(row.rawHtml, "utf8").digest("hex")};
}

/** Enrich only evidence. The independent strict gate still compares every normalized identity field. */
export function attachYelloPublicAgeEvidence(plan: SourceCrawlPlan, evidence: PersistentSourceFetchEvidence | undefined, jobs: NormalizedJobRecord[]): void {
  if (!exactGileadPublicAgePlan(plan) || plan.adapterId !== "official-json" || plan.officialJsonFetch?.kind !== "yello-job-board" || !evidence || evidence.artifacts.length !== 1) return;
  const artifact = evidence.artifacts[0]!;
  const parsed = parseYelloJobBoardResponse(typeof artifact.body === "string" ? artifact.body : Buffer.from(artifact.body).toString("utf8"), plan.officialJsonFetch);
  const byId = new Map(parsed.jobs.map(row => [persistentOfficialJsonJobId(row.officialId), yelloPublicAgeEvidence(row, row.rowIndex, artifact)]));
  for (const job of jobs) {
    const age = job.sourceJobId && byId.get(job.sourceJobId);
    if (age) job.evidence.gileadPublicAge = age;
  }
}

function exactLocationFilter(value: unknown, config: YelloJobBoardConfig): boolean {
  if (typeof value !== "string" || !hasUniqueJsonObjectKeys(value)) return false;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0]) ||
        !exactKeys(parsed[0], ["label", "id", "has_conditions", "answers", "answer_type"]) ||
        parsed[0].label !== "Locations" || !nonnegativeInteger(parsed[0].id) ||
        parsed[0].has_conditions !== false || parsed[0].answer_type !== "multiple_select" ||
        !Array.isArray(parsed[0].answers) || parsed[0].answers.length !== 1 ||
        !isRecord(parsed[0].answers[0]) || !exactKeys(parsed[0].answers[0], ["id", "label"])) return false;
    return parsed[0].answers[0].id === config.locationFilterId &&
      parsed[0].answers[0].label === config.expectedLocationLabel;
  } catch { return false; }
}

function exactEmptyJsonArray(value: unknown): boolean {
  if (typeof value !== "string" || !hasUniqueJsonObjectKeys(value)) return false;
  try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) && parsed.length === 0; }
  catch { return false; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}
function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
