import { load } from "cheerio";
import { createHash } from "node:crypto";
import { classifyGileadPublicAge, exactGileadPublicAgePlan, GILEAD_PUBLIC_AGE_POLICY, GILEAD_YELLO_BOARD, gileadOfficialCities, type GileadPublicAgeClassification, type GileadPublicAgeEvidence } from "./gileadPublicAge";
import type { NormalizedJobRecord } from "./normalizedJob";
import type { SourceCrawlPlan } from "./sourcePlan";
import type { PersistentSourceFetchEvidence, SourceFetchArtifactDraft } from "./sourceFetchEvidence";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import {
  explicitlyForeignOrNonMainlandLocation,
  explicitlyGenericOrAmbiguousLocation,
  persistentOfficialJsonJobId
} from "./officialJsonEvidence";

export interface YelloJobBoardConfig {
  kind: "yello-job-board";
  boardId: string;
  locationFilterId: number;
  expectedLocationLabel: "China";
  publicAgePolicy: typeof GILEAD_PUBLIC_AGE_POLICY;
}

export interface ParsedYelloJob {
  officialId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  rawHtml: string;
  cities: string[];
  publicAgeRaw: string;
  publicAgeClassification: GileadPublicAgeClassification;
}

export class YelloPublicAgeError extends Error {
  constructor(readonly rawRows: string[], readonly rowIndex: number) {
    super(`GILEAD_PUBLIC_AGE_INVALID:row:${rowIndex}`);
    this.name = "YelloPublicAgeError";
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
  jobs: ParsedYelloJob[];
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
  const jobs = rows.map((element, rowIndex): ParsedYelloJob => {
    const row = $(element);
    const link = row.find("a.search-results__req_title");
    const locationSpans = row.find(".search-results__jobinfo > div > span");
    const flag = row.find(".search-results__flag img");
    if (link.length !== 1 || locationSpans.length < 1 || flag.length !== 1) {
      throw new Error("Yello result row structure is invalid");
    }
    const title = link.text().trim();
    const locationRaw = locationSpans.first().text().trim();
    const officialUrl = new URL(link.attr("href")?.trim() ?? "", "https://gilead.yello.co");
    const officialId = officialUrl.pathname.match(/^\/jobs\/([A-Za-z0-9_-]{22})$/u)?.[1];
    const query = [...officialUrl.searchParams.entries()];
    if (!title || !officialId || seen.has(officialId) || officialUrl.origin !== "https://gilead.yello.co" ||
        officialUrl.username || officialUrl.password || officialUrl.hash || query.length !== 1 || query[0]![0] !== "job_board_id" ||
        query[0]![1] !== config.boardId || flag.attr("alt") !== "China flag" ||
        flag.attr("src") !== "/assets/images/flags/cn.png" || !/^China - \S/u.test(locationRaw) ||
        explicitlyForeignOrNonMainlandLocation(locationRaw) ||
        explicitlyGenericOrAmbiguousLocation(locationRaw)) {
      throw new Error("Yello result row identity or China scope is invalid");
    }
    seen.add(officialId);
    const age = row.find(".search-results__post-time");
    const publicAgeRaw = age.text();
    const publicAgeClassification = classifyGileadPublicAge(publicAgeRaw);
    if (age.length !== 1 || age.children().length !== 0 || !publicAgeClassification) {
      throw new YelloPublicAgeError(rawRows, rowIndex);
    }
    return { officialId, title, officialUrl: officialUrl.toString(), locationRaw, rawHtml: rawRows[rowIndex]!,
      cities: gileadOfficialCities(locationRaw), publicAgeRaw, publicAgeClassification };
  });
  return { declaredTotal: count, jobs };
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
  const byId = new Map(parsed.jobs.map((row, index) => [persistentOfficialJsonJobId(row.officialId), yelloPublicAgeEvidence(row, index, artifact)]));
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
