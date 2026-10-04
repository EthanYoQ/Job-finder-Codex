import { safeOfficialJsonEvidenceUrl } from "../src/crawler/officialJsonEvidence";
import { phenomOfficialPostedDate } from "../src/crawler/phenomOfficialPostedDate";
import { organonOfficialCities } from "../src/crawler/organonChinaQuality";
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
import { parsePersistentSourceFetchEvidence } from "../src/crawler/sourceFetchEvidence";
import { searchPortableSnapshot } from "../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../src/db/portablePublicSnapshotRepository";
import type { NormalizedJobRecord } from "../src/crawler/normalizedJob";

const [directory,outputPath]=process.argv.slice(2);
if(!directory||!outputPath)throw Error("Usage: node --import tsx scripts/verify-organon-owned-retained.ts <retained-Organon-folder> <synthetic-export.json>");
const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const evidenceSha256="c433b8d5edc3f3b759c7f401ed60f15600942bedcead66287a8efd5f01676641";
const bodyHashes=["d654281d51e87e4adacabc787932f234d0acea4ef3839f57debcd6cdc8d9948e","6ccca9033625a7218e97597c848650fd52cb7e7d5a9ecfae6044379302e2ba4d"];
const bytes=await readFile(join(directory,"evidence.private.json"));assert.equal(hash(bytes),evidenceSha256);
const evidence=parsePersistentSourceFetchEvidence(JSON.parse(bytes.toString("utf8")));assert.equal(evidence.artifacts.length,2);
evidence.artifacts.forEach((artifact,i)=>assert.equal(hash(artifact.body),bodyHashes[i]));
const original=JSON.parse(await readFile(join(directory,"candidates.private.json"),"utf8")).records as NormalizedJobRecord[];
const raw=evidence.artifacts.slice(1).flatMap(artifact=>JSON.parse(String(artifact.body)).refineSearch.data.jobs) as Array<Record<string,unknown>>;
assert.equal(raw.length,4);assert.equal(original.length,4);assert(original.every(job=>job.evidence.capturedAt==="2026-10-01T10:05:25.593Z"));
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-organon-china-social")!;
let cursor=0;const originalFetch=globalThis.fetch;
const workspaceRoot=await mkdtemp(join(tmpdir(),"organon-synthetic-sql-"));
try{
 globalThis.fetch=async(input,init)=>{
  const requested=String(input),artifact=evidence.artifacts[cursor];assert(artifact,"Unexpected request; no network fallback");
  assert.equal(init?.method??"GET",cursor===0?"GET":"POST");assert.equal(requested,cursor===0?plan.source.officialEntryUrl:"https://jobs.organon.com/widgets");
  if(cursor===1){const body=JSON.parse(String(init!.body));assert.deepEqual(body.selected_fields,{country:["China"]});assert.equal(body.from,0);assert.equal(body.size,50);assert.equal(body.refNum,"MECEUS");assert.equal(body.locale,"zh_cn");assert.equal(body.pageId,"page18-ds");}
  assert.equal(safeOfficialJsonEvidenceUrl(requested),artifact.requestedUrl);assert.equal(safeOfficialJsonEvidenceUrl(requested),artifact.finalUrl);
  const response=new Response(typeof artifact.body==="string"?artifact.body:Buffer.from(artifact.body),{status:artifact.httpStatus!,headers:{"content-type":artifact.contentType!}});Object.defineProperty(response,"url",{value:requested});cursor++;return response;
 };
 const started=new Date(),result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
 assert.equal(result.status,"SUCCESS",JSON.stringify({status:result.status,truth:result.truth,failureReason:result.observation.failureReason}));assert.equal(result.truth.completenessVerified,true);assert.equal(cursor,2);assert.equal(result.jobs.length,4);
 assert.deepEqual(result.fetchEvidence!.fetchCounts,{rawCount:4,parsedCount:4,validCount:4,parseDiscardCount:0,validationDiscardCount:0});assert.deepEqual(result.fetchEvidence!.fetchLosses,[]);
 result.fetchEvidence!.artifacts.forEach((artifact,i)=>assert.equal(hash(artifact.body),bodyHashes[i]));
 const previousFields=({cities:_cities,officialPublishedAt:_date,evidence:_evidence,...job}:NormalizedJobRecord)=>job;
 assert.deepEqual(result.jobs.map(previousFields),original.map(previousFields));
 assert.deepEqual(result.jobs.map(job=>job.locationRaw),raw.map(job=>job.location));
 assert.deepEqual(result.jobs.map(job=>job.officialPublishedAt),raw.map(job=>phenomOfficialPostedDate(job.postedDate)));
 const cityCounts:Record<string,number>={};for(const job of result.jobs){assert.equal(job.cities.length,1);const city=job.cities[0]!;cityCounts[city]=(cityCounts[city]??0)+1;assert.notEqual(city,"全国");}
 assert.deepEqual(cityCounts,{上海:3,城市待核:1});
 assert.deepEqual(result.jobs.map(job=>job.cities),raw.map(organonOfficialCities));
 assert.deepEqual(result.jobs.map(job=>job.officialPublishedAt),["2026-09-24T00:00:00.000Z","2026-09-24T00:00:00.000Z","2026-09-14T00:00:00.000Z","2026-09-07T00:00:00.000Z"]);
 assert.equal(result.fetchEvidence!.pages[0]!.requestedOffset,0);assert.equal(result.fetchEvidence!.pages[0]!.returnedOffset,null);
 const snapshot={lastUpdatedAt:null,coverage:{requiredCompanyCount:40,excludedCompanyCount:1},companies:[{id:plan.company.id,companyName:plan.company.officialChineseName,pinyin:"organon",required:true,publishingSourceIds:[plan.source.id],health:"HEALTHY",jobs:result.jobs.map(job=>({...job,id:job.sourceJobId!,city:job.cities[0]!,title:job.officialTitle,isNew:false}))}]} as unknown as PortablePublicSnapshot;
 const publicCityCounts=Object.fromEntries(["北京","上海","广州"].map(city=>[city,searchPortableSnapshot({city},snapshot).totalJobs]));assert.deepEqual(publicCityCounts,{北京:0,上海:3,广州:0});
 const identity={releaseCandidateId:"organon-synthetic-sql-test",commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"synthetic-sql-test-only",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
 const batchId="organon-synthetic-sql-batch",pending=buildPendingRuntimeBatch(batchId,[plan],identity,started).sources[0]!;
 const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion},evidenceSubdirectory="synthetic-sql/runtime-evidence";
 const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
 const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});assert.equal(admission.status,"ACCEPTED");
 const commit=buildAtomicRuntimeCommit({plan,result,pending,identity,batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});await verifyAtomicRuntimeCommitForPersistence(commit);
 const metadata={classification:"SYNTHETIC_SQL_TEST_ONLY",networkAccess:false,databaseWrites:false,liveQualification:false,productionRegistrationComplete:false,pendingCityConflictJobIds:["R542267"],currentClockAcquisitionIsSynthetic:true,sourceId:plan.source.id,sourceConfigSha256:binding.sourceConfigSha256,originalObservation:"2026-10-01T10:05:25.593Z",retainedEvidenceSha256:evidenceSha256,bodyHashes,rows:4,knownCityCount:3,pendingCityCount:1,artifacts:2,fetchCounts:result.fetchEvidence!.fetchCounts,losses:0,cityCounts,publicCityCounts,archiveVerifiedBeforeExport:true,archiveRemovedAfterExport:true};
 const output={classification:"SYNTHETIC_SQL_TEST_ONLY",generatedAt:new Date().toISOString(),sources:[{...metadata,commit}]};await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(output,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({...metadata,exportPath:outputPath},null,2));
}finally{globalThis.fetch=originalFetch;await rm(workspaceRoot,{recursive:true,force:true});}
