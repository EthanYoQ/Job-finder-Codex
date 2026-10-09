import { load } from "cheerio";

export const GRIFOLS_POSTED_DATE_POLICY = "GRIFOLS_LIST_DETAIL_UTC_POSTED_V1" as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Exact official English grammars. No local timezone, inferred clock, or temporal eligibility test. */
export function grifolsOfficialPostedDate(listLabels: readonly string[], detailHtml: string): string | undefined {
  if (listLabels.length === 0 || new Set(listLabels).size !== 1) return undefined;
  const list = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([1-9]|[12]\d|3[01]), (\d{4})$/u.exec(listLabels[0]!);
  const $ = load(detailHtml);
  const metadata = $(".jobDisplayShell meta[itemprop='datePosted']");
  if (!list || metadata.length !== 1) return undefined;
  const detail = /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC (\d{4})$/u.exec(metadata.attr("content") ?? "");
  if (!detail) return undefined;
  const month = MONTHS.indexOf(detail[2]!);
  const [day, hour, minute, second, year] = detail.slice(3).map(Number);
  if (!year || list[1] !== detail[2] || Number(list[2]) !== day || Number(list[3]) !== year) return undefined;
  const date = new Date(0);
  date.setUTCFullYear(year!, month, day);
  date.setUTCHours(hour!, minute, second, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day ||
    date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second ||
    WEEKDAYS[date.getUTCDay()] !== detail[1]) return undefined;
  return date.toISOString();
}
