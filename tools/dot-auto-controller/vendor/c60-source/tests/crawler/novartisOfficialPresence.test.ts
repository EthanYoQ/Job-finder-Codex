import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { serialize } from "node:v8";
import { createHttpHtmlSourceFetch, createPresenceCheckedHttpHtmlSourceFetch, isSafeHtmlFailureCode, type HttpHtmlRequest } from "../../src/crawler/httpHtmlSourceFetch";
import { NOVARTIS_DEFAULT_ENTRY, NOVARTIS_PRESENCE_UNKNOWN, replayNovartisOfficialPresence } from "../../src/crawler/novartisOfficialPresence";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { archiveSourceEvidence } from "../../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { createOwnedSourceQualityFetch, createReviewedRetainedSourceFetch, issueSourceQualityAdmission } from "../../src/crawler/sourceQualityAdmission";
import { buildSourceQualityJobCommands } from "../../src/crawler/sourceQualityPublication";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import type { JobSnapshot } from "../../src/crawler/lifecycle";
import { accepted, job, failed } from "../helpers/portablePublicSnapshotFixture";
import { selectPortableSourceSnapshots, projectPortableSourceJobs } from "../../src/domain/portablePublicSnapshot";

const NOW = "2026-10-03T08:00:00.000Z", EARLIER = "2026-10-03T07:00:00.000Z";
const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === "source-novartis-social")!;
const directories: string[] = [];
const digest = (bytes:string|Uint8Array) => createHash("sha256").update(bytes).digest("hex");
afterEach(async () => { vi.useRealTimers(); vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(path => rm(path,{recursive:true,force:true}))); });
const url = (id:string) => `https://www.novartis.com.cn/careers/career-search/job/details/${id.toLowerCase()}-title`;
function page(ids:string[], active=1, pages=1, total=ids.length, sorted=false) {
  const next = new URL(sorted ? plan.source.officialEntryUrl : NOVARTIS_DEFAULT_ENTRY);
  next.searchParams.delete("country[]"); next.searchParams.set("country[0]","LOC_CN"); next.searchParams.set("page",String(active));
  return `<div class="view-header">Showing ${total} results</div><table class="views-table"><tbody>${ids.map(id =>
    `<tr><td class="views-field-field-job-title"><a href="${url(id)}">Job ${id}</a></td><td class="views-field-field-job-country">China</td><td class="views-field-field-job-work-location">Shanghai (Shanghai)</td></tr>`).join("")}</tbody></table>
    <ul class="pagination"><li class="active"><a class="page-link" title="page ${active} active out of ${pages} pages">${active}</a></li>
    <li><a rel="next" title="Go to next page" class="page-link btn ${active===pages ? "disabled" : ""}" href="${active===pages ? "" : next.href}">Next</a></li></ul>`;
}
const current = ["REQ-00000001","REQ-00000002"], extra = "REQ-00000003";
function detail(id=extra, content="Responsibilities: perform the work listed in this official job description.", apply=true) {
  return `<h1>Job ${id}</h1><article>Job ID: ${id}<p>${content}</p>${apply ? `<a href="https://platform.moseeker.com/m/customize/page/novartis?job_number=${id}">Apply to Job</a>` : ""}</article>`;
}
async function capture(options:{defaultPages?:string[];detail?:string;status?:number;redirect?:string;checked?:boolean;at?:string;defaultFailure?:boolean}={}) {
  const at=options.at??NOW; vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(at));
  const requests:string[]=[];
  const http=async(request:HttpHtmlRequest)=>{
    requests.push(request.url);
    const isDetail=request.url.includes("/job/details/");
    const sorted=new URL(request.url).searchParams.has("sort");
    if (!sorted&&!isDetail&&options.defaultFailure) throw Error("fixture failure");
    const index=Number(new URL(request.url).searchParams.get("page")??0);
    return {status:isDetail ? options.status??200 : 200,finalUrl:isDetail ? options.redirect??request.url : request.url,
      capturedAt:at,contentType:"text/html",body:isDetail ? options.detail??detail() : sorted ? page(current,1,1,2,true)
      : (options.defaultPages??[page(current)])[index]!};
  };
  const fetched=await (options.checked===false ? createHttpHtmlSourceFetch({http,now:()=>new Date(at)}) : createPresenceCheckedHttpHtmlSourceFetch({http,now:()=>new Date(at)}))(plan);
  const root=await mkdtemp(join(tmpdir(),"novartis-presence-test-"));directories.push(root);
  if (!fetched.ok) return {fetched,requests,root};
  const bytes=serialize(fetched),path=join(root,"original.v8");await writeFile(path,bytes);
  const manifest=JSON.stringify({schemaVersion:2,sourceId:plan.source.id,sourceConfigSha256:sourcePlanConfigSha256(plan),
    startedAt:at,finishedAt:at,fetched:{path,sha256:digest(bytes),encoding:"v8"}});
  const manifestPath=join(root,"retained.json");await writeFile(manifestPath,manifest);
  const fetch=await createReviewedRetainedSourceFetch(manifestPath,digest(manifest));
  const result=await runSourceCrawl(plan,{fetch,isBaseline:false});
  const identity={releaseCandidateId:"novartis-test",commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),
    sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"test",
    expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:digest(JSON.stringify([plan.source.id])),expectedPlannedSourceCount:1};
  const batchId=`novartis-${Date.parse(at)}`,pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(at)).sources[0]!;
  const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion};
  const evidenceSubdirectory="quality/evidence";
  const archive=await archiveSourceEvidence({workspaceRoot:root,evidenceSubdirectory,...binding,sourceId:plan.source.id,
    captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
  const input={plan,result,binding,identity,batchId,pending,archive:{workspaceRoot:root,evidenceSubdirectory,artifacts:archive.artifacts}};
  const admission=await issueSourceQualityAdmission(input);
  return {fetched,requests,root,input,admission};
}
function previous(record:NonNullable<Awaited<ReturnType<typeof capture>>["input"]>["result"]["jobs"][number]):JobSnapshot {
  const old={...record,officialUrl:url(extra),officialTitle:"Retained job"};
  return {record:old,dedupeKey:buildJobDedupeKey(old),lifecycleStatus:"ACTIVE",missingSuccessfulCrawlCount:1,firstSeenAt:EARLIER,lastSeenAt:EARLIER};
}

describe("Novartis real official-presence lifecycle boundary",()=>{
  it("automatically checks the default view through the normal owned portable fetch route",async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(NOW));
    const requests:string[]=[];
    vi.stubGlobal("fetch",vi.fn(async(value:string)=>{
      const requested=String(value);requests.push(requested);
      return {status:200,url:requested,headers:new Headers({"content-type":"text/html"}),text:async()=>requested.includes("/job/details/")
        ? detail() : new URL(requested).searchParams.has("sort") ? page(current,1,1,2,true) : page([...current,extra])};
    }));
    const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false});
    expect(result).toMatchObject({status:"FAILED",failureReason:NOVARTIS_PRESENCE_UNKNOWN,jobs:[]});
    expect(requests).toEqual([plan.source.officialEntryUrl,NOVARTIS_DEFAULT_ENTRY,url(extra)]);
  });
  it("keeps sorted counts and accepts a default subset despite duplicate pages and reported total drift",async()=>{
    const f=await capture({defaultPages:[page([current[0]!],1,2,2),page([current[0]!],2,2,3)]});
    expect(f.admission,JSON.stringify({truth:f.input?.result.truth,observation:f.input?.result.observation})).toMatchObject({status:"ACCEPTED"});expect(f.input?.result.jobs).toHaveLength(2);
    expect(f.fetched.fetchEvidence?.fetchCounts).toMatchObject({rawCount:2,validCount:2});
    expect(f.fetched.fetchEvidence?.pages).toHaveLength(1);
    const audit=JSON.parse(String(f.fetched.fetchEvidence?.artifacts.find(a=>a.logicalKey==="novartis-presence-audit")?.body));
    expect(audit).toMatchObject({status:"CONSISTENT",sortedUniqueCount:2,defaultObservedUniqueCount:1,defaultReportedTotals:[2,3],defaultCompletenessClaim:false});
    const input=f.input!;
    const commit=buildAtomicRuntimeCommit({...input,artifacts:input.archive.artifacts,previousJobs:[],baselineCompletedBeforeCrawl:false,
      sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:f.admission!,firstAcceptedCurrentPolicyReceipt:null});
    await verifyAtomicRuntimeCommitForPersistence(commit);
    expect(commit.commands.filter(c=>c.type==="UPSERT_JOB")).toHaveLength(2);
  });
  it("blocks any newly observed default-only identity with a readable same-ID detail and never fetches its apply link",async()=>{
    const f=await capture({defaultPages:[page([...current,extra])]});
    expect(f.fetched).toMatchObject({ok:false,failureReason:NOVARTIS_PRESENCE_UNKNOWN});
    expect(isSafeHtmlFailureCode(NOVARTIS_PRESENCE_UNKNOWN)).toBe(true);
    const audit=JSON.parse(String(f.fetched.fetchEvidence?.artifacts.find(a=>a.logicalKey==="novartis-presence-audit")?.body));
    expect(audit.differences).toEqual([{officialId:extra,officialUrl:url(extra),status:"UNKNOWN"}]);
    expect(f.requests).toContain(url(extra));expect(f.requests.some(u=>u.includes("moseeker"))).toBe(false);
    const result=await runSourceCrawl(plan,{fetch:async()=>f.fetched,isBaseline:false});
    expect(result).toMatchObject({status:"FAILED",jobs:[],truth:{transportSuccess:false,completenessVerified:false}});
  });
  it.each([
    {status:404,detail:"404!Ta在地球上消失了"},
    {detail:"<article>Maintenance: temporarily unavailable</article>"},
    {detail:detail("REQ-99999999","This job is no longer available",false)},
    {detail:detail(extra,"This job is no longer available",true)},
    {detail:detail(extra,"<span hidden>This job is no longer available</span>",false)},
    {detail:detail(extra,"This job is no longer available",false),redirect:"https://www.novartis.com.cn/error"}
  ])("keeps unavailable, wrong-ID, hidden and contradictory closure evidence UNKNOWN: %j",async options=>{
    const f=await capture({...options,defaultPages:[page([...current,extra])]});
    expect(f.fetched).toMatchObject({ok:false,failureReason:NOVARTIS_PRESENCE_UNKNOWN});
  });
  it("honors same-ID explicit closure without fabricating a current row or a larger official total",async()=>{
    const prior=await capture({at:EARLIER});if(prior.admission?.status!=="ACCEPTED")throw Error("prior rejected");
    const f=await capture({defaultPages:[page([...current,extra])],detail:detail(extra,"This job is no longer available",false)});
    expect(f.admission?.status).toBe("ACCEPTED");const input=f.input!;
    expect(replayNovartisOfficialPresence(plan,input.result.fetchEvidence!).closedUrls).toEqual(new Set([url(extra)]));
    const previousJobs=[previous(input.result.jobs[0]!)],before=structuredClone(previousJobs);
    const output=buildSourceQualityJobCommands({...input,admission:f.admission!,previousJobs,baselineCompletedBeforeCrawl:true,
      firstAcceptedCurrentPolicyReceipt:{receipt:prior.admission.receipt,receiptSha256:prior.admission.receiptSha256,expectedBinding:prior.admission.receipt.binding}});
    expect(output.jobCommands).toHaveLength(2);expect(output.jobCommands.some(c=>c.record.officialUrl===url(extra))).toBe(false);
    expect(previousJobs).toEqual(before);
  });
  it("has no Job writes or missing advance for rejection, and a later consistent capture recovers normally",async()=>{
    const prior=await capture({at:EARLIER});if(prior.admission?.status!=="ACCEPTED")throw Error("prior rejected");
    const f=await capture();const input=f.input!,previousJobs=[previous(input.result.jobs[0]!)],before=structuredClone(previousJobs);
    const args={...input,previousJobs,baselineCompletedBeforeCrawl:true,
      firstAcceptedCurrentPolicyReceipt:{receipt:prior.admission.receipt,receiptSha256:prior.admission.receiptSha256,expectedBinding:prior.admission.receipt.binding}};
    expect(buildSourceQualityJobCommands({...args,admission:{status:"REJECTED",codes:[NOVARTIS_PRESENCE_UNKNOWN]}})).toEqual({jobCommands:[],visibilityFloor:EARLIER});
    expect(previousJobs).toEqual(before);
    const recovered=buildSourceQualityJobCommands({...args,admission:f.admission!});
    expect(recovered.jobCommands.find(c=>c.record.officialUrl===url(extra))).toMatchObject({missingSuccessfulCrawlCount:2,lifecycleStatus:"SUSPECTED_OFFLINE"});
  });
  it("rejects old sorted-only retained captures at the issuer and the atomic lifecycle boundary",async()=>{
    const f=await capture({checked:false});expect(f.input?.result.status).toBe("SUCCESS");
    expect(f.admission).toMatchObject({status:"REJECTED",codes:["SOURCE_QUALITY_REPLAY_FAILED"]});
    const input=f.input!;
    const commit=buildAtomicRuntimeCommit({...input,artifacts:input.archive.artifacts,previousJobs:[],baselineCompletedBeforeCrawl:false,
      publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1"});
    expect(commit.commands.filter(c=>c.type==="UPSERT_JOB")).toHaveLength(0);
  });
  it("rejects a forged consistent ledger, removed original, and changed pagination target on replay",async()=>{
    const f=await capture();const original=f.fetched.fetchEvidence!;
    for(const mutate of [
      (e:typeof original)=>{e.artifacts=e.artifacts.filter(a=>a.logicalKey!=="novartis-presence-default-0");},
      (e:typeof original)=>{e.artifacts.find(a=>a.logicalKey==="novartis-presence-audit")!.body="{}";},
      (e:typeof original)=>{e.artifacts.find(a=>a.logicalKey==="novartis-presence-default-0")!.requestedUrl="https://www.novartis.com.cn/careers/career-search";}
    ]){const e=structuredClone(original);mutate(e);expect(()=>replayNovartisOfficialPresence(plan,e)).toThrow();}
  });
  it("holds on default transport failure or a Next link changing China scope",async()=>{
    expect((await capture({defaultFailure:true})).fetched).toMatchObject({ok:false,failureReason:NOVARTIS_PRESENCE_UNKNOWN});
    expect((await capture({defaultPages:[page(current,1,2).replaceAll("LOC_CN","LOC_US")]})).fetched).toMatchObject({ok:false,failureReason:NOVARTIS_PRESENCE_UNKNOWN});
  });
  it("still displays historic 155 CURRENT plus 1 GRACE after a new failed attempt, without retroactive evidence requirements",()=>{
    const keys=Array.from({length:155},(_,i)=>`REQ-${10000000+i}`);
    const first=accepted(EARLIER,[extra],[],plan),last=accepted(NOW,keys,[extra],plan);
    const failure={...failed("2026-10-03T08:05:00.000Z"),sourceId:plan.source.id,sourceConfigHash:sourcePlanConfigSha256(plan)};
    const now=new Date("2026-10-03T08:10:00.000Z");
    const selected=selectPortableSourceSnapshots([plan],[first.result,last.result,failure],{currentTime:now})[0]!;
    expect(selected).toMatchObject({state:"PUBLISHING",health:"DEGRADED",lastAcceptedJobCount:155,lastAcceptedAt:NOW});
    const rows=[...keys.map(key=>job(key,NOW)),job(extra,EARLIER,1)].map(row=>({...row,companyId:plan.company.id,sourceId:plan.source.id,dedupeKey:`${plan.source.id}:${row.id}`,officialUrl:url(row.id)}));
    expect(projectPortableSourceJobs(selected,last.members,rows,{currentTime:now})).toMatchObject({state:"PUBLISHING",visibleJobCount:156});
    expect(selectPortableSourceSnapshots([plan],[first.result,last.result,failure],{currentTime:new Date(Date.parse(NOW)+30*3_600_000)})[0]).toMatchObject({state:"HOLD",freshness:"STALE"});
  });
});
