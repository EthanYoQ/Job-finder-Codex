import { beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "cheerio";
import { htmlTableAdapter } from "../../src/crawler/adapters/htmlTable";
import type { HtmlTableAdapterInput } from "../../src/crawler/adapters/types";

vi.mock("cheerio", async importOriginal => {
  const original = await importOriginal<typeof import("cheerio")>();
  return { ...original, load: vi.fn(original.load) };
});

const source = {
  id: "source-document-reuse-social", companyId: "company-document-reuse", kind: "SOCIAL",
  atsKind: "OFFICIAL_HTML", officialEntryUrl: "https://example.com/careers", status: "VERIFIED_SCRAPABLE"
} as const;
function input(prefix: string, count: number): HtmlTableAdapterInput {
  return {
    company: { id: source.companyId, officialChineseName: "示例制药有限公司" }, source,
    capturedAt: "2026-10-07T00:00:00.000Z",
    html: `<nav>${"<span>Unrelated navigation</span>".repeat(2000)}</nav><table><tbody>${Array.from({ length: count }, (_, i) =>
      `<tr data-id="${prefix}-${i}"><td><a href="/jobs/${prefix}-${i}">${prefix} job ${i}</a></td><td class="location">Shanghai (Shanghai)</td></tr>`).join("")}</tbody></table>`,
    table: { rowSelector: "table tbody tr", fields: {
      sourceJobId: { selector: ":scope", attribute: "data-id" },
      officialTitle: { selector: "td a" }, officialUrl: { selector: "td a", attribute: "href" },
      locationRaw: { selector: "td.location" }
    } }
  };
}

beforeEach(() => { vi.mocked(load).mockClear(); });
describe("HTML adapter bounded document allocation", () => {
  it("parses the paginated document once while preserving every row and its own fields", () => {
    const fixture = input("first", 155), original = fixture.html;
    const result = htmlTableAdapter.extract(fixture);
    expect(result.status).toBe("SUCCESS");
    expect(result.jobs).toHaveLength(155);
    expect(result.jobs.map(job => [job.sourceJobId, job.officialTitle, job.officialUrl])).toEqual(
      Array.from({ length: 155 }, (_, i) => [`first-${i}`, `first job ${i}`, `https://example.com/jobs/first-${i}`])
    );
    expect(result.reconciliation).toMatchObject({ rawInputCount: 155, dedupeOutputCount: 155 });
    expect(fixture.html).toBe(original);
    // This resource contract catches the previous per-row full-document parse.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps repeated extraction documents independent and retains validation losses", () => {
    const first = htmlTableAdapter.extract(input("first", 2));
    const next = input("next", 2);
    next.html = next.html.replace("next job 1", "");
    const second = htmlTableAdapter.extract(next);
    expect(first.jobs.map(job => job.sourceJobId)).toEqual(["first-0", "first-1"]);
    expect(second.jobs.map(job => job.sourceJobId)).toEqual(["next-0"]);
    expect(second.reconciliation?.adapterLosses).toEqual([{ stage: "VALIDATION", reason: "TITLE_INVALID", rawIndex: 1 }]);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
