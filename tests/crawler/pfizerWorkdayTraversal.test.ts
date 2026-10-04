import { assertBGradePublicSnapshot } from "../helpers/assertBGradePublicSnapshot";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { archiveSourceEvidence, verifyArchivedSourceEvidence } from "../../src/crawler/artifactArchive";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch } from "../../src/crawler/runtimeAtomicEvidence";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import { executeAtomicSourceEvidenceCommit } from "../../src/db/ingestionRepository";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { requiresAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { requiresBGradeTraversalCertificate, createOfficialJsonRenderedTraversalValidation, issueBGradeTraversalCertificate, readReusableBGradeTraversalValidation } from "../../src/crawler/traversalCertificate";
import { createHash } from "node:crypto";
import { irreversibleOfficialJsonEvidenceId } from "../../src/crawler/officialJsonEvidence";
const entry = "https://pfizer.wd1.myworkdayjobs.com/PfizerCareers";
const at = "2026-10-02T16:00:00.000Z";
const china = "6cb77610a8a543aea2d6bc10457e35d4";
function plan() { return buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-pfizer-china-social")!; }
function row(id: string, country = "China") { return { title: `Position ${id}`, externalPath: `/job/${country}/Position_${id}`, locationsText: country === "China" ? "China - Beijing - Beijing" : "2 Locations", bulletFields: [id] }; }
function detail(r: ReturnType<typeof row>, country: "China" | "India") { return { jobPostingInfo: { title: r.title, jobReqId: r.bulletFields[0], jobPostingSiteId: "PfizerCareers", externalUrl: entry + r.externalPath, location: country === "China" ? "China - Beijing - Beijing" : "India - Mumbai", ...(country === "India" ? { additionalLocations: ["APAC - Any Pfizer Site"] } : {}), country: { descriptor: country, id: country === "China" ? china : "c4f78be1a8f14da0ab49ce1162348a5e" }, jobRequisitionLocation: { country: { descriptor: country, alpha2Code: country === "China" ? "CN" : "IN" } }, posted: true, canApply: true, startDate: "2026-09-30", jobDescription: "Official job duties and application requirements. ".repeat(5) } }; }
async function crawl(mutator?: (d: any) => void, noTerminal = false, extraChina = 0, wrapTerminal: "same" | "changed" | undefined = undefined) {
    const rows = [row("4964739"), row("4964772", "India"), ...Array.from({ length: extraChina }, (_, i) => row(String(4970000 + i)))];
    let calls = 0;
    const fetch = createWorkdaySourceFetch({ now: () => new Date(at), http: async (req) => {
            calls++;
            const { offset } = JSON.parse(req.body);
            return { status: 200, body: JSON.stringify({ total: offset === 0 || wrapTerminal && offset >= rows.length ? rows.length : 0, jobPostings: offset < rows.length ? rows.slice(offset, offset + 20) : wrapTerminal ? rows.slice(0,20).map((r,i)=>wrapTerminal==="changed"&&i===0?{...r,title:r.title+" changed"}:r) : noTerminal ? rows.slice(0, 20) : [] }), finalUrl: req.url, contentType: "application/json", capturedAt: at };
        }, detailHttp: async (req) => { const r = rows.find(r => req.url.endsWith(r.externalPath))!; const d = detail(r, r.bulletFields[0] === "4964772" ? "India" : "China"); mutator?.(d); return { status: 200, body: JSON.stringify(d), finalUrl: req.url, contentType: "application/json", capturedAt: at }; } });
    const result = await runSourceCrawl(plan(), { isBaseline: true, fetch });
    return { result, calls };
}
describe("Pfizer exact complete-traversal B policy", () => {
    it("selects B only for the new exact policy and preserves old A routing", () => {
        const current = plan();
        expect(requiresBGradeTraversalCertificate(current)).toBe(true);
        expect(requiresAGradeOfficialTotalCertificate(current)).toBe(false);
        if (current.adapterId !== "official-json")
            throw Error("wrong adapter");
        const legacy = structuredClone(current);
        delete (legacy.workday as any).traversalScopePolicy;
        expect(requiresAGradeOfficialTotalCertificate(legacy)).toBe(true);
        expect(requiresBGradeTraversalCertificate(legacy)).toBe(false);
    });
    it("keeps the official denominator and records proven India scope loss after a real terminal request", async () => {
        const { result, calls } = await crawl();
        expect(result.truth.completenessVerified).toBe(true);
        expect(calls).toBe(2);
        expect(result.jobs).toHaveLength(1);
        expect(result.jobs[0]?.officialPublishedAt).toBe("2026-09-30T00:00:00.000Z");
        expect(result.fetchEvidence?.declaredCompleteness?.kind).toBe("COMPLETE_PAGE_TRAVERSAL");
        expect(result.fetchEvidence?.pages[0]?.declaredTotal).toBe(2);
        expect(result.fetchEvidence?.fetchCounts).toEqual({ rawCount: 2, parsedCount: 2, validCount: 1, parseDiscardCount: 0, validationDiscardCount: 1 });
        expect(result.fetchEvidence?.fetchLosses[0]?.details.code).toBe("PFIZER_VERIFIED_INDIA_SCOPE");
    });
    it.each(["unknown", "conflict", "closed"])("holds the entire source for %s detail evidence", async (kind) => {
        const { result } = await crawl(d => { if (d.jobPostingInfo.jobReqId !== "4964772")
            return; if (kind === "unknown")
            delete d.jobPostingInfo.country; if (kind === "conflict")
            d.jobPostingInfo.jobRequisitionLocation.country.alpha2Code = "CN"; if (kind === "closed")
            d.jobPostingInfo.canApply = false; });
        expect(result.truth.completenessVerified).toBe(false);
    });
    it("keeps explicit mainland provincial and multi-country locations without inventing a city", async () => {
        const { result } = await crawl(d => { if (d.jobPostingInfo.jobReqId === "4964739") {
            d.jobPostingInfo.location = "CHN - GZ - Guizhou";
            d.jobPostingInfo.additionalLocations = ["India - Goa"];
        } });
        expect(result.truth.completenessVerified).toBe(true);
        expect(result.jobs[0]?.locationRaw).toBe("CHN - GZ - Guizhou | India - Goa");
        expect(result.jobs[0]?.cities).toEqual(["城市待核"]);
    });
    it("issues a genuine B with raw/excluded/final commitments and rejects a stale current-run UI", async () => {
        const { result } = await crawl(undefined, false, 20), p = plan();
        const rawRows = [row("4964739"), row("4964772", "India"), ...Array.from({ length: 20 }, (_, i) => row(String(4970000 + i)))].map((r, recordIndex) => {
            const i = detail(r, recordIndex === 1 ? "India" : "China").jobPostingInfo, country = i.country.descriptor;
            return { sourceJobId: `workday:sha256:${createHash("sha256").update(r.externalPath).digest("hex")}`, rawEvidenceId: irreversibleOfficialJsonEvidenceId(r.bulletFields[0]), scopeMarker: country, scopeDecision: country === "China" ? "INCLUDED_MAINLAND" as const : "EXCLUDED_AUDITED" as const, recordIndex: recordIndex % 20, rawPayload: { capturedAt: "2026-10-02T16:00:00.000Z", officialId: r.bulletFields[0], externalPath: r.externalPath, title: r.title, detailUrl: "https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers" + r.externalPath + "?Location_Country=" + china, renderedTitle: r.title, renderedId: r.bulletFields[0], renderedLocations: [i.location, ...(i.additionalLocations ?? [])], applyEnabled: true, jsonLd: JSON.stringify({ "@type": "JobPosting", identifier: { value: r.bulletFields[0] }, title: r.title, description: i.jobDescription, datePosted: i.startDate, jobLocation: { address: { addressCountry: country, addressLocality: country === "China" ? "CHN - BJ - Beijing" : "IND - Mumbai" } } }) } };
        });
        const pages = [0, 1].map(i => ({ channelId: p.expectedChannels![0]!.channelId, pageNumber: i + 1, declaredTotalPages: 2, declaredTotalJobs: 22, uiRequestCandidateIds: [], nextControlPresent: i === 0, rawRows: rawRows.slice(i * 20, i * 20 + 20) }));
        for(const page of pages) (page.rawRows[0]!.rawPayload as any).listPage={url:`https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=${china}`,title:"Search for Jobs",countryFilter:"China clear filter",filterCount:1,searchText:"",pageLabel:`Page ${page.pageNumber} of 2`,range:`${(page.pageNumber-1)*20+1} - ${Math.min(page.pageNumber*20,22)} of 22 jobs`,totalText:"22 JOBS FOUND",nextControlPresent:page.nextControlPresent,capturedAt:at};
        const makeValidation = (pages: any) => createOfficialJsonRenderedTraversalValidation({ sourceId: "source-pfizer-china-social", companyId: p.company.id, sourceConfigSha256: sourcePlanConfigSha256(p), surfaceIds: [p.source.surfaceId!], channelIds: p.expectedChannels!.map(c => c.channelId), pages, observedAt: at, expiresAt: "2026-10-03T16:00:00.000Z" });
        const independentValidation = makeValidation(pages);
        const input = { plan: p, binding: { releaseCandidateId: "test-pfizer", batchId: "test-batch", sourceResultId: "test-result", sourceConfigSha256: sourcePlanConfigSha256(p) }, transportSuccess: true, adapterSuccess: true, evidence: result.fetchEvidence!, paginationEvaluation: result.paginationEvaluation!, reconciliation: result.reconciliation!, jobs: result.jobs, independentValidation, trigger: "INITIAL_QUALIFICATION" as const, validationExecution: "CURRENT_RUN" as const, now: new Date(at) };
        const decision = issueBGradeTraversalCertificate(input);
        expect(decision.status).toBe("CERTIFIED");
        if (decision.status !== "CERTIFIED")
            throw Error(JSON.stringify(decision));
        expect(() => readReusableBGradeTraversalValidation({certificate:decision.certificate,certificateSha256:decision.certificateSha256,sourceConfigSha256:sourcePlanConfigSha256(p),now:new Date(at)})).toThrow(/CURRENT_RUN/);
        await assertBGradePublicSnapshot(p, result, decision.certificate);
        expect(decision.certificate.counts.validationDiscardCount).toBe(1);
        expect(decision.certificate.counts.finalUniqueJobCount).toBe(21);
        expect(decision.certificate.mainTraversal.canonicalRawMatchKeySetSha256).not.toBe(decision.certificate.mainTraversal.canonicalMatchKeySetSha256);
        expect(issueBGradeTraversalCertificate({ ...input, now: new Date("2026-10-02T17:00:01.000Z") }).status).toBe("REJECTED");
        expect(issueBGradeTraversalCertificate({ ...input, trigger: "STABLE_RUN", validationExecution: "REUSED" }).status).toBe("REJECTED");
        const staleDetail = structuredClone(input);
        const staleArtifact = staleDetail.evidence.artifacts.find(a => a.logicalKey.startsWith("pfizer-detail-"))!;
        staleArtifact.capturedAt = "2020-01-01T00:00:00.000Z";
        expect(issueBGradeTraversalCertificate(staleDetail).status).toBe("REJECTED");
        const wrongExcluded = structuredClone(pages);
        const excludedRow = wrongExcluded[0]!.rawRows[1]!;
        excludedRow.rawPayload.externalPath = excludedRow.rawPayload.externalPath.replace("Position_", "Different_");
        excludedRow.rawPayload.detailUrl = excludedRow.rawPayload.detailUrl.replace("Position_", "Different_");
        excludedRow.sourceJobId = `workday:sha256:${createHash("sha256").update(excludedRow.rawPayload.externalPath).digest("hex")}`;
        expect(issueBGradeTraversalCertificate({...input, independentValidation:makeValidation(wrongExcluded)}).status).toBe("REJECTED");
        expect(() => makeValidation([{...pages[0], declaredTotalPages:1, nextControlPresent:false, rawRows:rawRows.map((r,recordIndex)=>({...r,recordIndex}))}])).toThrow();
        const identity = {releaseCandidateId:"pfizer-synthetic-atomic",commitSha:"a".repeat(64),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"test",expectedPlannedSourceIds:[p.source.id],expectedPlannedSourceSetSha256:canonicalStringSetSha256([p.source.id]),expectedPlannedSourceCount:1};
        const batchId="pfizer-synthetic-batch",pending=buildPendingRuntimeBatch(batchId,[p],identity,new Date(at)).sources[0]!;
        await mkdir(join(process.cwd(),".runtime",".cache"),{recursive:true});
        const workspaceRoot=await mkdtemp(join(process.cwd(),".runtime",".cache","pfizer-test-"));
        try {
          const binding={workspaceRoot,releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:p.source.id,sourceResultId:pending.id,evidenceSubdirectory:"phase-1/runtime-evidence"};
          const archived=await archiveSourceEvidence({...binding,captureTool:result.fetchEvidence!.captureTool,artifacts:result.fetchEvidence!.artifacts});
          const artifacts=await verifyArchivedSourceEvidence({...binding,artifacts:archived.artifacts});
          const commit=buildAtomicRuntimeCommit({plan:p,pending,identity,batchId,result,previousJobs:[],baselineCompletedBeforeCrawl:false,artifacts,completedAt:new Date(at),independentTraversalValidation:independentValidation,independentTraversalValidationExecution:"CURRENT_RUN",independentTraversalValidationTrigger:"INITIAL_QUALIFICATION"});
          expect(commit.sourceResult).toMatchObject({completenessState:"VERIFIED",expectedEvidenceKind:"COMPLETE_PAGE_TRAVERSAL",rawCount:22,validationDiscardCount:1,dedupeOutputCount:21,completenessCertificate:{grade:"B"}});
          const tx={evidenceArtifact:{create:async()=>undefined},paginationEvidence:{create:async()=>undefined},lossLedgerEntry:{create:async()=>undefined},transportAttemptEvidence:{create:async()=>undefined},transportAttemptArtifact:{create:async()=>undefined},crawlObservation:{create:async()=>undefined},job:{upsert:async()=>undefined},lifecycleSetEvidenceMember:{create:async()=>undefined},crawlBatchSourceResult:{updateMany:async()=>({count:1})}};
          await expect(executeAtomicSourceEvidenceCommit(commit,{$transaction:async<T>(operation:(value:typeof tx)=>Promise<T>)=>operation(tx)})).resolves.toBeUndefined();
        } finally { await rm(workspaceRoot,{recursive:true,force:true}); }
        const tampered = structuredClone(input);
        tampered.evidence.fetchLosses = [];
        expect(issueBGradeTraversalCertificate(tampered).status).toBe("REJECTED");
    });
    it("retains an official beyond-end reset to the exact first page without counting it as raw jobs", async () => {
      const {result,calls}=await crawl(undefined,false,20,"same");
      expect(result.truth.completenessVerified).toBe(true);expect(calls).toBe(3);
      expect(result.fetchEvidence?.fetchCounts.rawCount).toBe(22);
      expect(result.fetchEvidence?.pages).toHaveLength(2);
      const terminal=result.fetchEvidence!.artifacts.find(a=>a.logicalKey==="pfizer-terminal")!;
      expect(JSON.parse(String(terminal.body)).jobPostings).toHaveLength(20);
      expect(result.fetchEvidence!.pages.at(-1)?.rawJobIds).toHaveLength(2);
    });
    it("rejects a reset to a changed first page and preserves the already captured originals", async () => {
      const {result}=await crawl(undefined,false,20,"changed");
      expect(result.truth.completenessVerified).toBe(false);
      expect(result.fetchEvidence?.supportingArtifactOnlyFailure).toEqual({code:"PFIZER_TRAVERSAL_UNVERIFIED"});
      expect(result.fetchEvidence?.artifacts).toHaveLength(25);
      expect(result.fetchEvidence?.artifacts.at(-1)?.logicalKey).toBe("pfizer-terminal");
    });
    it("rejects an unproved terminal instead of just relabelling total evidence", async () => {
        const { result } = await crawl(undefined, true);
        expect(result.truth.completenessVerified).toBe(false);
    });
});
