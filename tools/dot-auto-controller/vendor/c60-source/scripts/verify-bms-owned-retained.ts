/** SYNTHETIC_SQL_TEST_ONLY: pinned historical bytes and a synthetic current-clock
 * owned route. Never a fresh source observation or production admission receipt. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { candidateCompanies } from "../src/data/companyRegistry";
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from "../src/crawler/sourcePlan";
import { runSourceCrawl } from "../src/crawler/runSourceCrawl";
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from "../src/crawler/sourceQualityAdmission";
import { archiveSourceEvidence } from "../src/crawler/artifactArchive";
import { bindRuntimeEvidenceArtifactIds, buildPendingRuntimeBatch, buildAtomicRuntimeCommit, verifyAtomicRuntimeCommitForPersistence } from "../src/crawler/runtimeAtomicEvidence";
import { parsePersistentSourceFetchEvidence, sanitizeEvidenceHttpUrl } from "../src/crawler/sourceFetchEvidence";
import { searchPortableSnapshot } from "../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../src/db/portablePublicSnapshotRepository";
import type { NormalizedJobRecord } from "../src/crawler/normalizedJob";

const [directory,outputPath]=process.argv.slice(2);
if(!directory||!outputPath)throw Error("Usage: node --import tsx scripts/verify-bms-owned-retained.ts <retained-BMS-folder> <synthetic-export.json>");
const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const evidenceSha256="bc85285c4e4cb74a7b438f14fc1e89d62984a04d573ed618f07037e3e64e7c01";
const bodyHashes=["8783d2578dd861200750134af378878b3dc820999e7d1f00dd01f1b0798b3d30","f3f15c06bbe431afcebc34963b86337144d623d1087db2be2e19839660c8430f","e72fe8cb1cb851b770de8f763fbdc7c20051bc3236a92fd05edd4f6f09a51ae3"];
const bytes=await readFile(join(directory,"evidence.private.json"));assert.equal(hash(bytes),evidenceSha256);
const evidence=parsePersistentSourceFetchEvidence(JSON.parse(bytes.toString("utf8")));assert.equal(evidence.artifacts.length,3);
evidence.artifacts.forEach((artifact,i)=>assert.equal(hash(artifact.body),bodyHashes[i]));
const original=JSON.parse(await readFile(join(directory,"candidates.private.json"),"utf8")).records as NormalizedJobRecord[];
const raw=evidence.artifacts.flatMap(artifact=>JSON.parse(String(artifact.body)).data.positions) as Array<{id:string;postedTs:number;locations:string[]}>;
assert.equal(raw.length,22);assert.equal(original.length,22);assert(original.every(job=>job.evidence.capturedAt==="2026-10-01T10:10:30.512Z"));
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-bms-china-social")!;
let cursor=0;const originalFetch=globalThis.fetch;
const workspaceRoot=await mkdtemp(join(tmpdir(),"bms-synthetic-sql-"));
try{
 globalThis.fetch=async(input,init)=>{
  const requested=String(input),artifact=evidence.artifacts[cursor];assert(artifact,"Unexpected request; no network fallback");
  assert.equal(init?.method??"GET","GET");assert.equal(requested,`https://jobs.bms.com/api/pcsx/search?domain=bms.com&query=&location=china&start=${cursor*10}&sort_by=distance`);
  assert.equal(sanitizeEvidenceHttpUrl(requested),artifact.requestedUrl);assert.equal(sanitizeEvidenceHttpUrl(requested),artifact.finalUrl);
  const response=new Response(typeof artifact.body==="string"?artifact.body:Buffer.from(artifact.body),{status:artifact.httpStatus!,headers:{"content-type":artifact.contentType!}});Object.defineProperty(response,"url",{value:requested});cursor++;return response;
 };
 const started=new Date(),result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
 assert.equal(result.status,"SUCCESS");assert.equal(result.truth.completenessVerified,true);assert.equal(cursor,3);assert.equal(result.jobs.length,22);
 assert.deepEqual(result.fetchEvidence!.fetchCounts,{rawCount:22,parsedCount:22,validCount:22,parseDiscardCount:0,validationDiscardCount:0});assert.deepEqual(result.fetchEvidence!.fetchLosses,[]);
 result.fetchEvidence!.artifacts.forEach((artifact,i)=>assert.equal(hash(artifact.body),bodyHashes[i]));
 const previousFields=({cities:_cities,officialPublishedAt:_date,evidence:_evidence,...job}:NormalizedJobRecord)=>job;
 assert.deepEqual(result.jobs.map(previousFields),original.map(previousFields));
 assert.deepEqual(result.jobs.map(job=>job.locationRaw),raw.map(job=>job.locations[0]));
 assert.deepEqual(result.jobs.map(job=>job.officialPublishedAt),raw.map(job=>new Date(job.postedTs*1000).toISOString()));
 const cityCounts:Record<string,number>={};for(const job of result.jobs){assert.equal(job.cities.length,1);const city=job.cities[0]!;cityCounts[city]=(cityCounts[city]??0)+1;assert.notEqual(city,"全国");}
 assert.deepEqual(cityCounts,{中国:2,西安:1,重庆:1,郑州:1,石家庄:2,天津:3,南京:1,青岛:1,杭州:1,上海:9});
 const snapshot={lastUpdatedAt:null,coverage:{requiredCompanyCount:40,excludedCompanyCount:1},companies:[{id:plan.company.id,companyName:plan.company.officialChineseName,pinyin:"bms",required:true,publishingSourceIds:[plan.source.id],health:"HEALTHY",jobs:result.jobs.map(job=>({...job,id:job.sourceJobId!,city:job.cities[0]!,title:job.officialTitle,isNew:false}))}]} as unknown as PortablePublicSnapshot;
 const publicCityCounts=Object.fromEntries(["北京","上海","广州"].map(city=>[city,searchPortableSnapshot({city},snapshot).totalJobs]));assert.deepEqual(publicCityCounts,{北京:0,上海:9,广州:0});
 const identity={releaseCandidateId:"bms-synthetic-sql-test",commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"synthetic-sql-test-only",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
 const batchId="bms-synthetic-sql-batch",pending=buildPendingRuntimeBatch(batchId,[plan],identity,started).sources[0]!;
 const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion},evidenceSubdirectory="synthetic-sql/runtime-evidence";
 const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
 const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});assert.equal(admission.status,"ACCEPTED");
 const commit=buildAtomicRuntimeCommit({plan,result,pending,identity,batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});await verifyAtomicRuntimeCommitForPersistence(commit);
 const metadata={classification:"SYNTHETIC_SQL_TEST_ONLY",networkAccess:false,databaseWrites:false,liveQualification:false,currentClockAcquisitionIsSynthetic:true,sourceId:plan.source.id,sourceConfigSha256:binding.sourceConfigSha256,originalObservation:"2026-10-01T10:10:30.512Z",retainedEvidenceSha256:evidenceSha256,bodyHashes,rows:22,artifacts:3,fetchCounts:result.fetchEvidence!.fetchCounts,losses:0,cityCounts,publicCityCounts,archiveVerifiedBeforeExport:true,archiveRemovedAfterExport:true};
 const output={classification:"SYNTHETIC_SQL_TEST_ONLY",generatedAt:new Date().toISOString(),sources:[{...metadata,commit}]};await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(output,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({...metadata,exportPath:outputPath},null,2));
}finally{globalThis.fetch=originalFetch;await rm(workspaceRoot,{recursive:true,force:true});}
