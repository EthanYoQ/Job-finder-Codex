// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, getPlanBySourceId, validateExecutablePlanChannelBinding } from "../../src/crawler/sourcePlan";
import { createQiluDualPartitionSourceFetch, validateStrictQiluDualPartitionEvidence } from "../../src/crawler/qiluDualPartitionSourceFetch";
import { irreversibleOfficialJsonEvidenceId, persistentOfficialJsonJobId } from "../../src/crawler/officialJsonEvidence";
import { collectQiluMainPartitions } from "../../src/crawler/qiluDualPartitionMainCapture";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
const now = () => new Date("2026-10-01T09:00:00.000Z");
const marketingUrl = "https://www.qilu-pharma.com/JobPosting_list.html";
const apiUrl = "https://qilu-pharma.zhiye.com/api/Jobad/GetJobAdPageList";
const marketingHtml = `<a href="https://qilu-pharma.zhiye.com/social">社会招聘（非营销类）</a><div class="e_loop-65"><div class="cbox-65 p_loopitem"><div class="e_text-83"><a href="/JobPosting_Detail/c-_detailId%3D12345.html">Synthetic marketing role</a></div><div class="e_text-86">山东省</div></div></div><div class="p_page"><a class="page_next disabled">下一页</a></div>`;
const rows = [
    { Id: "abcdef00-0000-4000-8000-000000000001", JobAdId: 1, JobAdName: "Synthetic non-marketing role", CategoryId: "1", Category: "社会招聘", Status: 1, LocNames: ["山东省·济南市"] },
    { Id: "00000000-0000-4000-8000-000000000002", JobAdId: 2, JobAdName: "Synthetic foreign role", CategoryId: "1", Category: "社会招聘", Status: 1, LocNames: ["美国"] }
];
function plan() { return getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies), "source-qilu-social")!; }
function fixture(status = 200) {
    const requests: string[] = [];
    return { requests, now,
        marketingHttp: async (request: {
            url: string;
        }) => { requests.push(request.url); return { status: 200, body: marketingHtml, finalUrl: marketingUrl, contentType: "text/html", capturedAt: now().toISOString() }; },
        nonMarketingHttp: async (request: {
            url: string;
        }) => { requests.push(request.url); return { status, body: JSON.stringify({ Code: 200, Count: 2, Data: rows }), finalUrl: apiUrl, contentType: "application/json", capturedAt: now().toISOString() }; }
    };
}
function rehashRawRow(e: any, patch: Record<string, unknown>) {
    const a = e.artifacts.find((a: any) => a.channelId === "qilu-non-marketing");
    const data = JSON.parse(a.body);
    Object.assign(data.Data[0], patch);
    a.body = JSON.stringify(data);
    const hash = createHash("sha256").update(a.body).digest("hex");
    e.pages.find((p: any) => p.artifactLogicalKey === a.logicalKey).responseFingerprintSha256 = hash;
    const manifest = e.artifacts.find((a: any) => a.logicalKey === "qilu-partition-metadata");
    const m = JSON.parse(manifest.body);
    const inner = m.partitions[1].evidence;
    inner.artifacts[0].bodySha256 = hash;
    inner.pages[0].responseFingerprintSha256 = hash;
    manifest.body = JSON.stringify(m);
}
function recomposeMarketingForReview(baselineEvidence: any, replacement: any): any {
  const evidence = structuredClone(baselineEvidence);
  const prefix = "qilu-marketing-";
  const hash = (body: string) => createHash("sha256").update(body, "utf8").digest("hex");

  evidence.artifacts = evidence.artifacts.filter((artifact: any) => artifact.channelId !== "qilu-marketing");
  evidence.artifacts.unshift(...replacement.artifacts.map((artifact: any) => ({
    ...artifact,
    id: prefix + artifact.id,
    logicalKey: prefix + artifact.logicalKey,
    channelId: "qilu-marketing"
  })));

  const declaration = evidence.artifacts.find((artifact: any) => artifact.logicalKey === "qilu-required-partitions-declaration");
  const declarationIdentity = { id: declaration.id, logicalKey: declaration.logicalKey, extractorLocator: declaration.extractorLocator };
  Object.assign(declaration, replacement.artifacts[0], declarationIdentity, { kind: "OFFICIAL_COMPANY_PAGE" });

  evidence.pages.splice(0, 1, ...replacement.pages.map((page: any) => ({
    ...page,
    artifactLogicalKey: prefix + page.artifactLogicalKey,
    channelId: "qilu-marketing"
  })));

  const manifest = evidence.artifacts.find((artifact: any) => artifact.logicalKey === "qilu-partition-metadata");
  const metadata = JSON.parse(manifest.body);
  metadata.partitions[0].evidence = {
    ...replacement,
    artifacts: replacement.artifacts.map(({ body, ...artifact }: any) => ({
      ...artifact,
      bodySha256: hash(typeof body === "string" ? body : Buffer.from(body).toString("utf8"))
    }))
  };
  manifest.body = JSON.stringify(metadata);
  return evidence;
}

describe("Qilu staged required channel registration", () => {
    it("plans exactly one Qilu source with both mandatory social channels", () => {
        const p = plan();
        expect(p.adapterId).toBe("official-json");
        expect(p.expectedChannels).toEqual([{ channelId: "qilu-marketing", kind: "SOCIAL" }, { channelId: "qilu-non-marketing", kind: "SOCIAL" }]);
        expect(() => validateExecutablePlanChannelBinding(p)).not.toThrow();
        expect(buildStagedSourceCrawlPlans(candidateCompanies).filter(x => x.company.id === "company-qilu")).toHaveLength(1);
    });
    it("runs both HTTP partitions through the staged main acquisition and independently reconciles exclusions", async () => {
        const deps = fixture();
        const p = plan();
        const result = await runSourceCrawl(p, { fetch: createQiluDualPartitionSourceFetch(deps), isBaseline: true });
        expect(deps.requests).toEqual([marketingUrl, apiUrl]);
        expect(result.jobs).toHaveLength(2);
        expect(result.fetchEvidence?.fetchCounts).toEqual({ rawCount: 3, parsedCount: 3, validCount: 2, parseDiscardCount: 0, validationDiscardCount: 1 });
        expect(result.fetchEvidence?.declaredCompleteness).toMatchObject({ kind: "COMPLETE_PAGE_TRAVERSAL", value: 2, scope: "SOURCE" });
        expect(result.paginationEvaluation?.visitedChannelIds).toEqual(["qilu-marketing", "qilu-non-marketing"]);
        expect(validateStrictQiluDualPartitionEvidence(p, result.fetchEvidence!, result.jobs)).toBe(true);
        expect(result.truth.completenessVerified).toBe(true);
    });
    it("does not return a marketing-only subset if the required second channel fails", async () => {
        const result = await createQiluDualPartitionSourceFetch(fixture(503))(plan());
        expect(result.ok).toBe(false);
        expect(result).not.toHaveProperty("payload");
        expect(result.fetchEvidence?.supportingArtifactOnlyFailure?.code).toBe("QILU_REQUIRED_PARTITION_INCOMPLETE");
        expect(result.fetchEvidence?.declaredCompleteness).toBeUndefined();
        const metadata = JSON.parse(result.fetchEvidence!.artifacts.find(a => a.logicalKey === "qilu-failed-attempt")!.body as string);
        expect(metadata.partitions.map((p: any) => p.state)).toEqual(["COLLECTED", "FAILED"]);
        expect(metadata.partitions[0].originalEvidence.fetchCounts.rawCount).toBe(1);
        expect(result.fetchEvidence!.artifacts.some(a => a.body === marketingHtml)).toBe(true);
    });
    it("rejects a source plan with one mandatory channel removed", async () => {
        const p = plan();
        p.expectedChannels = p.expectedChannels!.slice(0, 1);
        const deps = fixture();
        expect((await createQiluDualPartitionSourceFetch(deps)(p)).ok).toBe(false);
        expect(deps.requests).toEqual([]);
    });
    it("rejects truncated evidence, invented aggregate totals, omitted loss, changed output and changed raw rows", async () => {
        const p = plan();
        const result = await runSourceCrawl(p, { fetch: createQiluDualPartitionSourceFetch(fixture()), isBaseline: true });
        for (const mutate of [
            (e: any) => { e.pages.pop(); },
            (e: any) => { e.declaredCompleteness.kind = "OFFICIAL_TOTAL_COUNT"; e.declaredCompleteness.value = 3; },
            (e: any) => { e.fetchLosses = []; e.fetchCounts.validationDiscardCount = 0; e.fetchCounts.validCount = 3; },
            (e: any) => { const a = e.artifacts.find((x: any) => x.channelId === "qilu-non-marketing"); a.body = a.body.replace("Synthetic non-marketing role", "Changed role"); }
        ]) {
            const e = structuredClone(result.fetchEvidence!);
            mutate(e);
            expect(validateStrictQiluDualPartitionEvidence(p, e, result.jobs)).toBe(false);
        }
        expect(validateStrictQiluDualPartitionEvidence(p, result.fetchEvidence!, result.jobs.slice(0, 1))).toBe(false);
    });
    it.each([{ Country: "美国" }, { CountryName: "Hong Kong" }, { Category: "校园招聘" }, { Kind: "campus" }, { CategoryId: "2" }])("rejects a rehashed raw scope/channel mutation %j", async (patch) => {
        const p = plan();
        const result = await runSourceCrawl(p, { fetch: createQiluDualPartitionSourceFetch(fixture()), isBaseline: true });
        const e = structuredClone(result.fetchEvidence!);
        rehashRawRow(e, patch);
        expect(validateStrictQiluDualPartitionEvidence(p, e, result.jobs)).toBe(false);
    });
    it.each(["abcdef00-0000-6000-8000-000000000001", "ABCDEF00-0000-4000-8000-000000000001"])("rejects unsupported or uppercase canonical raw UUID %s", async id => {
        const p=plan(); const result=await runSourceCrawl(p,{fetch:createQiluDualPartitionSourceFetch(fixture()),isBaseline:true});
        const e=structuredClone(result.fetchEvidence!); rehashRawRow(e,{Id:id});
        const lower=id.toLowerCase(); const page=e.pages.find(p=>p.channelId==="qilu-non-marketing")!;
        page.rawJobIds[0]=irreversibleOfficialJsonEvidenceId(lower); page.validJobIds[0]=irreversibleOfficialJsonEvidenceId(persistentOfficialJsonJobId(lower));
        const a=e.artifacts.find(a=>a.logicalKey==="qilu-partition-metadata")!; const m=JSON.parse(a.body as string);
        m.partitions[1].evidence.pages[0].rawJobIds=page.rawJobIds; m.partitions[1].evidence.pages[0].validJobIds=page.validJobIds;
        a.body=JSON.stringify(m); const jobs=structuredClone(result.jobs); jobs[1]!.sourceJobId=persistentOfficialJsonJobId(lower);
        jobs[1]!.officialUrl=`https://qilu-pharma.zhiye.com/social/detail?jobAdId=${lower}`;
        expect(validateStrictQiluDualPartitionEvidence(p,e,jobs)).toBe(false);
    });
    it("rejects an unreviewed marketing producer even with self-consistent metadata",async()=>{
        const p=plan(); const result=await runSourceCrawl(p,{fetch:createQiluDualPartitionSourceFetch(fixture()),isBaseline:true});
        const e=structuredClone(result.fetchEvidence!); const a=e.artifacts.find(a=>a.logicalKey==="qilu-partition-metadata")!;
        const metadata=JSON.parse(a.body as string); metadata.partitions[0].evidence.captureTool.name="unreviewed-replacement";
        a.body=JSON.stringify(metadata); expect(validateStrictQiluDualPartitionEvidence(p,e,result.jobs)).toBe(false);
    });

    it.each(["?unreviewed=1", "#unreviewed"])("rejects fully recomposed marketing identity suffix %s",async suffix=>{
        const p=plan(); const baseline=await runSourceCrawl(p,{fetch:createQiluDualPartitionSourceFetch(fixture()),isBaseline:true});
        const deps=fixture(); deps.marketingHttp=async request=>({status:200,body:marketingHtml.replace("12345.html", "12345.html"+suffix),finalUrl:marketingUrl,contentType:"text/html",capturedAt:now().toISOString()});
        const rejected=await collectQiluMainPartitions(deps); expect(rejected.state).toBe("INCOMPLETE");
        const replacement=rejected.partitions[0]!.result!;
        const e=recomposeMarketingForReview(baseline.fetchEvidence!,replacement.fetchEvidence!);
        expect(validateStrictQiluDualPartitionEvidence(p,e,[...replacement.jobs,...baseline.jobs.slice(1)])).toBe(false);
    });

    it.each([{City:"香港"},{LocationName:"美国"},{LocName:{unknown:true}},{CountryName:"APAC"},{City:"北京市"}])("fails actual staged completeness for shadow geography %j",async patch=>{
        const deps=fixture(); deps.nonMarketingHttp=async request=>({status:200,body:JSON.stringify({Code:200,Count:2,Data:[{...rows[0],...patch},rows[1]]}),finalUrl:apiUrl,contentType:"application/json",capturedAt:now().toISOString()});
        const result=await runSourceCrawl(plan(),{fetch:createQiluDualPartitionSourceFetch(deps),isBaseline:true});
        expect(result.truth.completenessVerified).toBe(false);
    });
    it.each([{City:"济南市"},{LocationName:"香港"},{LocName:{unknown:true}},{Country:"China"}])("rejects ambiguous shadow geography on excluded rows %j",async patch=>{
        const deps=fixture(); deps.nonMarketingHttp=async request=>({status:200,body:JSON.stringify({Code:200,Count:2,Data:[rows[0],{...rows[1],...patch}]}),finalUrl:apiUrl,contentType:"application/json",capturedAt:now().toISOString()});
        const result=await runSourceCrawl(plan(),{fetch:createQiluDualPartitionSourceFetch(deps),isBaseline:true});
        expect(result.truth.completenessVerified).toBe(false);
    });

});
