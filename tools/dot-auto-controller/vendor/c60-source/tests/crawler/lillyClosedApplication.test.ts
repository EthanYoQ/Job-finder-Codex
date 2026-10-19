// @vitest-environment node
import {describe,expect,it} from "vitest";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {syntheticLillyRow,lillyPlan,lillyBootstrap} from "../helpers/lillyPhenom";
import {lillyNativeDetail,lillyClosedSourceJobIds} from "../../src/crawler/lillyChinaQuality";
import {runSourceCrawl,replayStrictSourceQualityEvidence} from "../../src/crawler/runSourceCrawl";
import {createOwnedSourceQualityFetch,issueSourceQualityAdmission} from "../../src/crawler/sourceQualityAdmission";
import {archiveSourceEvidence} from "../../src/crawler/artifactArchive";
import {bindRuntimeEvidenceArtifactIds,buildPendingRuntimeBatch,buildAtomicRuntimeCommit} from "../../src/crawler/runtimeAtomicEvidence";
import {sourcePlanConfigSha256} from "../../src/crawler/sourcePlan";
import {buildJobDedupeKey} from "../../src/crawler/normalizedJob";
import type {SourceFetchArtifactDraft} from "../../src/crawler/sourceFetchEvidence";

const closedBody=(row:Record<string,unknown>)=>`<meta property="og:url" content="${row.applyUrl}"><script>window.workday={tenant:"lilly",siteId:"LLY",postingAvailable:false};</script>`;
const activeBody=(row:Record<string,unknown>)=>`<script>window.workday={postingAvailable:true};</script><script type="application/ld+json">${JSON.stringify({"@type":"JobPosting",identifier:{value:row.reqId},title:row.title,description:"Synthetic role description",datePosted:"2025-11-12",jobLocation:{address:{addressCountry:"China",addressLocality:"CN: Shang Hai"}}})}</script>`;

// Synthetic HTTP only; every unexpected request throws rather than falling through to the network.
async function capture(count:number,closed:number[],unknown:"identity"|"transport"|undefined=undefined){
  const plan=lillyPlan(),rows=Array.from({length:count},(_,i)=>syntheticLillyRow(i));
  const originalFetch=globalThis.fetch;let page=0,requests=0;
  globalThis.fetch=async(input,init)=>{
    const url=String(input);requests++;let body:string,mime:string;
    if(url===plan.source.officialEntryUrl){expect(init?.method??"GET").toBe("GET");body=`<script>var phApp=${JSON.stringify(lillyBootstrap)};</script>`;mime="text/html";}
    else if(url===lillyBootstrap.widgetApiEndpoint){expect(init?.method).toBe("POST");const jobs=rows.slice(page*50,(++page)*50);body=JSON.stringify({refineSearch:{status:200,hits:jobs.length,totalHits:rows.length,data:{jobs,aggregations:[],ui_selections:{country:["China"]}}}});mime="application/json";}
    else {const index=rows.findIndex(row=>row.applyUrl===url);if(index<0)throw Error("SYNTHETIC_UNEXPECTED_REQUEST");if(unknown==="transport"&&closed.includes(index))throw Error("SYNTHETIC_TRANSPORT_FAILURE");body=closed.includes(index)?closedBody(rows[index]!):activeBody(rows[index]!);if(unknown==="identity"&&closed.includes(index))body=body.replace("og:url","og:unbound");mime="text/html";}
    const response=new Response(body,{status:200,headers:{"content-type":mime}});Object.defineProperty(response,"url",{value:url});return response;
  };
  try{return {plan,rows,startedAt:new Date(),result:await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:false}),requests};}
  finally{globalThis.fetch=originalFetch;}
}
const replay=(input:Awaited<ReturnType<typeof capture>>,evidence=input.result.fetchEvidence!)=>replayStrictSourceQualityEvidence({plan:input.plan,evidence,jobs:input.result.jobs,capturedAt:input.result.observation.crawledAt.toISOString(),paginationEvaluation:input.result.paginationEvaluation!,reconciliation:input.result.reconciliation!});

async function admit(input:Awaited<ReturnType<typeof capture>>,workspaceRoot:string,batchId:string){
  const identity={releaseCandidateId:"synthetic-lilly-closed",commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"synthetic-lilly-closed",expectedPlannedSourceIds:[input.plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
  const pending=buildPendingRuntimeBatch(batchId,[input.plan],identity,input.startedAt).sources[0]!;
  const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(input.plan),adapterVersion:pending.adapterVersion};
  const evidenceSubdirectory=batchId;
  const archived=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:input.plan.source.id,evidenceSubdirectory,captureTool:input.result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:input.plan.source.id,artifacts:input.result.fetchEvidence!.artifacts})});
  const archive={workspaceRoot,evidenceSubdirectory,artifacts:archived.artifacts};
  const admission=await issueSourceQualityAdmission({...input,binding,archive});
  if(admission.status!=="ACCEPTED")throw Error(admission.codes.join(","));
  return {identity,pending,binding,archive,admission};
}

describe("Lilly exact official application closure",()=>{
  it("requires the same-ID official shell and rejects UNKNOWN or contradictory responses",()=>{
    const row=syntheticLillyRow(),time=new Date().toISOString();
    const artifact:SourceFetchArtifactDraft={id:"lilly-detail-R-800000",logicalKey:"lilly-detail-R-800000",kind:"OFFICIAL_COMPANY_PAGE",requestedUrl:String(row.applyUrl),finalUrl:String(row.applyUrl),httpStatus:200,contentType:"text/html",capturedAt:time,body:closedBody(row),extractorLocator:"lilly-workday-jobposting-v1"};
    expect(lillyNativeDetail(row,artifact,time)).toEqual({status:"CLOSED"});
    for(const change of [{httpStatus:503},{finalUrl:String(row.applyUrl).replace("R-800000","R-800001")},{body:closedBody(row).replace("R-800000","R-800001")},{body:closedBody(row).replace("postingAvailable:false","postingAvailable:true")},{body:closedBody(row).replace('tenant:"lilly"','tenant:"other"')},{body:closedBody(row)+activeBody(row)},{body:closedBody(row)+'<script type="application/ld+json">{</script>'}])expect(lillyNativeDetail(row,{...artifact,...change},time)).toBeUndefined();
  });
  it("keeps both pages and proves active plus exact closed equals the unchanged raw total",async()=>{
    const input=await capture(52,[8,50]);const {result}=input;
    expect(result.status).toBe("SUCCESS");expect(result.truth.completenessVerified).toBe(true);
    expect(result.jobs).toHaveLength(50);expect(result.observation.expectedJobCount).toBe(52);
    expect(result.fetchEvidence!.fetchCounts).toEqual({rawCount:52,parsedCount:52,validCount:50,parseDiscardCount:0,validationDiscardCount:2});
    expect(result.fetchEvidence!.artifacts).toHaveLength(55);expect(input.requests).toBe(55);
    expect(result.fetchEvidence!.fetchLosses.map(loss=>[loss.details!.pageSequence,loss.details!.recordIndex])).toEqual([[0,8],[1,0]]);
    expect(replay(input)).toBe(true);expect(lillyClosedSourceJobIds(result.fetchEvidence!).size).toBe(2);
    const altered=structuredClone(result.fetchEvidence!);altered.fetchLosses[0]!.details!.recordIndex=9;expect(replay(input,altered)).toBe(false);
    const revived=structuredClone(result.fetchEvidence!);const closed=revived.artifacts.find(a=>a.logicalKey==="lilly-detail-R-800008")!;closed.body=activeBody(input.rows[8]!);expect(replay(input,revived)).toBe(false);
    const allClosed=await capture(1,[0]);expect(allClosed.result.status).toBe("SUCCESS");expect(allClosed.result.jobs).toEqual([]);expect(allClosed.result.truth.completenessVerified).toBe(true);
  });
  it("holds UNKNOWN identity and transport failures without publishing partial jobs",async()=>{
    for(const mode of ["identity","transport"] as const){const {result}=await capture(2,[1],mode);expect(result.status).toBe("FAILED");expect(result.jobs).toEqual([]);expect(result.truth.completenessVerified).toBe(false);}
  });
  it("excludes an already published closed job from the next atomic CURRENT/GRACE/VISIBLE sets",async()=>{
    const root=await mkdtemp(join(tmpdir(),"lilly-closed-synthetic-"));
    try{
      const prior=await capture(2,[]),acceptedPrior=await admit(prior,root,"prior");
      const previousJobs=prior.result.jobs.map(record=>({dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:"ACTIVE" as const,missingSuccessfulCrawlCount:0,firstSeenAt:acceptedPrior.admission.receipt.issuedAt,lastSeenAt:acceptedPrior.admission.receipt.issuedAt}));
      const current=await capture(2,[1]),accepted=await admit(current,root,"current");
      const firstAcceptedCurrentPolicyReceipt={receipt:acceptedPrior.admission.receipt,receiptSha256:acceptedPrior.admission.receiptSha256,expectedBinding:acceptedPrior.admission.receipt.binding};
      const build=()=>buildAtomicRuntimeCommit({plan:current.plan,pending:accepted.pending,identity:accepted.identity,batchId:accepted.binding.batchId,result:current.result,previousJobs,baselineCompletedBeforeCrawl:true,artifacts:accepted.archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:accepted.admission,firstAcceptedCurrentPolicyReceipt});
      for(const commit of [build(),build()]){
        expect(commit.sourceResult.completenessState).toBe("VERIFIED");expect(commit.sourceResult.rawCount).toBe(2);expect(commit.sourceResult.validCount).toBe(1);expect(commit.sourceResult.validationDiscardCount).toBe(1);
        const jobs=commit.commands.filter(command=>command.type==="UPSERT_JOB");expect(jobs).toHaveLength(1);expect(jobs[0]!.record.sourceJobId).toBe(prior.result.jobs[0]!.sourceJobId);expect(jobs[0]!.missingSuccessfulCrawlCount).toBe(0);
      }
    }finally{await rm(root,{recursive:true,force:true});}
  });
});
