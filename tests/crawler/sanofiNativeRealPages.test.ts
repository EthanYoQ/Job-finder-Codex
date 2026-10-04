import { readFileSync } from "node:fs";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { parseSanofiDetail } from "../../src/crawler/sanofiNativeQuality";

type SemanticFixture = {
  sourceVersion: "old" | "current";
  logicalKey: string;
  reqId: string;
  sourceJobId: string;
  url: string;
  expected: "ACCEPT" | "REJECT";
  reason: string;
  schemaNegativeTokens: string[];
  mainNegativeTokens: string[];
  semanticHtml: string;
};
// The two source cohorts are historical labels. These minimized cases contain
// synthetic JD text, not captured pages, current observations or evidence hashes.
const fixture = JSON.parse(readFileSync(
  "tests/fixtures/sanofi/main-identity-minimized-20261003.json", "utf8"
)) as { schemaVersion: number; purpose: string; records: SemanticFixture[] };
const parse = (r: SemanticFixture, html = r.semanticHtml) => parseSanofiDetail(html, r.url, r.sourceJobId);
const mainJd = "main#content .job-description.section7-details .ats-description";
const identityHeader = "main#content .ajd__jobheader-title h2, main#content .job-description.section7-title h1";
const negativeTokens = /\b(?:closed|no longer|not available|France|Canada|Germany|USA|Taiwan|Hong Kong|Singapore|Belgium|United States|Hungary|Hyderabad|Budapest|Brazil|Malaysia|India|Japan|Korea|Australia|Vietnam|Poland|Italy|Spain|United Kingdom)\b|岗位已关闭|职位已关闭|该职位已下线|香港|澳门|澳門|台湾|臺灣/giu;

describe("Sanofi minimized historical regression cases bind the main job identity", () => {
  it("retains every case without general JD prose or response commitments", () => {
    expect(fixture.schemaVersion).toBe(3);
    expect(fixture.purpose).toBe("MINIMIZED_DERIVED_REGRESSION_CASES_WITH_SYNTHETIC_JD_NOT_CAPTURED_PAGES_OR_PRODUCTION_EVIDENCE");
    expect(fixture.records).toHaveLength(83);
    expect(new Set(fixture.records.map(r => `${r.sourceVersion}:${r.logicalKey}`)).size).toBe(83);
    for (const r of fixture.records) {
      expect(Object.keys(r).sort()).toEqual([
        "expected", "logicalKey", "mainNegativeTokens", "reason", "reqId", "schemaNegativeTokens",
        "semanticHtml", "sourceJobId", "sourceVersion", "url"
      ]);
      const $ = load(r.semanticHtml);
      expect($('script:not([type="application/ld+json"]), input, iframe, style, link, meta, object, embed, noscript, template')).toHaveLength(0);
      expect($('script[type="application/ld+json"]')).toHaveLength(1);
      const allowedAttributes = new Set(["type", "id", "class", "href", "data-job-id", "data-selector-name", "data-apply-url"]);
      for (const node of $("*").toArray()) {
        expect(Object.keys(node.attribs).every(key => allowedAttributes.has(key))).toBe(true);
      }
      const schema = JSON.parse($('script[type="application/ld+json"]').html()!);
      const jd = $(mainJd);
      if (r.reason === "EXACT_STRUCTURAL_SITE_FOOTER") jd.children().slice(-3).remove();
      expect(jd.text().match(negativeTokens) ?? [], r.logicalKey).toEqual(r.mainNegativeTokens);
      expect(schema.description.match(negativeTokens) ?? [], r.logicalKey).toEqual(r.schemaNegativeTokens);
      expect(jd.text().replace(negativeTokens, "").replace(/Synthetic JD/gu, "").trim(), r.logicalKey).toBe("");
      const syntheticDescription = r.expected === "ACCEPT" ? jd.text()
        : `Synthetic schema ${r.reqId} ${r.schemaNegativeTokens.join(" ")}`;
      expect(schema.description, r.logicalKey).toBe(syntheticDescription);
    }
  });

  it("rejects all seven current and three prior mixed main JDs", () => {
    const conflicts = fixture.records.filter(r => r.expected === "REJECT");
    expect(conflicts.filter(r => r.sourceVersion === "current").map(r => r.reqId)).toEqual([
      "R2871653", "R2870383", "R2869555", "R2868616", "R2853650", "R2873268", "R2870770"
    ]);
    expect(conflicts.filter(r => r.sourceVersion === "old").map(r => r.reqId)).toEqual([
      "R2868616", "R2871203", "R2859520"
    ]);
    for (const r of conflicts) expect(parse(r), `${r.sourceVersion}:${r.logicalKey}`).toBeUndefined();
  });

  it("preserves independent JD and apply conflicts in every mixed case", () => {
    for (const r of fixture.records.filter(r => r.expected === "REJECT")) {
      const $ = load(r.semanticHtml);
      const schema = JSON.parse($('script[type="application/ld+json"]').html()!);
      $(identityHeader).text(schema.title);
      const buttons = $('main#content [data-selector-name="job-apply-link"]');
      const mismatchedApply = buttons.clone();
      buttons.attr("data-job-id", r.sourceJobId)
        .attr("href", `https://careersite.tupu360.com/sanofi/position/detail?exid=${r.reqId}`)
        .attr("data-apply-url", `https://careersite.tupu360.com/sanofi/position/detail?exid=${r.reqId}`);
      expect(parse(r, $.html()), `JD conflict: ${r.sourceVersion}:${r.logicalKey}`).toBeUndefined();
      $(mainJd).text(schema.description);
      expect(parse(r, $.html())?.reqId, `fully repaired: ${r.sourceVersion}:${r.logicalKey}`).toBe(r.reqId);
      buttons.each((index, node) => $(node).replaceWith(mismatchedApply.eq(index)));
      expect(parse(r, $.html()), `apply conflict: ${r.sourceVersion}:${r.logicalKey}`).toBeUndefined();
    }
  });

  it("accepts all 72 exact, structurally bounded site footer examples", () => {
    const originals = fixture.records.filter(r => r.reason === "EXACT_STRUCTURAL_SITE_FOOTER");
    expect(originals).toHaveLength(72);
    for (const r of originals) expect(parse(r)?.reqId, r.logicalKey).toBe(r.reqId);
  });

  it("distinguishes the coherent prior R2853650 page from the current mixed page", () => {
    const prior = fixture.records.find(r => r.sourceVersion === "old" && r.reqId === "R2853650")!;
    const current = fixture.records.find(r => r.sourceVersion === "current" && r.reqId === "R2853650")!;
    expect(parse(prior)).toMatchObject({ reqId: "R2853650", scope: "MAINLAND" });
    expect(parse(prior)?.applyUrl).toContain("/R2853650/c/");
    expect(parse(current)).toBeUndefined();
  });

  it.each(["changed text", "changed structure", "extra trailing job content"])(
    "rejects a site footer with %s", mutation => {
      for (const r of fixture.records.filter(r => r.reason === "EXACT_STRUCTURAL_SITE_FOOTER")) {
        const $ = load(r.semanticHtml), jd = $(mainJd);
        if (mutation === "changed text") jd.children().last().append(" This job is closed.");
        if (mutation === "changed structure") jd.children("p.italic-heading").removeAttr("class");
        if (mutation === "extra trailing job content") jd.append("<p>Another job in France</p>");
        expect(parse(r, $.html()), r.logicalKey).toBeUndefined();
      }
    }
  );
});
