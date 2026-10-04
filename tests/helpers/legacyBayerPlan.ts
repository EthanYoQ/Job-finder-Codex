import type { SourceCrawlPlan } from "../../src/crawler/sourcePlan";
import { buildStagedSourceCrawlPlans } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
/** Archived SuccessFactors policy remains inspectable, but cannot be issued as the current Moka configuration. */
export function legacyBayerPlan(): Extract<SourceCrawlPlan, { adapterId: "html-table" }> {
  const current = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-bayer-healthcare-social")!;
  if (!current.expectedChannels || !current.expectedChannelSetHash) throw new Error("Expected a channel-bound staged Bayer plan");
  return { adapterId: "html-table", company: current.company, executionAuthority: "STAGED",
    expectedChannels: current.expectedChannels, expectedChannelSetHash: current.expectedChannelSetHash,
    transportPolicy: { primary: "DIRECT_HTTP" }, source: { ...current.source, atsKind: "SUCCESSFACTORS",
      officialEntryUrl: "https://jobs.bayer.com/search/?q=&locationsearch=China&locale=zh_CN" }, table: TABLE };
}
const TABLE: Extract<SourceCrawlPlan, { adapterId: "html-table" }>["table"] = {
              rowSelector: "body:not(:has(label .attention.securitySearchString)) #searchresults tbody tr",
              completenessProof: {
                  kind: "OFFICIAL_TOTAL_PAGES",
                  sourcePolicy: "BAYER_CHINA_SUCCESSFACTORS_V1"
              },
              pagination: {
                  totalPagesSelector: "#searchresults[aria-label]",
                  totalPagesAttribute: "aria-label",
                  totalPagesPattern: "共\\s*([1-9]\\d*)\\s*页",
                  pageSearchParam: "startrow",
                  pageSearchParamMode: "offset",
                  pageSize: 10,
                  maxPages: 100,
                  expectedJobCountSelector: ".paginationLabel",
                  expectedJobCountPattern: "\\s*(\\d+)\\s*$",
                  explicitEmptyState: {
                      selector: "label:has(.attention.securitySearchString)",
                      pattern: "^当前没有符合\\s*[\"“]?China[\"”]?\\s*的空缺职位。?$"
                  }
              },
              fields: {
                  officialTitle: { selector: ".jobTitle.hidden-phone a.jobTitle-link" },
                  officialUrl: {
                      selector: ".jobTitle.hidden-phone a.jobTitle-link",
                      attribute: "href"
                  },
                  locationRaw: { selector: "td.colLocation" }
              }
          };
