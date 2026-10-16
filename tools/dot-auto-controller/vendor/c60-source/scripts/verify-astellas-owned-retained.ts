/** Offline only: substitutes retained HTTP bytes at the global transport boundary,
 * never qualifies these historical PDFs as a fresh real-world acquisition. */
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { searchPortableSnapshot } from "../src/server/portablePublicationApi";
import type { PortablePublicSnapshot } from "../src/db/portablePublicSnapshotRepository";
import { candidateCompanies } from '../src/data/companyRegistry';
import { buildStagedSourceCrawlPlans, sourcePlanConfigSha256 } from '../src/crawler/sourcePlan';
import { runSourceCrawl, replayStrictSourceQualityEvidenceAsync } from '../src/crawler/runSourceCrawl';
import { createOwnedSourceQualityFetch, issueSourceQualityAdmission } from '../src/crawler/sourceQualityAdmission';
import { archiveSourceEvidence } from '../src/crawler/artifactArchive';
import { bindRuntimeEvidenceArtifactIds, buildAtomicRuntimeCommit, buildPendingRuntimeBatch, verifyAtomicRuntimeCommitForPersistence } from '../src/crawler/runtimeAtomicEvidence';
import { buildJobDedupeKey } from '../src/crawler/normalizedJob';
const [auditDir,listDir]=process.argv.slice(2);
if(!auditDir||!listDir)throw Error('Usage: node --import tsx scripts/verify-astellas-owned-retained.ts <audit-directory> <retained-list-directory>');
const manifest=JSON.parse(await readFile(new URL('../tests/fixtures/astellas-pdf-locations/retained-manifest.json',import.meta.url),'utf8'));
const list=JSON.parse(await readFile(join(listDir,'evidence.private.json'),'utf8'));
const original=JSON.parse(await readFile(join(listDir,'candidates.private.json'),'utf8')).records;
assert.equal(manifest.jobs.length,15);assert.equal(original.length,15);assert.equal(list.artifacts.length,1);
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id===manifest.sourceId)!;
const bytes=new Map<string,Uint8Array>();
for(const job of manifest.jobs){const body=await readFile(join(auditDir,job.pdfPath));assert.equal(body.byteLength,job.pdfBytes);assert.equal(createHash('sha256').update(body).digest('hex'),job.pdfSha256);bytes.set(job.officialUrl,body);}
const calls:string[]=[];
globalThis.fetch=async(input)=>{const url=String(input);calls.push(url);const body=url===plan.source.officialEntryUrl?list.artifacts[0].body:bytes.get(url);assert.ok(body,'Unexpected request; no network fallback');const response=new Response(body,{status:200,headers:{'content-type':typeof body==='string'?'text/html':'application/pdf'}});Object.defineProperty(response,'url',{value:url});return response;};
const started=new Date();
const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
assert.equal(result.status,'SUCCESS');assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,15);
assert.deepEqual(calls,[plan.source.officialEntryUrl,...original.map((j:any)=>j.officialUrl)]);
assert.deepEqual(result.jobs.map(j=>[buildJobDedupeKey(j),j.officialTitle,j.officialUrl]),original.map((j:any)=>[buildJobDedupeKey(j),j.officialTitle,j.officialUrl]));
const counts:Record<string,number>={};
for(const j of result.jobs){const fact=manifest.jobs.find((f:any)=>f.officialUrl===j.officialUrl);assert.deepEqual(j.cities,fact.expectedCities);assert.equal(j.officialPublishedAt,undefined);for(const city of j.cities)counts[city]=(counts[city]??0)+1;}
assert.deepEqual(counts,{'北京':13,'上海':11,'沈阳':1});
const publicSnapshot={lastUpdatedAt:null,coverage:{requiredCompanyCount:1,excludedCompanyCount:0},companies:[{id:plan.company.id,companyName:plan.company.officialChineseName,pinyin:'astellas',required:true,publishingSourceIds:[plan.source.id],health:'HEALTHY',jobs:result.jobs.map(j=>({...j,id:j.sourceJobId!,title:j.officialTitle,city:j.cities[0]!,isNew:false,officialPublishedAt:null}))}]} as unknown as PortablePublicSnapshot;
const publicCityCounts=Object.fromEntries(['北京','上海','广州'].map(city=>[city,searchPortableSnapshot({city},publicSnapshot).totalJobs]));
assert.deepEqual(publicCityCounts,{'北京':13,'上海':11,'广州':0});
assert.equal(await replayStrictSourceQualityEvidenceAsync({plan,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,capturedAt:result.observation.crawledAt.toISOString()}),true);
const workspaceRoot=await mkdtemp(join(tmpdir(),'astellas-owned-retained-'));
try{
 const identity={releaseCandidateId:'astellas-offline-test',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED' as const,ownerId:'offline-test',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:'a'.repeat(64),expectedPlannedSourceCount:1};
 const pending=buildPendingRuntimeBatch('offline-batch',[plan],identity,started).sources[0]!;
 const binding={releaseCandidateId:identity.releaseCandidateId,batchId:'offline-batch',sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion};
 const evidenceSubdirectory='quality/runtime-evidence';
 const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
 assert.equal(archive.artifacts.length,16);
 const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});assert.equal(admission.status,'ACCEPTED');
 const commit=buildAtomicRuntimeCommit({plan,result,pending,identity,batchId:binding.batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archive.artifacts,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
 await verifyAtomicRuntimeCommitForPersistence(commit);
 console.log(JSON.stringify({classification:'OFFLINE_RETAINED_OWNED_ROUTE_TEST_NOT_LIVE_QUALIFICATION',networkAccess:false,databaseWrites:false,sourceConfigSha256:binding.sourceConfigSha256,rows:15,artifacts:archive.artifacts.length,identitiesAndTitlesPreserved:true,unknownDatesPreserved:true,cityCounts:counts,publicCityCounts,admission:admission.status,commitArchivedReplay:true,nodeMaxRssKiB:process.resourceUsage().maxRSS,parserVersions:[...new Set(result.fetchEvidence!.astellasPdfLocations!.entries.flatMap(e=>e.outcome.ok?[(e.outcome.evidence as any).parserVersion]:[]))]},null,2));
}finally{await rm(workspaceRoot,{recursive:true,force:true});}
