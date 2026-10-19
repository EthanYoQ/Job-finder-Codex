import { serialize } from "node:v8";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveSourceEvidence, verifyArchivedSourceEvidence } from "../../src/crawler/artifactArchive";
import { buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from "../../src/crawler/runtimeAtomicEvidence";
import { canonicalStringSetSha256 } from "../../src/crawler/sourceFetchEvidence";
import { buildJobDedupeKey } from "../../src/crawler/normalizedJob";
import { acquirePortableCrawlLease } from "../../src/crawler/portableCrawlLease";
import { compilePortableAtomicSourceEvidenceSql } from "../../src/db/ingestionRepository";
import { buildJobProjectionDeltaReceipt } from "../../src/db/jobProjectionDeltaCompiler";
import { describe, expect, it } from "vitest";
import { candidateCompanies } from "../../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../../src/crawler/sourcePlan";
import { createWorkdaySourceFetch } from "../../src/crawler/workdaySourceFetch";
import { runSourceCrawl } from "../../src/crawler/runSourceCrawl";
import { pfizerDomListSlots, pfizerDomPacketsToPages, replayPfizerRenderedRow } from "../../src/crawler/pfizerRenderedTraversal";
import { PFIZER_API, PFIZER_ENTRY, PFIZER_CHINA, pfizerQuarantinedOfficialIds, pfizerQuarantinedRowId, pfizerSourceJobId, replayPfizerWorkdayTraversal } from "../../src/crawler/pfizerWorkdayTraversal";
import { createOfficialJsonRenderedTraversalValidation, issueBGradeTraversalCertificate } from "../../src/crawler/traversalCertificate";
const at="2026-10-19T01:52:01.208Z";
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-pfizer-china-social")!;
const listUrl=`https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=${PFIZER_CHINA}`;
const good={title:"Complete synthetic control",externalPath:"/job/China---Beijing---Beijing/Control_4965520",bulletFields:["4965520"],locationsText:"China - Beijing - Beijing"};
const bad={bulletFields:["4965522"]};
const domRow='- list:\n      - listitem: "4965522"';
const goodUrl=`https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers${good.externalPath}?Location_Country=${PFIZER_CHINA}`;
async function crawl(rows:unknown[]=[good,bad]) {
 const detailUrls:string[]=[];
 const fetch=createWorkdaySourceFetch({now:()=>new Date(at),http:async req=>{
  const offset=JSON.parse(req.body).offset;
  return {status:200,body:JSON.stringify({total:offset===0?rows.length:0,jobPostings:offset===0?rows:[]}),finalUrl:req.url,contentType:"application/json",capturedAt:at};
 },detailHttp:async req=>{
  detailUrls.push(req.url);if(req.url!==PFIZER_API+good.externalPath)throw Error("Unexpected detail URL");
  return {status:200,finalUrl:req.url,contentType:"application/json",capturedAt:at,body:JSON.stringify({jobPostingInfo:{title:good.title,jobReqId:"4965520",jobPostingSiteId:"PfizerCareers",externalUrl:PFIZER_ENTRY+good.externalPath,location:good.locationsText,country:{descriptor:"China",id:PFIZER_CHINA},jobRequisitionLocation:{country:{descriptor:"China",alpha2Code:"CN"}},posted:true,canApply:true,startDate:"2026-10-09",jobDescription:"Synthetic test responsibilities and requirements. ".repeat(4)}})};
 }});
 return {result:await runSourceCrawl(plan,{isBaseline:false,fetch}),detailUrls};
}
function packets() {
 const listPage={url:listUrl,title:"Search for Jobs",countryFilter:"China clear filter",filterCount:1,searchText:"",pageLabel:"Page 1 of 1",range:"1 - 2 of 2 jobs",totalText:"2 JOBS FOUND",nextControlPresent:false,capturedAt:at,cards:[{href:goodUrl,title:good.title}],domSnapshot:'- region "Search Results":\n  - list "Page 1 of 1":\n    - heading "Complete synthetic control" [level=3]:\n      - link "Complete synthetic control":\n        - /url: '+goodUrl+'\n    - list:\n      - listitem: "4965520"\n    - list:\n      - listitem: "4965522"\n  - navigation "pagination":'};
 return [{listPage,rows:[{officialId:"4965520",externalPath:good.externalPath,title:good.title,detailUrl:goodUrl,capturedAt:at,renderedTitle:good.title,renderedId:"4965520",renderedLocations:[good.locationsText],applyEnabled:true,jsonLd:JSON.stringify({"@type":"JobPosting",identifier:{value:"4965520"},title:good.title,datePosted:"2026-10-09",jobLocation:{address:{addressCountry:"China",addressLocality:"CHN - BJ - Beijing"}}})},{officialId:"4965522",quarantineCode:"PFIZER_LIST_ROW_UNKNOWN",noOmissionVerified:false,domRow,capturedAt:at}]}];
}
function validation() {
 return createOfficialJsonRenderedTraversalValidation({sourceId:"source-pfizer-china-social",companyId:plan.company.id,sourceConfigSha256:sourcePlanConfigSha256(plan),surfaceIds:[plan.source.surfaceId!],channelIds:plan.expectedChannels!.map(c=>c.channelId),pages:pfizerDomPacketsToPages(packets(),"a".repeat(64)),observedAt:at,expiresAt:"2026-10-20T01:52:01.208Z"});
}
describe("Pfizer reviewed incomplete slot quarantine, offline only",()=>{
 it.each([{bulletFields:["4965523"]},{...bad,title:""},{...bad,externalPath:good.externalPath}])("does not broaden admission to %j",async invalid=>{
  expect(pfizerQuarantinedRowId(invalid)).toBeUndefined();const {result}=await crawl([good,invalid]);expect(result.truth.completenessVerified).toBe(false);expect(result.status).toBe("FAILED");
 });
 it("retains raw count, makes no unknown detail request, and issues B only with matching independent slot evidence",async()=>{
  const {result,detailUrls}=await crawl();expect(result.status).toBe("SUCCESS");expect(result.truth.completenessVerified).toBe(true);expect(result.jobs).toHaveLength(1);expect(detailUrls).toEqual([PFIZER_API+good.externalPath]);
  expect(result.fetchEvidence!.fetchCounts).toEqual({rawCount:2,parsedCount:2,validCount:1,parseDiscardCount:0,validationDiscardCount:1});expect(pfizerQuarantinedOfficialIds(result.fetchEvidence!)).toEqual(["4965522"]);
  expect(result.fetchEvidence!.fetchLosses[0]!.details).toEqual({code:"PFIZER_LIST_ROW_UNKNOWN",pageSequence:0,recordIndex:1,noteCode:"NO_OMISSION_NOT_VERIFIED"});
  const input={plan,binding:{releaseCandidateId:"offline",batchId:"offline",sourceResultId:"offline",sourceConfigSha256:sourcePlanConfigSha256(plan)},transportSuccess:true,adapterSuccess:true,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,independentValidation:validation(),validationExecution:"CURRENT_RUN" as const,trigger:"INITIAL_QUALIFICATION" as const,now:new Date(at)};
  const decision=issueBGradeTraversalCertificate(input);expect(decision.status).toBe("CERTIFIED");if(decision.status!=="CERTIFIED")throw Error(JSON.stringify(decision));
  expect(((decision.certificate.independentValidation as any).pages[0]).rawRows[1].rawPayload).toMatchObject({quarantineCode:"PFIZER_LIST_ROW_UNKNOWN",noOmissionVerified:false});expect(result.jobs.some(j=>j.sourceJobId==="pfizer-unresolved:4965522")).toBe(false);
  const tampered=structuredClone(input);tampered.evidence.fetchLosses[0]!.details.noteCode="FULLY_VERIFIED";expect(issueBGradeTraversalCertificate(tampered).status).toBe("REJECTED");
  const missing=structuredClone(input);(missing.independentValidation.pages[0] as any).rawRows.pop();expect(()=>issueBGradeTraversalCertificate(missing)).toThrow(/page capacity|terminal count/);
  const added=structuredClone(result.fetchEvidence!);added.artifacts.push({...added.artifacts[1]!,logicalKey:"pfizer-detail-4965522"});expect(replayPfizerWorkdayTraversal(plan,added,result.jobs,new Date(at))).toBe(false);
 });
 it("rejects duplicate isolated IDs and another unexplained missing DOM card",async()=>{
  expect((await crawl([good,bad,bad])).result.truth.completenessVerified).toBe(false);
  const page=structuredClone(packets()[0]!.listPage);page.cards.pop();expect(()=>pfizerDomListSlots(page)).toThrow();const unknown=structuredClone(packets()[0]!.listPage);unknown.domSnapshot=unknown.domSnapshot.replace('listitem: "4965522"','listitem: "4965523"');expect(()=>pfizerDomListSlots(unknown)).toThrow();
 });
 it("refuses a fabricated URL, title, activity, or no-omission claim on the unknown row",()=>{
  const pages=pfizerDomPacketsToPages(packets(),"b".repeat(64));for(const [field,value] of [["externalPath",good.externalPath],["title","Old title"],["applyEnabled",true],["noOmissionVerified",true]]){const row=structuredClone(pages[0]!.rawRows[1]!);row.rawPayload[String(field)]=value;expect(()=>replayPfizerRenderedRow(row,1)).toThrow();}
  const p=packets();p[0]!.listPage.domSnapshot=p[0]!.listPage.domSnapshot.replace('listitem: "4965522"','listitem: "4965523"');expect(()=>pfizerDomPacketsToPages(p,"b".repeat(64))).toThrow();
 });
});

it("preserves exact prior Pfizer identity and timestamp as GRACE, leaves OFFLINE offline, and diffs all other missing jobs normally",async()=>{
 const {result}=await crawl(),oldAt="2026-10-18T01:00:00.000Z";
 const identity={releaseCandidateId:"pfizer-quarantine-offline",commitSha:"a".repeat(64),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"test",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:canonicalStringSetSha256([plan.source.id]),expectedPlannedSourceCount:1};
 const batchId="pfizer-quarantine-batch",pending=buildPendingRuntimeBatch(batchId,[plan],identity,new Date(at)).sources[0]!;
 const workspaceRoot=await mkdtemp(join(tmpdir(),"pfizer-quarantine-offline-"));
 try {
  const binding={workspaceRoot,releaseCandidateId:identity.releaseCandidateId,batchId,sourceId:plan.source.id,sourceResultId:pending.id,evidenceSubdirectory:"phase-1/runtime-evidence"};
  const archived=await archiveSourceEvidence({...binding,captureTool:result.fetchEvidence!.captureTool,artifacts:result.fetchEvidence!.artifacts});
  const artifacts=await verifyArchivedSourceEvidence({...binding,artifacts:archived.artifacts});
  // Fully synthetic historical pathname exercises the existing source-ID hash and numeric suffix formula.
  const priorPath="/job/China---Synthetic---City/Synthetic_Old_4965522-1";
  const snapshot=(path:string)=>{const record={...structuredClone(result.jobs[0]!),officialTitle:"Synthetic old title must remain unchanged",officialUrl:PFIZER_ENTRY+path,sourceJobId:pfizerSourceJobId(path),evidence:{...result.jobs[0]!.evidence,capturedAt:oldAt}};return {dedupeKey:buildJobDedupeKey(record),record,lifecycleStatus:"ACTIVE" as const,missingSuccessfulCrawlCount:0,firstSeenAt:oldAt,lastSeenAt:oldAt};};
  const unknown=snapshot(priorPath),missing=snapshot("/job/China/Ordinary_missing_4999999");
  const common={plan,pending,identity,batchId,result,baselineCompletedBeforeCrawl:true,artifacts,completedAt:new Date(at),publicationPolicy:"SOURCE_ATOMIC_LAST_GOOD_V1" as const,independentTraversalValidation:validation(),independentTraversalValidationExecution:"CURRENT_RUN" as const,independentTraversalValidationTrigger:"INITIAL_QUALIFICATION" as const};
  for(const state of ["ACTIVE","OFFLINE"] as const){
   const previous={...unknown,lifecycleStatus:state,missingSuccessfulCrawlCount:state==="ACTIVE"?0:3};
   const commit=buildAtomicRuntimeCommit({...common,previousJobs:[previous,missing]});
   expect(commit.sourceResult.completenessState).toBe("VERIFIED");await verifyAtomicRuntimeCommitForPersistence(commit);
   const held=commit.commands.find(c=>c.type==="UPSERT_JOB"&&c.dedupeKey===unknown.dedupeKey)!;
   if(held.type!=="UPSERT_JOB")throw Error("missing held command");
   expect(held.record).toEqual(unknown.record);expect(held.lastSeenAt).toBe(oldAt);expect(held.firstSeenAt).toBe(oldAt);expect(held.lifecycleStatus).toBe(state);expect(held.missingSuccessfulCrawlCount).toBe(state==="ACTIVE"?1:3);expect(held.visibleInFrontend).toBe(state==="ACTIVE");
   const ordinary=commit.commands.find(c=>c.type==="UPSERT_JOB"&&c.dedupeKey===missing.dedupeKey)!;if(ordinary.type!=="UPSERT_JOB")throw Error("missing normal diff command");expect(ordinary.lifecycleStatus).toBe("OFFLINE");expect(ordinary.missingSuccessfulCrawlCount).toBe(1);
   const fresh=commit.commands.find(c=>c.type==="UPSERT_JOB"&&c.dedupeKey===buildJobDedupeKey(result.jobs[0]!))!;if(fresh.type!=="UPSERT_JOB")throw Error("missing fresh command");expect(fresh.lastSeenAt).toBe(at);expect(fresh.missingSuccessfulCrawlCount).toBe(0);
   const lease=await acquirePortableCrawlLease({$transaction:work=>work({$queryRawUnsafe:async<T>(_sql:string,...values:unknown[])=>[{holderId:values[1]}] as T})});
   expect(await compilePortableAtomicSourceEvidenceSql(commit,lease)).toContain("Job");
   if(state==="ACTIVE"){
    const projectionForCommand=(c:any)=>({companyId:c.record.companyId,sourceId:c.record.sourceId,dedupeKey:c.dedupeKey,sourceJobId:c.record.sourceJobId??null,officialTitle:c.record.officialTitle,officialUrl:c.record.officialUrl,listUrl:c.record.listUrl??null,locationRaw:c.record.locationRaw,city:c.record.cities[0],cities:c.record.cities,officialPublishedAt:c.record.officialPublishedAt??null,missingSuccessCount:c.missingSuccessfulCrawlCount,lifecycleStatus:c.lifecycleStatus,visibleInFrontend:c.visibleInFrontend,isNew:c.isNew});
    const priorSource={...commit.sourceResult,id:commit.sourceResult.id+"-prior",finishedAt:new Date(oldAt)};
    const priorCommands=[...commit.commands.filter(c=>c.type==="UPSERT_CRAWL_OBSERVATION").map(c=>({...c,observation:{...c.observation,crawledAt:new Date(oldAt)}})),{...held,missingSuccessfulCrawlCount:0,lastSeenAt:oldAt}];
    const first=buildJobProjectionDeltaReceipt({sourceResult:priorSource,commands:priorCommands,previousAccepted:null,projectionForCommand});
    const firstRow={...priorSource,completenessCertificate:first.receipt,completenessCertificateSha256:first.sha256};
    const second=buildJobProjectionDeltaReceipt({sourceResult:commit.sourceResult,commands:commit.commands,previousAccepted:firstRow,projectionForCommand});
    const thirdAt=new Date(Date.parse(at)+1000).toISOString();
    const third=buildJobProjectionDeltaReceipt({sourceResult:{...commit.sourceResult,id:commit.sourceResult.id+"-third",finishedAt:new Date(thirdAt)},commands:commit.commands.map(c=>c.type==="UPSERT_JOB"&&c.missingSuccessfulCrawlCount===0?{...c,lastSeenAt:thirdAt}:c),previousAccepted:{...commit.sourceResult,completenessCertificate:second.receipt,completenessCertificateSha256:second.sha256},projectionForCommand});
    const member=third.receipt.members.find(m=>m.setKind==="GRACE")!;expect(member.lastPresentResultId).toBe(priorSource.id);expect(member.lifecycleLastSeenAt).toBe(oldAt);expect(member.lastConfirmedObservedAt).toBe(first.receipt.observedAt);
    // Execute the actual deployed reader bundles, not the older source-domain copy.
    for(const readerName of ["reader-main","reader-fallback"]){
     const readerRoot=process.env.PFIZER_READER_ROOT??join(process.cwd(),"..");
     const priorReceipt={...commit.sourceResult.completenessCertificate as any,mainTraversal:{...(commit.sourceResult.completenessCertificate as any).mainTraversal,canonicalMatchKeySetSha256:canonicalStringSetSha256([unknown.record.sourceJobId!])}};
     const priorReaderRow={...priorSource,canonicalCurrentJobSetSha256:canonicalStringSetSha256([unknown.dedupeKey]),canonicalGraceJobSetSha256:canonicalStringSetSha256([]),canonicalVisibleJobSetSha256:canonicalStringSetSha256([unknown.dedupeKey]),observations:[{crawledAt:new Date(oldAt)}]};
     const selected={result:{...commit.sourceResult,id:third.receipt.binding.sourceResultId,finishedAt:new Date(thirdAt),observations:[{crawledAt:new Date(at)}]},receipt:commit.sourceResult.completenessCertificate,deltaReceipt:third.receipt,historicalObservations:new Map([[priorSource.id,{result:priorReaderRow,receipt:priorReceipt}]])};
     const rows=commit.commands.filter(c=>c.type==="UPSERT_JOB").map(c=>({...projectionForCommand(c),id:c.dedupeKey,category:"OTHER",humanCorrectedCategory:null,auxiliaryChineseTitle:null,humanCorrectedTitle:null,officialPublishedAt:c.record.officialPublishedAt?new Date(c.record.officialPublishedAt):null,lastSeenAt:new Date(c.lastSeenAt)}));
     const selection={companyId:plan.company.id,sourceId:plan.source.id,currentConfigSha256:sourcePlanConfigSha256(plan),policyId:"STRICT_PLAN_BOUND_INDEPENDENT_TRAVERSAL_REPLAY_V2",state:"PUBLISHING",health:"HEALTHY",freshness:"FRESH",reasons:[],visibilityFloor:oldAt,selectedSourceResultId:third.receipt.binding.sourceResultId,lastAttemptAt:thirdAt,lastAcceptedAt:thirdAt,lastSuccessAt:thirdAt,lastAcceptedJobCount:1,selected};
     const readerInput=join(workspaceRoot,readerName+".v8");
     await writeFile(readerInput,serialize({selection,members:third.receipt.members,rows,currentTime:thirdAt,historicalMembers:first.receipt.members,unknownKey:unknown.dedupeKey,missingKey:missing.dedupeKey,oldAt,oldTitle:unknown.record.officialTitle}));
     const checked=spawnSync(process.execPath,["--import","tsx",join(process.cwd(),"tests/crawler/pfizerReaderQuarantine.check.ts"),join(readerRoot,readerName,"src/domain/portablePublicSnapshot.ts"),readerInput],{cwd:process.cwd(),encoding:"utf8"});
     expect(checked.status,readerName+checked.stdout+checked.stderr).toBe(0);

    }

   }
  }
  const ambiguous={...unknown,dedupeKey:unknown.dedupeKey+":duplicate"};expect(()=>buildAtomicRuntimeCommit({...common,previousJobs:[unknown,ambiguous]})).toThrow("PFIZER_UNKNOWN_PRIOR_IDENTITY_AMBIGUOUS");
 } finally {await rm(workspaceRoot,{recursive:true,force:true});}
});
