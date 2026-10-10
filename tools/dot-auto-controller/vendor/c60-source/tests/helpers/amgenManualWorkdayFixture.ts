import { amgenFixture, AMGEN_TIME } from "./amgenNativeFixture";

export const AMGEN_LOOKUP_ENDPOINT = "https://amgen.wd1.myworkdayjobs.com/wday/cxs/amgen/Careers/jobs";
export const AMGEN_CHINA_ID = "6cb77610a8a543aea2d6bc10457e35d4";
export const AMGEN_MANUAL_WORKDAY_CONFIG = {
  policy: "AMGEN_MANUAL_WORKDAY_LOOKUP_V2", pageSize: 12, maxPages: 30, lookupPageSize: 20, lookupMaxPages: 30
} as const;

/** The complete manual source is the denominator; the two catalogue-only jobs never enter it. */
export function amgenManualWorkdayFixture(total = 13) {
  const native = amgenFixture(total), catalogue = amgenFixture(total + 2).rows;
  const lookupRows = catalogue.map(row => ({
    title: row.title, externalPath: row.path, locationsText: "China - Shanghai", postedOn: "Posted 7 Days Ago", bulletFields: [row.req]
  }));
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  const lookupPage = (offset: number) => ({
    total: offset === 0 ? lookupRows.length : 0,
    jobPostings: lookupRows.slice(offset, offset + 20),
    facets: [{ facetParameter: "LocationCountry", descriptor: "Country", values: [{ descriptor: "China", id: AMGEN_CHINA_ID, count: lookupRows.length }] }]
  });
  async function http(request: { url: string; method: string; body?: string }) {
    requests.push(request);
    if (request.url === AMGEN_LOOKUP_ENDPOINT && request.method === "POST") {
      return { status: 200, finalUrl: request.url, contentType: "application/json", capturedAt: AMGEN_TIME, body: JSON.stringify(lookupPage(JSON.parse(request.body!).offset)) };
    }
    return native.http(request);
  }
  return { ...native, requests, http, lookupRows, lookupPage, catalogueOnlyRows: catalogue.slice(total) };
}
