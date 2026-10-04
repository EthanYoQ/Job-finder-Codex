import { safeOfficialJsonEvidenceUrl } from "../src/crawler/officialJsonEvidence";
import { merckOfficialPostedDate, merckOfficialCities } from "../src/crawler/merckChinaQuality";
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
if(!directory||!outputPath)throw Error("Usage: node --import tsx scripts/verify-merck-owned-retained.ts <retained-Merck-folder> <synthetic-export.json>");
const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const evidenceSha256="3925b901e9caaf2d5a37c81455b52efe500573aa1476c16e3e2ed2e21bc54923";
const bodyHashes=["2e43a0330841649e4b314cf05e5634f021a7c9144991017392d2ac48b63b44c7","0d4d95abedc37fbc0a8a5d52feb7a484fecd16b97de35c5fa25aba18899e676e","e7c2eca166859bc037d25862aa6cdb28048cb01643014dc86d00dcb13b73fac1"];
const bytes=await readFile(join(directory,"evidence.private.json"));assert.equal(hash(bytes),evidenceSha256);
const evidence=parsePersistentSourceFetchEvidence(JSON.parse(bytes.toString("utf8")));assert.equal(evidence.artifacts.length,3);
evidence.artifacts.forEach((artifact,i)=>assert.equal(hash(artifact.body),bodyHashes[i]));
const original=JSON.parse(await readFile(join(directory,"candidates.private.json"),"utf8")).records as NormalizedJobRecord[];
const raw=evidence.artifacts.slice(1).flatMap(artifact=>JSON.parse(String(artifact.body)).refineSearch.data.jobs) as Array<Record<string,unknown>>;
assert.equal(raw.length,55);assert.equal(original.length,55);assert(original.every(job=>job.evidence.capturedAt==="2026-10-01T10:11:27.917Z"));
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==="source-merck-china-social")!;
let cursor=0;const originalFetch=globalThis.fetch;
const workspaceRoot=await mkdtemp(join(tmpdir(),"merck-synthetic-sql-"));
try{
 globalThis.fetch=async(input,init)=>{
  const requested=String(input),artifact=evidence.artifacts[cursor];assert(artifact,"Unexpected request; no network fallback");
  assert.equal(init?.method??"GET",cursor===0?"GET":"POST");assert.equal(requested,cursor===0?plan.source.officialEntryUrl:"https://careers.emdgroup.com/widgets");
  assert.equal(safeOfficialJsonEvidenceUrl(requested),artifact.requestedUrl);assert.equal(safeOfficialJsonEvidenceUrl(requested),artifact.finalUrl);
  const response=new Response(typeof artifact.body==="string"?artifact.body:Buffer.from(artifact.body),{status:artifact.httpStatus!,headers:{"content-type":artifact.contentType!}});Object.defineProperty(response,"url",{value:requested});cursor++;return response;
 };
 const started=new Date(),result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
 assert.equal(result.status,"SUCCESS",JSON.stringify({status:result.status,truth:result.truth,failureReason:result.observation.failureReason}));assert.equal(result.truth.completenessVerified,true);assert.equal(cursor,3);assert.equal(result.jobs.length,55);
 assert.deepEqual(result.fetchEvidence!.fetchCounts,{rawCount:55,parsedCount:55,validCount:55,parseDiscardCount:0,validationDiscardCount:0});assert.deepEqual(result.fetchEvidence!.fetchLosses,[]);
 result.fetchEvidence!.artifacts.forEach((artifact,i)=>assert.equal(hash(artifact.body),bodyHashes[i]));
 const previousFields=({cities:_cities,officialPublishedAt:_date,evidence:_evidence,...job}:NormalizedJobRecord)=>job;
 assert.deepEqual(result.jobs.map(previousFields),original.map(previousFields));
 assert.deepEqual(result.jobs.map(job=>job.locationRaw),raw.map(job=>job.location));
 assert.deepEqual(result.jobs.map(job=>job.officialPublishedAt),raw.map(job=>merckOfficialPostedDate(job.postedDate)));
 const cityCounts:Record<string,number>={};for(const job of result.jobs){assert.equal(job.cities.length,1);const city=job.cities[0]!;cityCounts[city]=(cityCounts[city]??0)+1;assert.notEqual(city,"全国");}
 assert.deepEqual(cityCounts,{上海:30,北京:8,城市待核:7,广州:4,苏州:2,南通:2,深圳:2});
 assert.deepEqual(result.jobs.map(job=>job.cities),raw.map(merckOfficialCities));
 const snapshot={lastUpdatedAt:null,coverage:{requiredCompanyCount:40,excludedCompanyCount:1},companies:[{id:plan.company.id,companyName:plan.company.officialChineseName,pinyin:"merck",required:true,publishingSourceIds:[plan.source.id],health:"HEALTHY",jobs:result.jobs.map(job=>({...job,id:job.sourceJobId!,city:job.cities[0]!,title:job.officialTitle,isNew:false}))}]} as unknown as PortablePublicSnapshot;
 const publicCityCounts=Object.fromEntries(["北京","上海","广州"].map(city=>[city,searchPortableSnapshot({city},snapshot).totalJobs]));assert.deepEqual(publicCityCounts,{北京:8,上海:30,广州:4});
 const identity={releaseCandidateId:"merck-synthetic-sql-test",commitSha:"a".repeat(40),rosterSha256:"a".repeat(64),sourcePlanSha256:"a".repeat(64),sourceConfigSha256:"a".repeat(64),adapterBundleSha256:"a".repeat(64),batchKind:"SCHEDULED" as const,ownerId:"synthetic-sql-test-only",expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:"a".repeat(64),expectedPlannedSourceCount:1};
 const batchId="merck-synthetic-sql-batch",pending=buildPendingRuntimeBatch(batchId,[plan],identity,started).sources[0]!;
 const binding={releaseCandidateId:identity.releaseCandidateId,batchId,sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion},evidenceSubdirectory="synthetic-sql/runtime-evidence";
 const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
 const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});assert.equal(admission.status,"ACCEPTED");
 const commit=buildAtomicRuntimeCommit({plan,result,pending,identity,batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archive.artifacts,sourceAdmissionPolicy:"PLAN_BOUND_SOURCE_QUALITY_V1",sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});await verifyAtomicRuntimeCommitForPersistence(commit);
 const metadata={classification:"SYNTHETIC_SQL_TEST_ONLY",networkAccess:false,databaseWrites:false,liveQualification:false,productionRegistrationComplete:false,pendingTitleLocationJobIds:["304182","303804","292007","302599","300945","299316","299857"],currentClockAcquisitionIsSynthetic:true,sourceId:plan.source.id,sourceConfigSha256:binding.sourceConfigSha256,originalObservation:"2026-10-01T10:11:27.917Z",retainedEvidenceSha256:evidenceSha256,bodyHashes,rows:55,knownCityCount:48,pendingCityCount:7,artifacts:3,fetchCounts:result.fetchEvidence!.fetchCounts,losses:0,cityCounts,publicCityCounts,archiveVerifiedBeforeExport:true,archiveRemovedAfterExport:true};
 const output={classification:"SYNTHETIC_SQL_TEST_ONLY",generatedAt:new Date().toISOString(),sources:[{...metadata,commit}]};await mkdir(dirname(outputPath),{recursive:true});await writeFile(outputPath,JSON.stringify(output,null,2)+"\n",{flag:"wx"});console.log(JSON.stringify({...metadata,exportPath:outputPath},null,2));
}finally{globalThis.fetch=originalFetch;await rm(workspaceRoot,{recursive:true,force:true});}
