import {buildJobProjectionDeltaReceipt} from "../../src/db/jobProjectionDeltaCompiler";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSourceEvidence, verifyArchivedSourceEvidence } from "../../src/crawler/artifactArchive";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import { persistentOfficialJsonJobId } from "../../src/crawler/officialJsonEvidence";
import { rocheDeniedDetail } from "../../src/crawler/rocheChinaQuality";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createOfficialJsonSourceFetch } from "../../src/crawler/officialJsonSourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { issueAGradeOfficialTotalCertificate } from "../../src/crawler/completenessCertificate";
import { sha256Bytes } from "../../src/crawler/sourceFetchEvidence";
import { describe, expect, it } from "vitest";
import { rocheNativeDetail, rocheNativeDetailUrl } from "../../src/crawler/rocheChinaQuality";
import type { SourceFetchArtifactDraft } from "../../src/crawler/sourceFetchEvidence";

const started = "2026-10-02T12:00:00.000Z";
const raw = { reqId: "202609-123373", jobId: "202609-123373", jobSeqNo: "ROCHGLOBAL202609123373EXTERNALZHCN",
  title: "Role", applyUrl: "https://roche.wd3.myworkdayjobs.com/roche-ext/job/Shanghai/Role_202609-123373/apply",
  postedDate: "2026-09-30T00:00:00.000+0000", country: "中国大陆", location: "上海, 中国大陆", multi_location: ["上海, 中国大陆"],
  siteType: "external", visibilityType: "External", jobVisibility: ["external"], locale: "zh_cn" };
const info = { title: "Role", jobReqId: raw.reqId, jobPostingId: "Role_202609-123373", jobPostingSiteId: "roche-ext",
  externalUrl: raw.applyUrl.replace(/\/apply$/, ""), location: "Shanghai", country: { descriptor: "China" },
  posted: true, canApply: true, jobDescription: "<p>Responsible for laboratory quality and process compliance.</p>", startDate: "2026-09-30" };
function artifact(row = raw, patch: Record<string, unknown> = {}): SourceFetchArtifactDraft {
  const url = rocheNativeDetailUrl(row)!;
  return { id: `roche-detail-${row.reqId}`, logicalKey: `roche-detail-${row.reqId}`, kind: "ATS_API_RESPONSE", requestedUrl: url, finalUrl: url, httpStatus: 200,
    contentType: "application/json", capturedAt: "2026-10-02T12:02:00.000Z", bodyRepresentation: "EXACT",
    extractorLocator: "roche-workday-jobposting-v1", body: JSON.stringify({ jobPostingInfo: {...info, ...patch} }) };
}
describe("Roche native application and public field binding", () => {
  it("binds exact official identities, active native detail and timestamp without age filtering", () => {
    expect(rocheNativeDetail(raw, artifact(), started)).toMatchObject({ title: "Role", cities: ["上海"], locationRaw: "上海, 中国大陆",
      officialUrl: raw.applyUrl, officialPublishedAt: "2026-09-30T00:00:00.000Z" });
  });
  it.each([{posted:false},{canApply:false},{jobReqId:"different"},{title:" "},{title:"password=synthetic-test-value"},{country:{descriptor:"Ireland"},location:"Dublin"},{jobPostingId:"wrong"},
    {externalUrl:"https://evil.test"},{jobDescription:""}])("rejects conflicting native identity/application %j", patch => {
    expect(rocheNativeDetail(raw, artifact(raw, patch), started)).toBeUndefined();
  });
  it("uses the exact-ID native title while preserving both conflicting title inputs", () => {
    const row = { ...raw, title: "List category label" };
    const detail = artifact(row, { title: "  Native job title  " });
    const rawBefore = JSON.stringify(row), bodyBefore = detail.body;
    expect(rocheNativeDetail(row, detail, started)?.title).toBe("Native job title");
    expect(JSON.stringify(row)).toBe(rawBefore);
    expect(detail.body).toBe(bodyBefore);
  });
  it("rejects absent, redirected, stale, or non-exact native evidence", () => {
    expect(rocheNativeDetail(raw, undefined, started)).toBeUndefined();
    for (const patch of [{finalUrl:"https://evil.test"},{capturedAt:"2026-10-01T00:00:00.000Z"},{bodyRepresentation:"REDACTED"}])
      expect(rocheNativeDetail(raw, {...artifact(),...patch} as SourceFetchArtifactDraft, started)).toBeUndefined();
  });
  it("accepts the native empty slug for a Chinese title", () => {
    const row={...raw,applyUrl:raw.applyUrl.replace("Role_", "_")};
    expect(rocheNativeDetail(row, artifact(row,{jobPostingId:"_202609-123373",externalUrl:row.applyUrl.replace(/\/apply$/, "")}),started)).toBeDefined();
  });
  it("keeps all corroborated mainland locations", () => {
    const row = {...raw, multi_location:["上海, 中国大陆", "北京, 北京, 中国大陆"]};
    expect(rocheNativeDetail(row, artifact(row,{additionalLocations:["Beijing"]}),started)?.cities).toEqual(["上海","北京"]);
  });
  it("retains positive China roles with inconsistent locality as city pending", () => {
    const row={...raw,location:"抚州, 福建, 中国大陆",multi_location:["抚州, 福建, 中国大陆"]};
    expect(rocheNativeDetail(row,artifact(row,{location:"Fuzhou"}),started)).toMatchObject({cities:["城市待核"],locationRaw:row.location});
  });
  it("preserves the native publication suffix and corroborates a mainland alternative", () => {
    const row={...raw,country:"波兰",location:"Warsaw, 波兰",multi_location:["Warsaw, 波兰","苏州, 江苏, 中国大陆"],
      applyUrl:raw.applyUrl.replace("Shanghai", "Warsaw").replace("/apply","-1/apply")};
    const a=artifact(row,{location:"Warsaw",additionalLocations:["Suzhou"],country:{descriptor:"Poland"},
      jobPostingId:"Role_202609-123373-1",externalUrl:row.applyUrl.replace(/\/apply$/,"")});
    expect(rocheNativeDetail(row,a,started)?.cities).toEqual(["苏州"]);
    expect(rocheNativeDetail(row,artifact(row,{location:"Warsaw",country:{descriptor:"Poland"}}),started)).toBeUndefined();
  });
  it("does not infer China scope from a generic location", () => {
    const row={...raw,multi_location:["Remote"]};
    expect(rocheNativeDetail(row,artifact(row),started)).toBeUndefined();
  });
  it("keeps an unparseable publication field unknown rather than fabricating midnight", () => {
    const row={...raw,postedDate:"2026-09-30"};
    expect(rocheNativeDetail(row,artifact(row),started)?.officialPublishedAt).toBeUndefined();
  });
});

it("runs current Roche acquisition through native details and rejects output-only tampering", async () => {
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-roche-china-social")!;
  const listed = { ...raw, title: "List category label" };
  const urls:string[]=[]; let posts=0; let clock=0;
  const fetcher=createOfficialJsonSourceFetch({now:()=>new Date(clock++===0?started:"2026-10-02T12:00:03.000Z"),http:async request=>{
    urls.push(request.url);
    const body=request.method==="POST" ? JSON.stringify({refineSearch:{totalHits:1,data:{jobs:posts++===0?[]:[listed],
      aggregations:posts===1?[{field:"country",value:{中国大陆:1}}]:[]}}}) :
      request.url.includes("/wday/cxs/") ? artifact().body as string :
      '<script>var phApp={"widgetApiEndpoint":"https://careers.roche.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"ROCHGLOBAL","pageName":"search-results","pageId":"page11-ds"};</script>';
    return {status:200,body,finalUrl:request.url,capturedAt:request.url===plan.source.officialEntryUrl?"2026-10-02T12:00:01.000Z":"2026-10-02T12:00:02.000Z",contentType:request.method==="POST"||request.url.includes("/wday/cxs/")?"application/json":"text/html"};
  }});
  const result=await runSourceCrawl(plan,{fetch:fetcher});
  expect(urls).toContain(rocheNativeDetailUrl(raw));
  expect(result.truth).toMatchObject({completenessVerified:true});
  expect(result.jobs[0]).toMatchObject({officialTitle:"Role",officialPublishedAt:"2026-09-30T00:00:00.000Z",cities:["上海"]});
  const evidence=result.fetchEvidence!, declaration=evidence.declaredCompleteness!;
  const listArtifact=evidence.artifacts.find(a=>a.logicalKey==="phenom-page-0000")!;
  const detailArtifact=evidence.artifacts.find(a=>a.logicalKey===`roche-detail-${raw.reqId}`)!;
  expect(listArtifact.bodyRepresentation).toBe("EXACT");
  expect(detailArtifact.bodyRepresentation).toBe("EXACT");
  expect(JSON.parse(listArtifact.body as string).refineSearch.data.jobs[0].title).toBe(listed.title);
  expect(JSON.parse(detailArtifact.body as string).jobPostingInfo.title).toBe(info.title);

  const original=evidence.artifacts.find(a=>a.logicalKey===declaration.artifactLogicalKey)!;
  const candidate={binding:{releaseCandidateId:"rc-roche",batchId:"batch-roche",sourceResultId:"result-roche",sourceConfigSha256:sourcePlanConfigSha256(plan)},
    plan,transportSuccess:true,adapterSuccess:true,evidence,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,
    officialArtifactSha256:sha256Bytes(typeof original.body==="string"?Buffer.from(original.body):original.body).sha256};
  expect(issueAGradeOfficialTotalCertificate(candidate)).toMatchObject({status:"CERTIFIED"});
  for (const key of ["phenom-entry-0000","phenom-facet-global","phenom-facet-country","phenom-page-0000"]) {
    for (const patch of [{httpStatus:503},{contentType:"text/plain"},{capturedAt:"2026-10-02T12:31:02.000Z"}]) {
      const changed=structuredClone(evidence); Object.assign(changed.artifacts.find(a=>a.logicalKey===key)!,patch);
      expect(issueAGradeOfficialTotalCertificate({...candidate,evidence:changed})).toMatchObject({status:"REJECTED"});
    }
  }
  for (const title of ["Forged", listed.title])
    expect(issueAGradeOfficialTotalCertificate({...candidate,jobs:result.jobs.map(job=>({...job,officialTitle:title}))})).toMatchObject({status:"REJECTED"});
});

it("isolates only the approved official denial, continues details and preserves old ACTIVE/GRACE without reviving OFFLINE",async()=>{
 const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-roche-china-social")!;
 const denied={...raw,reqId:"202610-125686",jobId:"202610-125686",jobSeqNo:"ROCHGLOBAL202610125686EXTERNALZHCN",applyUrl:raw.applyUrl.replaceAll(raw.reqId,"202610-125686")};
 const deniedArtifact={...artifact(denied),httpStatus:403,body:JSON.stringify({errorCode:"S22",httpStatus:403,message:"permission denied"})};
 expect(rocheDeniedDetail(denied,deniedArtifact,started)).toBe(true);
 for(const patch of [{httpStatus:502},{finalUrl:"https://evil.test"},{capturedAt:"2026-10-02T13:00:00.000Z"},{body:JSON.stringify({errorCode:"OTHER",httpStatus:403,message:"permission denied"})}])expect(rocheDeniedDetail(denied,{...deniedArtifact,...patch},started)).toBe(false);
 expect(rocheDeniedDetail(raw,{...artifact(),httpStatus:403,body:deniedArtifact.body},started)).toBe(false);
 let posts=0,clock=0;const visited:string[]=[];
 const fetcher=createOfficialJsonSourceFetch({now:()=>new Date(clock++===0?started:"2026-10-02T12:00:03.000Z"),http:async request=>{
   visited.push(request.url);const isDenied=request.url===rocheNativeDetailUrl(denied);
   const body=request.method==="POST"?JSON.stringify({refineSearch:{totalHits:2,data:{jobs:posts++===0?[]:[denied,raw],aggregations:posts===1?[{field:"country",value:{中国大陆:2}}]:[]}}}):request.url.includes("/wday/cxs/")?(isDenied?deniedArtifact.body:artifact().body):'<script>var phApp={"widgetApiEndpoint":"https://careers.roche.com/widgets","country":"cn","deviceType":"desktop","locale":"zh_cn","refNum":"ROCHGLOBAL","pageName":"search-results","pageId":"page11-ds"};</script>';
   return {status:isDenied?403:200,body:body as string,finalUrl:request.url,capturedAt:request.url===plan.source.officialEntryUrl?"2026-10-02T12:00:01.000Z":"2026-10-02T12:00:02.000Z",contentType:request.method==="POST"||request.url.includes("/wday/cxs/")?"application/json":"text/html"};
 }});
 const result=await runSourceCrawl(plan,{fetch:fetcher});expect(result.truth).toMatchObject({completenessVerified:true});expect(result.jobs).toHaveLength(1);expect(visited).toContain(rocheNativeDetailUrl(raw));expect(result.fetchEvidence!.fetchCounts).toMatchObject({rawCount:2,validCount:1,validationDiscardCount:1});
 const oldAt="2026-10-01T12:00:00.000Z",at="2026-10-02T12:00:03.000Z";
 const identity={releaseCandidateId:"roche-quarantine-offline",commitSha:"a".repeat(64),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"test",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:canonicalStringSetSha256([plan.source.id]),expectedPlannedSourceCount:1};
 const batchId="roche-quarantine-batch",pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(started)).sources[0]!;
 const workspaceRoot=await mkdtemp(join(tmpdir(),"roche-quarantine-offline-"));
 try {
   const binding={workspaceRoot,releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id,evidenceSubdirectory:"phase-1/runtime-evidence"};
   const archived=await archiveSourceEvidence({...binding,captureTool:result.fetchEvidence!.captureTool,artifacts:result.fetchEvidence!.artifacts});
   const artifacts=await verifyArchivedSourceEvidence({...binding,artifacts:archived.artifacts});
   const record={...structuredClone(result.jobs[0]!),officialTitle:"Old exact title",officialUrl:denied.applyUrl,sourceJobId:persistentOfficialJsonJobId(denied.jobSeqNo),evidence:{...result.jobs[0]!.evidence,capturedAt:oldAt}};
   for(const [state,count] of [["ACTIVE",0],["ACTIVE",1],["OFFLINE",3]] as const){
     const previous={dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:state,missingSuccessfulCrawlCount:count,firstSeenAt:oldAt,lastSeenAt:oldAt};
     const commit=buildAtomicRuntimeCommit({plan,pending,identity,batchId,result,baselineCompletedBeforeCrawl:true,artifacts,completedAt:new Date(at),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1",previousJobs:[previous]});
     expect(commit.sourceResult.completenessState).toBe("VERIFIED");await verifyAtomicRuntimeCommitForPersistence(commit);
     const held=commit.commands.find(c=>c.type==="UPSERT_JOB"&&c.dedupeKey===previous.dedupeKey)!;expect(held).toMatchObject({record,lastSeenAt:oldAt,lifecycleStatus:state,missingSuccessfulCrawlCount:state==="ACTIVE"?1:count});
     if(state==="ACTIVE") {
       const projection=(c:any)=>({companyId:c.record.companyId,sourceId:c.record.sourceId,dedupeKey:c.dedupeKey,sourceJobId:c.record.sourceJobId??null,officialTitle:c.record.officialTitle,officialUrl:c.record.officialUrl,listUrl:c.record.listUrl??null,locationRaw:c.record.locationRaw,city:c.record.cities[0],cities:c.record.cities,officialPublishedAt:c.record.officialPublishedAt??null,missingSuccessCount:c.missingSuccessfulCrawlCount,lifecycleStatus:c.lifecycleStatus,visibleInFrontend:c.visibleInFrontend,isNew:c.isNew});
       const current=commit.sourceResult,priorId=current.id+"-old";
       const oldCert={...current.completenessCertificate as any,observedAt:oldAt};
       const oldSource={...current,id:priorId,startedAt:new Date(oldAt),finishedAt:new Date(oldAt),completenessCertificate:oldCert,
         canonicalCurrentJobSetSha256:canonicalStringSetSha256([previous.dedupeKey]),canonicalGraceJobSetSha256:canonicalStringSetSha256([]),canonicalVisibleJobSetSha256:canonicalStringSetSha256([previous.dedupeKey])};
       const oldCommands=[...commit.commands.filter(c=>c.type==="UPSERT_CRAWL_OBSERVATION").map((c:any)=>({...c,observation:{...c.observation,crawledAt:new Date(oldAt)}})),{...held,missingSuccessfulCrawlCount:0,lastSeenAt:oldAt}];
       const oldDelta=buildJobProjectionDeltaReceipt({sourceResult:oldSource,commands:oldCommands as any,previousAccepted:null,projectionForCommand:projection});
       const delta=buildJobProjectionDeltaReceipt({sourceResult:current,commands:commit.commands,previousAccepted:{...oldSource,completenessCertificate:oldDelta.receipt,completenessCertificateSha256:oldDelta.sha256},projectionForCommand:projection});
       function dbRow(source:any,delta:any,when:string){return {...source,atomicCommitState:"COMMITTED",batch:{id:source.batchId,releaseCandidateId:source.releaseCandidateId,kind:"SCHEDULED"},completenessCertificate:delta.receipt,completenessCertificateSha256:delta.sha256,observations:[{sourceId:source.sourceId,sourceResultId:source.id,batchId:source.batchId,releaseCandidateId:source.releaseCandidateId,sourceConfigSha256:source.sourceConfigHash,adapterVersion:source.adapterVersion,observedFrom:source.startedAt,observedTo:source.finishedAt,crawledAt:new Date(when),successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true,canonicalOutputSha256:source.canonicalOutputSetSha256}]};}
       const rows=commit.commands.filter(c=>c.type==="UPSERT_JOB").map((c:any)=>({...projection(c),id:c.dedupeKey,category:"OTHER",humanCorrectedCategory:null,auxiliaryChineseTitle:null,humanCorrectedTitle:null,officialPublishedAt:c.record.officialPublishedAt?new Date(c.record.officialPublishedAt):null,lastSeenAt:new Date(c.lastSeenAt)}));
       for(const reader of ["reader-main","reader-fallback"]){
         const {selectPortableSourceSnapshots,projectPortableSourceJobs}=await import(`../../../${reader}/src/domain/portablePublicSnapshot.ts`);
         const options={currentTime:new Date(at)};
         const selection=selectPortableSourceSnapshots([plan],[dbRow(oldSource,oldDelta,oldAt),dbRow(current,delta,result.observation.crawledAt.toISOString())],options)[0]!;
         expect(selection.state,reader+JSON.stringify(selection.reasons)).toBe("PUBLISHING");
         const projected=projectPortableSourceJobs(selection,delta.receipt.members,rows,options,oldDelta.receipt.members);
         expect(projected.state,reader+JSON.stringify(projected.reasons)).toBe("PUBLISHING");expect(projected.visibleJobCount).toBe(2);
         expect(projected.jobs.find((j:any)=>j.id===previous.dedupeKey)).toMatchObject({inGrace:true,lastSeenAt:oldAt,lastConfirmedObservedAt:oldAt,officialTitle:record.officialTitle});
         expect(projectPortableSourceJobs(selection,delta.receipt.members,rows,options,[]).state).toBe("HOLD");
       }
     }

   }
 }finally{await rm(workspaceRoot,{recursive:true,force:true});}
});
