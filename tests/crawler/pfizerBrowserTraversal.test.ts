import { pfizerDomPacketsToPages } from "../../src/crawler/pfizerRenderedTraversal";
import { describe, expect, it } from "vitest";
import { createOfficialJsonRenderedTraversalValidation, issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { replayOfficialJsonRenderedTraversal } from "../../src/crawler/officialJsonRenderedTraversalValidator";
import { irreversibleOfficialJsonEvidenceId } from "../../src/crawler/officialJsonEvidence";
import { createHash } from "node:crypto";
const sourceId = "source-pfizer-china-social" as any;
const officialId = "4964772", externalPath = "/job/India---Mumbai/Marketing_4964772-1";
const sourceJobId = `workday:sha256:${createHash("sha256").update(externalPath).digest("hex")}`;
function page() { return { channelId: "source:source-pfizer-china-social:default", pageNumber: 1, declaredTotalPages: 1, declaredTotalJobs: 1, uiRequestCandidateIds: [], nextControlPresent: false, rawRows: [{ sourceJobId, rawEvidenceId: irreversibleOfficialJsonEvidenceId(officialId), scopeMarker: "India", scopeDecision: "EXCLUDED_AUDITED" as const, recordIndex: 0, rawPayload: { listPage:{url:"https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=6cb77610a8a543aea2d6bc10457e35d4",title:"Search for Jobs",countryFilter:"China clear filter",filterCount:1,searchText:"",pageLabel:"Page 1 of 1",range:"1 - 1 of 1 jobs",totalText:"1 JOBS FOUND",nextControlPresent:false,capturedAt:"2026-10-02T16:00:00.000Z"}, capturedAt: "2026-10-02T16:00:00.000Z", officialId, externalPath, title: "Marketing", detailUrl: "https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers" + externalPath + "?Location_Country=6cb77610a8a543aea2d6bc10457e35d4", renderedTitle: "Marketing", renderedId: officialId, renderedLocations: ["India - Mumbai", "APAC - Any Pfizer Site"], applyEnabled: true, jsonLd: JSON.stringify({ "@type": "JobPosting", identifier: { value: officialId }, title: "Marketing", description: "Official responsibilities and requirements ".repeat(5), jobLocation: { address: { addressCountry: "India", addressLocality: "IND - Mumbai" } }, datePosted: "2026-10-02" }) } }] }; }
describe("Pfizer independent official UI replay", () => {
    it("replays India from official JSON-LD and all rendered posting locations", () => { const result = replayOfficialJsonRenderedTraversal(sourceId, [page()]); expect(result.excludedCount).toBe(1); expect(result.rawEvidenceIds).toEqual([irreversibleOfficialJsonEvidenceId(officialId)]); });
    it("preserves raw fields while comparing rendered whitespace and JSON-LD entities", () => {
      const p=page();const r=p.rawRows[0]!;r.rawPayload.title="Marketing &  Operations";r.rawPayload.renderedTitle="Marketing & Operations";
      const ld=JSON.parse(r.rawPayload.jsonLd);ld.title="Marketing &amp; Operations";r.rawPayload.jsonLd=JSON.stringify(ld);
      r.rawPayload.listPage.range += " ";
      expect(replayOfficialJsonRenderedTraversal(sourceId,[p]).excludedCount).toBe(1);
    });
    it("wraps observed DOM packets without accepting any main-crawl input", () => {
      const existing = page(), payload = existing.rawRows[0]!.rawPayload;
      const pages = pfizerDomPacketsToPages([{listPage:payload.listPage,rows:[payload]}]);
      expect(replayOfficialJsonRenderedTraversal(sourceId,pages).excludedCount).toBe(1);
      const bad = structuredClone(payload);bad.listPage.countryFilter = "India clear filter";
      expect(()=>pfizerDomPacketsToPages([{listPage:bad.listPage,rows:[bad]}])).toThrow();
    });
    it.each(["country", "identity", "dom", "apply"])("rejects %s evidence contradictions", kind => { const p = page(); const raw = p.rawRows[0]!.rawPayload; if (kind === "country")
        raw.jsonLd = raw.jsonLd.replace('"India"', '"Unknown"'); if (kind === "identity")
        raw.officialId = "1234567"; if (kind === "dom")
        raw.renderedLocations = ["China - Beijing - Beijing"]; if (kind === "apply")
        raw.applyEnabled = false; expect(() => replayOfficialJsonRenderedTraversal(sourceId, [p])).toThrow(); });
    it("rejects a missing end or wrong denominator", () => { const p = page(); p.nextControlPresent = true; expect(() => replayOfficialJsonRenderedTraversal(sourceId, [p])).toThrow(); p.nextControlPresent = false; p.declaredTotalJobs = 2; expect(() => replayOfficialJsonRenderedTraversal(sourceId, [p])).toThrow(); });
});
