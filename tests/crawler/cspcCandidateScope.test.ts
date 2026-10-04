import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createOfficialJsonSourceFetch, type OfficialJsonHttpRequest } from "../../src/crawler/officialJsonSourceFetch";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { createOfficialJsonRenderedTraversalValidation, issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
import { irreversibleOfficialJsonEvidenceId } from "../../src/crawler/officialJsonEvidence";
import { redseaCandidateListHtml } from "./helpers/redseaCandidates";
const fixture = JSON.parse(readFileSync("src/crawler/fixtures/cspc-candidate-scope-20261001.json", "utf8")) as {
  requestIdEncoded: string; candidateIds: string[]; returnedRows: Array<{ REQUEST_ID: string; PUBLISH_NAME: string; work_place: string }>;
};
const NOW = "2026-10-01T15:20:00.000Z";
const plan = getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-cspc-social")!;
async function capture(html = `<script>var requestId = '${fixture.requestIdEncoded}';</script>`, rows = fixture.returnedRows) {
  return createOfficialJsonSourceFetch({ now: () => new Date(NOW), http: async (request: OfficialJsonHttpRequest) => {
    const isApi = request.url.includes("queryPostList.mob");
    return { status: 200, finalUrl: request.url, contentType: isApi ? "application/json" : "text/html", capturedAt: NOW,
      body: isApi ? JSON.stringify({ state: "1", total: "", jsonList: rows }) : request.url.includes("officePage.mob") ? html : "<html>entry</html>" };
  }})(plan);
}
function ledger(result: Awaited<ReturnType<typeof capture>>) {
  const artifact = result.fetchEvidence?.artifacts.find(a => a.logicalKey.endsWith("-candidate-scope"));
  expect(artifact).toBeDefined();
  return JSON.parse(String(artifact!.body));
}
describe("CSPC configured candidate accounting", () => {
  it("retains 31 current rows and six unknown candidates without treating query inputs as an official total", async () => {
    const result = await capture();
    expect(result).toMatchObject({ ok: true, completeness: { completenessStatus: "VERIFIED" },
      fetchEvidence: { fetchCounts: { rawCount: 31, parsedCount: 31, validCount: 31, parseDiscardCount: 0, validationDiscardCount: 0 }, pages: [{ termination: "NEXT_ABSENT" }] },
      paginationEvaluation: { safeCompleteness: true, verifiedEligible: true } });
    expect(result.fetchEvidence?.declaredCompleteness).toMatchObject({ kind: "COMPLETE_PAGE_TRAVERSAL", value: 1, scope: "CHANNEL" });
    const audit = ledger(result);
    expect(audit.status).toBe("CANDIDATE_QUERY_SUBSET");
    expect(audit.candidateIds).toEqual(fixture.candidateIds);
    expect(audit.unexplainedCandidateIds).toEqual(fixture.candidateIds.filter(id => !fixture.returnedRows.some(r => r.REQUEST_ID === id)));
    expect(audit.unexplainedCandidateIds).toHaveLength(6);
    expect(audit.unexplainedCandidates.every((r: {code:string}) => r.code === "NO_OFFICIAL_EXCLUSION_EVIDENCE")).toBe(true);
    const crawled = await runSourceCrawl(plan, { fetch: async () => result });
    expect(crawled.truth.completenessVerified).toBe(true);
  });
  it("issues the existing B certificate for the 31-row UI/API set, but rejects any missing UI row", async () => {
    const channelId = plan.expectedChannels![0]!.channelId;
    const sourceConfigSha256 = sourcePlanConfigSha256(plan);
    const independentValidation = createOfficialJsonRenderedTraversalValidation({
      sourceId: "source-cspc-social", companyId: plan.company.id, sourceConfigSha256,
      surfaceIds: [plan.source.surfaceId!], channelIds: [channelId], observedAt: NOW,
      expiresAt: "2026-10-01T16:20:00.000Z",
      pages: [{ channelId, pageNumber: 1, declaredTotalPages: 1, declaredTotalJobs: 31,
        uiRequestCandidateIds: fixture.candidateIds, nextControlPresent: false,
        rawRows: fixture.returnedRows.map((rawPayload, recordIndex) => ({
          sourceJobId: `${channelId}:${rawPayload.REQUEST_ID}`,
          rawEvidenceId: irreversibleOfficialJsonEvidenceId(rawPayload.REQUEST_ID),
          scopeMarker: "SOCIAL_CHANNEL", scopeDecision: "INCLUDED_MAINLAND" as const, recordIndex, rawPayload
        })) }]
    });
    for (const rows of [fixture.returnedRows, ...fixture.returnedRows.map((_row, missing) => fixture.returnedRows.filter((_item, index) => index !== missing))]) {
      const result = await runSourceCrawl(plan, { fetch: async () => capture(undefined, rows) });
      expect(result.truth.completenessVerified).toBe(true);
      const decision = issueBGradeTraversalCertificate({
        binding: { releaseCandidateId: "unit-cspc", batchId: "unit-cspc", sourceResultId: "unit-cspc", sourceConfigSha256 },
        plan, transportSuccess: result.truth.transportSuccess, adapterSuccess: result.truth.adapterSuccess,
        evidence: result.fetchEvidence!, paginationEvaluation: result.paginationEvaluation!,
        reconciliation: result.reconciliation!, jobs: result.jobs, independentValidation,
        validationExecution: "CURRENT_RUN", trigger: "INITIAL_QUALIFICATION", now: new Date(NOW)
      });
      if (rows.length === 31) expect(decision).toMatchObject({ status: "CERTIFIED" });
      else expect(decision).toMatchObject({ status: "REJECTED", blockerCodes: expect.arrayContaining(["INDEPENDENT_JOB_SET_MISMATCH"]) });
    }
  });
  it("rejects removal or falsification of the bound six-candidate unknown ledger", async () => {
    for (const remove of [false, true]) {
      const result = await capture();
      const evidence = result.fetchEvidence!;
      const audit = evidence.artifacts.find(a => a.logicalKey.endsWith("-candidate-scope"))!;
      const artifacts = remove ? evidence.artifacts.filter(a => a !== audit)
        : evidence.artifacts.map(a => a === audit ? { ...a, body: JSON.stringify({ ...JSON.parse(String(a.body)), unexplainedCandidateIds: [] }) } : a);
      const crawled = await runSourceCrawl(plan, { fetch: async () => ({ ...result, fetchEvidence: { ...evidence, artifacts } }) });
      expect(crawled.truth.completenessVerified).toBe(false);
    }
  });
  it("allows the existing channel completeness path only when configured and returned IDs agree", async () => {
    const result = await capture(redseaCandidateListHtml(fixture.returnedRows.map(r=>r.REQUEST_ID)));
    expect(result).toMatchObject({ ok:true, completeness:{completenessStatus:"VERIFIED"},paginationEvaluation:{verifiedEligible:true} });
  });
  it.each([
    ["missing declaration", "<html>list</html>", "CANDIDATE_DECLARATION_INVALID"],
    ["duplicate declarations", redseaCandidateListHtml(fixture.candidateIds)+redseaCandidateListHtml(fixture.candidateIds), "CANDIDATE_DECLARATION_INVALID"],
    ["duplicate configured IDs", redseaCandidateListHtml([...fixture.candidateIds, fixture.candidateIds[0]!]), "CANDIDATE_DECLARATION_INVALID"],
    ["malformed encoding", "<script>var requestId='invalid';</script>", "CANDIDATE_DECLARATION_INVALID"],
    ["unexpected returned ID", redseaCandidateListHtml(fixture.returnedRows.slice(1).map(r=>r.REQUEST_ID)), "UNEXPECTED_RETURNED_CANDIDATE"]
  ])("blocks source completeness for %s",async(_label,html,status)=>{
    const result=await capture(html);
    expect(result).toMatchObject({ok:true,completeness:{completenessStatus:"NEEDS_MANUAL_COMPLETENESS_REVIEW"},paginationEvaluation:{verifiedEligible:false}});
    expect(ledger(result).status).toBe(status);
  });
  it.each([
    ["direct overwrite", "requestId = 'different';"],
    ["function-scoped loop write", "for (var requestId of values) {}"],
    ["top-level block var redeclaration", "if (true) { var requestId = 'different'; }"],
    ["cross-script overwrite", "</script><script>requestId = 'different';"],
    ["window property overwrite", "window.requestId = 'different';"],
    ["computed global overwrite", "window['request' + 'Id'] = 'different';"],
    ["destructuring overwrite", "({candidate: requestId} = anotherValue);"],
    ["numeric mutation", "requestId++;"],
    ["helper-function mutation", "function mutate(){ requestId = 'different'; } mutate();"]
  ])("rejects ambiguous candidate dataflow: %s", async (_label, mutation) => {
    const html = redseaCandidateListHtml(fixture.returnedRows.map(r=>r.REQUEST_ID)).replace("</script>", `${mutation}</script>`);
    const result = await capture(html);
    expect(result).toMatchObject({ok:true,completeness:{completenessStatus:"NEEDS_MANUAL_COMPLETENESS_REVIEW"},paginationEvaluation:{verifiedEligible:false}});
    expect(ledger(result).status).toBe("CANDIDATE_DECLARATION_INVALID");
  });
  it("rejects a candidate declaration present only inside a conditional block", async () => {
    const html = redseaCandidateListHtml(fixture.returnedRows.map(r=>r.REQUEST_ID)).replace("<script>", "<script>if (false) {").replace("</script>", "}</script>");
    const result = await capture(html);
    expect(result).toMatchObject({ok:true,completeness:{completenessStatus:"NEEDS_MANUAL_COMPLETENESS_REVIEW"},paginationEvaluation:{verifiedEligible:false}});
    expect(ledger(result).status).toBe("CANDIDATE_DECLARATION_INVALID");
  });
  it("allows the observed function-local row variable shadow", async () => {
    const html = redseaCandidateListHtml(fixture.returnedRows.map(r=>r.REQUEST_ID)).replace("</script>", "function getJobDetail(record) { var requestId = record.REQUEST_ID; return requestId; }</script>");
    expect(await capture(html)).toMatchObject({ok:true,completeness:{completenessStatus:"VERIFIED"}});
  });
  it("does not use a duplicate response row to close candidate accounting",async()=>{
    const result=await capture(redseaCandidateListHtml(fixture.returnedRows.map(r=>r.REQUEST_ID)),[...fixture.returnedRows,fixture.returnedRows[0]!]);
    expect(result).toMatchObject({ok:true,completeness:{completenessStatus:"NEEDS_MANUAL_COMPLETENESS_REVIEW"},paginationEvaluation:{verifiedEligible:false}});
    expect(ledger(result).status).toBe("DUPLICATE_RETURNED_CANDIDATE");
  });
});
