/** SYNTHETIC_SQL_TEST_ONLY. Replays pinned retained response bytes through the
 * ordinary owned route using the current test clock. Never live qualification. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { runSourceCrawl, replayStrictSourceQualityEvidenceAsync } from "../src/crawler/runSourceCrawl";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from "../src/crawler/runtimeAtomicEvidence";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl } from "../src/crawler/sourceFetchEvidence";
import { safeOfficialJsonEvidenceUrl } from "../src/crawler/officialJsonEvidence";
import { searchPortableSnapshot } from "../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../src/db/portablePublicSnapshotRepository";
import type { NormalizedJobRecord } from "../src/crawler/normalizedJob";

const [retainedRoot, outputPath] = process.argv.slice(2);
if (!retainedRoot || !outputPath) throw Error("Usage: node --import tsx scripts/verify-dated-sources-owned-retained.ts <retained-source-parent> <synthetic-export.json>");
const hash = (value:string|Uint8Array) => createHash("sha256").update(value).digest("hex");
const cases = [
 {name:"ucb",count:1,evidenceSha256:"6f73966ba714fb5a8bfa4c98584cdef037003ba9d2f1117ba679d33937765f37",originalObservation:"2026-10-01T10:11:47.457Z",
  bodyHashes:["3f64e49176aed4d71cf809ba2b9ce007e09733ff56ee6ec6e56f50fca76ac75d","e431aab7b3839b479b33a48d4aeffe35cc97fe83a16809fd4a795f3b89a3149c"],
  dates:["2026-08-24T05:54:14.000Z"],cities:[["上海"]],publicCityCounts:{北京:0,上海:1,广州:0}},
 {name:"grifols",count:2,evidenceSha256:"9fd222a15db3580ce35fb079c2b29f6449e709cb025fbcb42b37738e36471772",originalObservation:"2026-10-01T10:11:40.476Z",
  bodyHashes:["42f785f2c512f0eeb29e8a718d17e048e182853764e48666fe7e18ddf51d7f3a","a6f4c0b19cf0f6e5e115b1cafbf081e769f599973fbc1c734c166ca22876edae","feb2829491efaec809e6a03635a7af63683c3810ab76110c29f147c4822e84a0"],
  dates:["2026-09-03T00:00:00.000Z","2026-09-28T00:00:00.000Z"],cities:[["上海"],["全国"]],publicCityCounts:{北京:1,上海:2,广州:1}}
] as const;
const exports=[];
const transport=globalThis.fetch;
try {
 for(const fixture of cases){
  const sourceId=`source-${fixture.name}-china-social`;
  const bytes=await readFile(join(retainedRoot,sourceId,"evidence.private.json"));
  assert.equal(hash(bytes),fixture.evidenceSha256,"Unreviewed retained evidence file");
  const original=parsePersistentSourceFetchEvidence(JSON.parse(bytes.toString("utf8")));
  assert.equal(original.artifacts.length,fixture.bodyHashes.length);
  original.artifacts.forEach((artifact,index)=>assert.equal(hash(artifact.body),fixture.bodyHashes[index]));
  const prior=JSON.parse(await readFile(join(retainedRoot,sourceId,"candidates.private.json"),"utf8")).records as NormalizedJobRecord[];
  assert.equal(prior.length,fixture.count);
  assert(prior.every(job=>job.evidence.capturedAt===fixture.originalObservation));
  const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===sourceId)!;
  let cursor=0;const transportErrors:string[]=[];
  // No call can reach the network. All responses consume pinned bytes in order.
  globalThis.fetch=async(input,init)=>{try{
   const requested=String(input),artifact=original.artifacts[cursor];
   assert(artifact,"Unexpected request; offline harness has no network fallback");
   assert.equal(init?.method??"GET",fixture.name==="ucb"&&cursor===1?"POST":"GET");
   const safeUrl=fixture.name==="ucb"?safeOfficialJsonEvidenceUrl(requested):sanitizeEvidenceHttpUrl(requested);
   assert.equal(safeUrl,artifact.requestedUrl);
   assert.equal(safeUrl,artifact.finalUrl);
   const response=new Response(typeof artifact.body==="string"?artifact.body:Buffer.from(artifact.body),{status:artifact.httpStatus!,headers:{"content-type":artifact.contentType!}});
   Object.defineProperty(response,"url",{value:requested});cursor++;return response;
  }catch(error){transportErrors.push(String(error));throw error;}};
  const started=new Date();
  const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
  assert.equal(result.status,"SUCCESS",JSON.stringify({sourceId,cursor,transportErrors,observation:result.observation}));assert.equal(result.truth.completenessVerified,true);
  assert.equal(cursor,original.artifacts.length);assert.equal(result.jobs.length,fixture.count);
  assert.deepEqual(result.fetchEvidence!.fetchCounts,{rawCount:fixture.count,parsedCount:fixture.count,validCount:fixture.count,parseDiscardCount:0,validationDiscardCount:0});
  assert.deepEqual(result.fetchEvidence!.fetchLosses,[]);
  result.fetchEvidence!.artifacts.forEach((artifact,index)=>assert.equal(hash(artifact.body),fixture.bodyHashes[index]));
  const withoutNewFields=({evidence:_e,officialPublishedAt:_date,cities:_cities,...job}:NormalizedJobRecord)=>job;
  assert.deepEqual(result.jobs.map(withoutNewFields),prior.map(withoutNewFields));
  assert.deepEqual(result.jobs.map(job=>job.officialPublishedAt),fixture.dates);
  assert.deepEqual(result.jobs.map(job=>job.cities),fixture.cities);
  assert.equal(await replayStrictSourceQualityEvidenceAsync({plan,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,capturedAt:result.observation.crawledAt.toISOString()}),true);
  const snapshot={lastUpdatedAt:null,coverage:{requiredCompanyCount:40,excludedCompanyCount:1},companies:[{id:plan.company.id,companyName:plan.company.officialChineseName,pinyin:fixture.name,required:true,publishingSourceIds:[sourceId],health:"HEALTHY",jobs:result.jobs.map(job=>({...job,id:job.sourceJobId!,title:job.officialTitle,city:job.cities[0]!,isNew:false}))}]} as unknown as PortablePublicSnapshot;
  const publicCityCounts=Object.fromEntries(["北京","上海","广州"].map(city=>[city,searchPortableSnapshot({city},snapshot).totalJobs]));
  assert.deepEqual(publicCityCounts,fixture.publicCityCounts);
  const workspaceRoot=await mkdtemp(join(tmpdir(),`${fixture.name}-synthetic-sql-`));
  try{
   const identity={releaseCandidateId:`${fixture.name}-synthetic-sql-test`,commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"synthetic-sql-test-only",expectedPlannedSourceIds:[sourceId],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
   const batchId=`${fixture.name}-synthetic-sql-batch`;
   const pending=buildPendingRuntimeBatch(batchId,[plan],identity,started).sources[0]!;
   const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion};
   const evidenceSubdirectory="synthetic-sql/runtime-evidence";
   const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId,artifacts:result.fetchEvidence!.artifacts})});
   const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});
   assert.equal(admission.status,"ACCEPTED");
   const commit=buildAtomicRuntimeCommit({plan,result,pending,identity,batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
   await verifyAtomicRuntimeCommitForPersistence(commit);
   exports.push({classification:"SYNTHETIC_SQL_TEST_ONLY",sourceId,sourceConfigSha256:binding.sourceConfigSha256,originalObservation:fixture.originalObservation,retainedEvidenceSha256:fixture.evidenceSha256,bodyHashes:fixture.bodyHashes,rows:fixture.count,artifacts:archive.artifacts.length,publicCityCounts,archiveVerifiedBeforeExport:true,archiveRemovedAfterExport:true,commit});
  }finally{await rm(workspaceRoot,{recursive:true,force:true});}
 }
}finally{globalThis.fetch=transport;}
const output={classification:"SYNTHETIC_SQL_TEST_ONLY",networkAccess:false,databaseWrites:false,liveQualification:false,currentClockAcquisitionIsSynthetic:true,generatedAt:new Date().toISOString(),sources:exports};
await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(output,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify({...output,sources:exports.map(({commit:_commit,...source})=>source),exportPath:outputPath},null,2));
