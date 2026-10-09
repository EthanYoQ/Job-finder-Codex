import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { parseSanofiDetail } from "../../src/crawler/sanofiNativeQuality";

type SemanticFixture = {
  version: "old" | "current";
  logicalKey: string;
  reqId: string;
  sourceJobId: string;
  url: string;
  originalCapturedAt: string;
  originalBodySha256: string;
  derivedBodySha256: string;
  expected: "ACCEPT" | "REJECT";
  reason: string;
  semanticHtml: string;
};
const fixture = JSON.parse(gunzipSync(readFileSync(
  "tests/fixtures/sanofi/main-identity-semantics-20261003.json.gz"
)).toString("utf8")) as { records: SemanticFixture[] };
const parse = (r: SemanticFixture, html = r.semanticHtml) => parseSanofiDetail(html, r.url, r.sourceJobId);

describe("Sanofi safe semantic fixtures bind the main job identity", () => {
  it("verifies derived bytes and original commitments without retaining raw responses", () => {
    expect(fixture.records).toHaveLength(83);
    for (const r of fixture.records) {
      expect(r.originalBodySha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(createHash("sha256").update(r.semanticHtml).digest("hex"), r.logicalKey).toBe(r.derivedBodySha256);
      expect(r.derivedBodySha256).not.toBe(r.originalBodySha256);
      const $ = load(r.semanticHtml);
      expect($('script:not([type="application/ld+json"]), input, iframe, style, link, meta, object, embed, noscript, template')).toHaveLength(0);
      expect($('script[type="application/ld+json"]')).toHaveLength(1);
      const allowedAttributes = new Set(["type", "id", "class", "href", "data-job-id", "data-selector-name", "data-apply-url"]);
      for (const node of $("*").toArray()) {
        expect(Object.keys(node.attribs).every(key => allowedAttributes.has(key))).toBe(true);
      }
    }
  });

  it("rejects all seven current and three prior mixed main JDs", () => {
    const conflicts = fixture.records.filter(r => r.expected === "REJECT");
    expect(conflicts.filter(r => r.version === "current")).toHaveLength(7);
    expect(conflicts.filter(r => r.version === "old")).toHaveLength(3);
    for (const r of conflicts) expect(parse(r), `${r.version}:${r.logicalKey}`).toBeUndefined();
  });

  it("accepts all 72 exact, structurally bounded site footer examples", () => {
    const originals = fixture.records.filter(r => r.reason === "EXACT_STRUCTURAL_SITE_FOOTER");
    expect(originals).toHaveLength(72);
    for (const r of originals) expect(parse(r)?.reqId, r.logicalKey).toBe(r.reqId);
  });

  it("distinguishes the coherent prior R2853650 page from the current mixed page", () => {
    const prior = fixture.records.find(r => r.version === "old" && r.reqId === "R2853650")!;
    const current = fixture.records.find(r => r.version === "current" && r.reqId === "R2853650")!;
    expect(parse(prior)).toMatchObject({ reqId: "R2853650", scope: "MAINLAND" });
    expect(parse(prior)?.applyUrl).toContain("/R2853650/c/");
    expect(parse(current)).toBeUndefined();
  });

  it.each(["changed text", "changed structure", "extra trailing job content"])(
    "rejects a site footer with %s", mutation => {
      const r = fixture.records.find(r => r.reason === "EXACT_STRUCTURAL_SITE_FOOTER")!;
      const $ = load(r.semanticHtml), jd = $("main#content .job-description.section7-details .ats-description");
      if (mutation === "changed text") jd.children().last().append(" This job is closed.");
      if (mutation === "changed structure") jd.children("p.italic-heading").removeAttr("class");
      if (mutation === "extra trailing job content") jd.append("<p>Another job in France</p>");
      expect(parse(r, $.html())).toBeUndefined();
    }
  );
});
