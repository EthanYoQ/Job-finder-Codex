import { load } from "cheerio";
import { hasUniqueJsonObjectKeys } from "./strictJsonObjectKeys";
import {
  explicitlyForeignOrNonMainlandLocation,
  explicitlyGenericOrAmbiguousLocation
} from "./officialJsonEvidence";

export interface YelloJobBoardConfig {
  kind: "yello-job-board";
  boardId: string;
  locationFilterId: number;
  expectedLocationLabel: "China";
}

export interface ParsedYelloJob {
  officialId: string;
  title: string;
  officialUrl: string;
  locationRaw: string;
  rawHtml: string;
}

export function yelloJobBoardBinding(entryUrl: string, config: YelloJobBoardConfig): {
  entryUrl: string;
  endpointUrl: string;
  extractorLocator: string;
} {
  const entry = new URL(entryUrl);
  if (entry.origin !== "https://gilead.yello.co" || entry.search || entry.hash ||
      entry.pathname !== `/job_boards/${config.boardId}` ||
      !/^[A-Za-z0-9_-]{22}$/u.test(config.boardId) ||
      !Number.isSafeInteger(config.locationFilterId) || config.locationFilterId <= 0 ||
      config.expectedLocationLabel !== "China") throw new Error("Yello source configuration is invalid");
  const endpoint = new URL(`${entry.pathname}/search`, entry.origin);
  endpoint.searchParams.set("query", "");
  endpoint.searchParams.set("filters", String(config.locationFilterId));
  return { entryUrl: entry.toString(), endpointUrl: endpoint.toString(),
    extractorLocator: `yello-job-board-v1|board:${config.boardId}|location-filter:${config.locationFilterId}` };
}

export function parseYelloJobBoardResponse(body: string, config: YelloJobBoardConfig): {
  declaredTotal: number;
  jobs: ParsedYelloJob[];
} {
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
  const jobs = rows.map((element): ParsedYelloJob => {
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
        officialUrl.hash || query.length !== 1 || query[0]![0] !== "job_board_id" ||
        query[0]![1] !== config.boardId || flag.attr("alt") !== "China flag" ||
        flag.attr("src") !== "/assets/images/flags/cn.png" || !/^China - \S/u.test(locationRaw) ||
        explicitlyForeignOrNonMainlandLocation(locationRaw) ||
        explicitlyGenericOrAmbiguousLocation(locationRaw)) {
      throw new Error("Yello result row identity or China scope is invalid");
    }
    seen.add(officialId);
    return { officialId, title, officialUrl: officialUrl.toString(), locationRaw, rawHtml: $.html(element) };
  });
  return { declaredTotal: count, jobs };
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
