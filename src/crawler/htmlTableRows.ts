import type { CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { HtmlTableConfig } from "./adapters/types";

export function selectHtmlTableRows(
  $: CheerioAPI,
  table: HtmlTableConfig
): AnyNode[] {
  const candidates = $(table.rowSelector).toArray();
  const filter = table.rowFilter;
  if (!filter) return candidates;
  const pattern = new RegExp(filter.pattern, "u");
  return candidates.filter((row) => {
    const value = $(row).find(filter.selector).first().text().replace(/\s+/gu, " ").trim();
    return pattern.test(value);
  });
}

export function htmlTableRowFilterCoversCompletenessUniverse(
  $: CheerioAPI,
  table: HtmlTableConfig
): boolean {
  return table.rowFilter?.requireAllCandidatesForCompleteness !== true ||
    selectHtmlTableRows($, table).length === $(table.rowSelector).length;
}
