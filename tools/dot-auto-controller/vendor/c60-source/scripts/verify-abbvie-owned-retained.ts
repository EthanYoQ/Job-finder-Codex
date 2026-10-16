/** Offline only: substitutes retained HTTP bytes at the global transport boundary,
 * never qualifies these historical HTML pages as a fresh real-world acquisition. */
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
import { sanitizeEvidenceHttpUrl } from '../src/crawler/sourceFetchEvidence';
import { buildJobDedupeKey } from '../src/crawler/normalizedJob';
const [listDir]=process.argv.slice(2);
if(!listDir)throw Error('Usage: node --import tsx scripts/verify-abbvie-owned-retained.ts <retained-source-directory>');

const list=JSON.parse(await readFile(join(listDir,'evidence.private.json'),'utf8'));
const original=JSON.parse(await readFile(join(listDir,'candidates.private.json'),'utf8')).records;
assert.equal(original.length,55);assert.equal(list.artifacts.length,6);
const plan=buildStagedSourceCrawlPlans(candidateCompanies).find(p=>p.source.id==='source-abbvie-china-social')!;
const bytes=new Map(list.artifacts.map((a:any)=>[a.requestedUrl,a.body]));
const calls:string[]=[];
globalThis.fetch=async(input)=>{const url=String(input);calls.push(url);const body=bytes.get(sanitizeEvidenceHttpUrl(url)) as string|undefined;assert.ok(body,'Unexpected request; no network fallback');const response=new Response(body,{status:200,headers:{'content-type':typeof body==='string'?'text/html':'application/pdf'}});Object.defineProperty(response,'url',{value:url});return response;};
const started=new Date();
const result=await runSourceCrawl(plan,{fetch:createOwnedSourceQualityFetch(),isBaseline:true});
assert.equal(result.status,'SUCCESS');assert.equal(result.truth.completenessVerified,true);assert.equal(result.jobs.length,55);
assert.deepEqual(calls.map(sanitizeEvidenceHttpUrl),list.artifacts.map((a:any)=>a.requestedUrl));
assert.deepEqual(result.jobs.map(j=>[buildJobDedupeKey(j),j.officialTitle,j.officialUrl]),original.map((j:any)=>[buildJobDedupeKey(j),j.officialTitle,j.officialUrl]));
const counts:Record<string,number>={};
for(const j of result.jobs){assert.equal(j.cities.length,1);assert.match(j.cities[0]!,/^\p{Script=Han}+$/u);assert.equal(j.officialPublishedAt,undefined);counts[j.cities[0]!]=(counts[j.cities[0]!]??0)+1;}
const publicSnapshot={lastUpdatedAt:null,coverage:{requiredCompanyCount:1,excludedCompanyCount:0},companies:[{id:plan.company.id,companyName:plan.company.officialChineseName,pinyin:'abbvie',required:true,publishingSourceIds:[plan.source.id],health:'HEALTHY',jobs:result.jobs.map(j=>({...j,id:j.sourceJobId!,title:j.officialTitle,city:j.cities[0]!,isNew:false,officialPublishedAt:null}))}]} as unknown as PortablePublicSnapshot;
const publicCityCounts=Object.fromEntries(['北京','上海','广州'].map(city=>[city,searchPortableSnapshot({city},publicSnapshot).totalJobs]));
assert.deepEqual(publicCityCounts,{'北京':7,'上海':10,'广州':7});
assert.equal(await replayStrictSourceQualityEvidenceAsync({plan,evidence:result.fetchEvidence!,paginationEvaluation:result.paginationEvaluation!,reconciliation:result.reconciliation!,jobs:result.jobs,capturedAt:result.observation.crawledAt.toISOString()}),true);
const workspaceRoot=await mkdtemp(join(tmpdir(),'abbvie-owned-retained-'));
try{
 const identity={releaseCandidateId:'abbvie-offline-test',commitSha:'a'.repeat(40),rosterSha256:'a'.repeat(64),sourcePlanSha256:'a'.repeat(64),sourceConfigSha256:'a'.repeat(64),adapterBundleSha256:'a'.repeat(64),batchKind:'SCHEDULED' as const,ownerId:'offline-test',expectedPlannedSourceIds:[plan.source.id],expectedPlannedSourceSetSha256:'a'.repeat(64),expectedPlannedSourceCount:1};
 const pending=buildPendingRuntimeBatch('offline-batch',[plan],identity,started).sources[0]!;
 const binding={releaseCandidateId:identity.releaseCandidateId,batchId:'offline-batch',sourceResultId:pending.id,sourceConfigSha256:sourcePlanConfigSha256(plan),adapterVersion:pending.adapterVersion};
 const evidenceSubdirectory='quality/runtime-evidence';
 const archive=await archiveSourceEvidence({workspaceRoot,...binding,sourceId:plan.source.id,evidenceSubdirectory,captureTool:result.fetchEvidence!.captureTool,artifacts:bindRuntimeEvidenceArtifactIds({...binding,sourceId:plan.source.id,artifacts:result.fetchEvidence!.artifacts})});
 assert.equal(archive.artifacts.length,6);
 const admission=await issueSourceQualityAdmission({plan,result,binding,archive:{workspaceRoot,evidenceSubdirectory,artifacts:archive.artifacts}});assert.equal(admission.status,'ACCEPTED');
 const commit=buildAtomicRuntimeCommit({plan,result,pending,identity,batchId:binding.batchId,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:archive.artifacts,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
 await verifyAtomicRuntimeCommitForPersistence(commit);
 console.log(JSON.stringify({classification:'OFFLINE_RETAINED_OWNED_ROUTE_TEST_NOT_LIVE_QUALIFICATION',networkAccess:false,databaseWrites:false,sourceConfigSha256:binding.sourceConfigSha256,rows:55,artifacts:archive.artifacts.length,identitiesAndTitlesPreserved:true,unknownDatesPreserved:true,cityCounts:counts,publicCityCounts,admission:admission.status,commitArchivedReplay:true,nodeMaxRssKiB:process.resourceUsage().maxRSS},null,2));
}finally{await rm(workspaceRoot,{recursive:true,force:true});}
