/** Pure synthetic receipt/projection compatibility with both existing web roots.
 * No DB/client, real archive, registration, web edit, or official network. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {captureSyntheticKelunQuality,syntheticKelunRow,syntheticKelunPage} from '../producer/tests/helpers/kelunQualityFixture.ts';
import {buildPendingRuntimeBatch,buildAtomicRuntimeCommit} from '../producer/src/crawler/runtimeAtomicEvidence.ts';
import {deriveCurrentStagedScheduleExpectation} from '../producer/src/crawler/stagedScheduleAuthority.ts';
import {hashCanonicalStringSet} from '../producer/src/crawler/runtimeBatchIdentity.ts';
import {issueSourceQualityAdmission} from '../producer/src/crawler/sourceQualityAdmission.ts';
import {acquirePortableCrawlLease} from '../producer/src/crawler/portableCrawlLease.ts';
import {executePortableAtomicSourceEvidenceCommit} from '../producer/src/db/ingestionRepository.ts';
import {buildJobProjectionDeltaReceipt} from '../producer/src/db/jobProjectionDeltaCompiler.ts';
import {accepted} from '../producer/tests/helpers/portablePublicSnapshotFixture.ts';
const n=resolve(import.meta.dirname,'..'),root=join(n,'compatibility/synthetic-only');mkdirSync(root,{recursive:true});
const approved=[['230783266','科伦博泰-区域市场经理（北区或南区）(J12400)'],['230690782','科伦嘉讯-省区经理(J11794)'],['230685318','科伦嘉讯-业务经理(J11762)']];
const body=syntheticKelunPage(approved.map(([id,title])=>syntheticKelunRow(id!,'全国').replace(`合成职位 ${id}`,title!)));
const input=await captureSyntheticKelunQuality(root,[body]);
const build=JSON.parse(readFileSync(join(n,'NEW_LOCAL_BUILD_IDENTITY.json'),'utf8')),e=deriveCurrentStagedScheduleExpectation(build);
const identity={releaseCandidateId:input.binding.releaseCandidateId,commitSha:build.commitSha,rosterSha256:e.rosterSha256,sourcePlanSha256:e.sourcePlanSha256,sourceConfigSha256:e.sourceConfigSha256,adapterBundleSha256:e.adapterBundleSha256,batchKind:'SCHEDULED' as const,ownerId:'synthetic-reader-compatibility',expectedPlannedSourceIds:[input.plan.source.id],expectedPlannedSourceSetSha256:hashCanonicalStringSet([input.plan.source.id]),expectedPlannedSourceCount:1};
const pending=buildPendingRuntimeBatch(input.binding.batchId,[input.plan],identity,input.startedAt).sources[0]!;input.binding.adapterVersion=pending.adapterVersion;
const admission=await issueSourceQualityAdmission(input);assert.equal(admission.status,'ACCEPTED');
const commit=buildAtomicRuntimeCommit({plan:input.plan,pending,identity,batchId:input.binding.batchId,result:input.result,previousJobs:[],baselineCompletedBeforeCrawl:true,artifacts:input.archive.artifacts,sourceAdmissionPolicy:'PLAN_BOUND_SOURCE_QUALITY_V1',sourceQualityAdmission:admission,firstAcceptedCurrentPolicyReceipt:null});
// In-memory sink exercises the real validated persistence mapper, not a hand-copy.
let holder='';const inserts:Record<string,any[]>= {},writes:any[]=[];
const lease=await acquirePortableCrawlLease({$transaction:async work=>work({$queryRawUnsafe:async <T>(_sql:string,...values:unknown[])=>{holder=String(values[1]);return [{holderId:holder}] as T;}})});
const tx=new Proxy({$queryRawUnsafe:async(sql:string)=>sql.startsWith('SELECT')?[{id:'formal-crawl'}]:[{holderId:holder}],job:{upsert:async(args:any)=>{writes.push(args);}},crawlBatchSourceResult:{updateMany:async()=>({count:1})}}, {get(target:any,key:string){if(key in target)return target[key];return {create:async({data}:any)=>{(inserts[key]??=[]).push(data);}};}});
await executePortableAtomicSourceEvidenceCommit(commit,lease,{$transaction:async work=>work(tx as never)});
assert.equal(writes.length,3);
const mapped=new Map(writes.map(w=>[w.where.sourceId_dedupeKey.dedupeKey,{...w.create,...w.update}]));
const delta=buildJobProjectionDeltaReceipt({sourceResult:commit.sourceResult,commands:commit.commands,previousAccepted:null,projectionForCommand:c=>mapped.get(c.dedupeKey)!});
const at=commit.sourceResult.finishedAt!.toISOString(),defaults=accepted(at,approved.map(([id])=>id!),[],input.plan);
const row={...defaults.result,...commit.sourceResult,completenessCertificate:delta.receipt,completenessCertificateSha256:delta.sha256,observations:inserts.crawlObservation!,
 _count:{transportAttempts:inserts.transportAttemptEvidence?.length??0,evidenceArtifacts:inserts.evidenceArtifact?.length??0,observations:inserts.crawlObservation?.length??0,paginationEvidence:inserts.paginationEvidence?.length??0,lossLedgerEntries:inserts.lossLedgerEntry?.length??0,lifecycleSetMembers:inserts.lifecycleSetEvidenceMember?.length??0},batch:{id:input.binding.batchId,releaseCandidateId:input.binding.releaseCandidateId,kind:'SCHEDULED',status:'SUCCESS'}};
const jobs=[...mapped.values()].map((v,i)=>({id:`synthetic-reader-job-${i}`,...v,humanCorrectedTitle:null,humanCorrectedCategory:null}));
const members=inserts.lifecycleSetEvidenceMember!;assert.equal(members.length,6);
const paths=['src/domain/jobProjectionDeltaReceipt.ts','src/domain/portablePublicSnapshot.ts','src/domain/jobLocation.ts','src/crawler/sourceQualityAdmission.ts','src/db/portablePublicSnapshotRepository.ts'];
const sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
const roleBase='/workspace/scratch/5e9614251709/jb-refresh-diagnostics-release-20261007T0248Z/roles';const checks:any[]=[];
for(const role of ['web-main','compatible-fallback']){
 const web=join(roleBase,role),reader=await import(pathToFileURL(join(web,'src/domain/portablePublicSnapshot.ts')).href),location=await import(pathToFileURL(join(web,'src/domain/jobLocation.ts')).href);
 const opts={currentTime:new Date(Date.parse(at)+1000)},selection=reader.selectPortableSourceSnapshots([input.plan],[row],opts)[0];
 assert.equal(selection.state,'PUBLISHING',JSON.stringify(selection.reasons));
 const projection=reader.projectPortableSourceJobs(selection,members,jobs,opts);assert.equal(projection.state,'PUBLISHING',JSON.stringify(projection.reasons));assert.equal(projection.visibleJobCount,3);
 for(const j of projection.jobs){assert.equal(j.locationRaw,'全国');assert.equal(j.city,'全国');assert.deepEqual(j.cities,['全国']);assert.deepEqual(location.publicSearchCities(j),[]);assert.deepEqual(location.publicSearchProvinces(j),[]);assert.equal(location.isCityPendingJob(j),false);assert.equal(location.matchesPortableSearchCity(j,location.NATIONWIDE),true);assert.equal(location.matchesPortableSearchCity(j,'北京'),true);assert.equal(location.matchesPortableSearchCity(j,'北京','北京'),false);}
 for(const key of ['adapterVersion','releaseCandidateId']){const bad={...row,[key]:key==='adapterVersion'?'f'.repeat(64):'synthetic-wrong-candidate'};assert.equal(reader.selectPortableSourceSnapshots([input.plan],[bad],opts)[0].state,'HOLD');}
 const changedJobs=structuredClone(jobs);changedJobs[0]!.city='北京';changedJobs[0]!.cities=['北京'];assert.equal(reader.projectPortableSourceJobs(selection,members,changedJobs,opts).state,'HOLD');
 checks.push({role,actualReaderRoot:web,sourceState:projection.state,visibleJobs:3,locationRaw:'全国',city:'全国',cities:['全国'],fabricatedConcreteCities:[],nationwideFacet:true,cityFilterMatchesViaExistingNationwideRule:true,specificProvinceNotFabricated:true,wrongAdapterHeld:true,wrongCandidateHeld:true,mutatedCityProjectionHeld:true,modules:paths.map(p=>({path:p,sha256:sha(readFileSync(join(web,p)))}))});
}
assert.deepEqual(checks[0].modules,checks[1].modules);
const report={classification:'PURE_SYNTHETIC_NEW_PRODUCER_RECEIPT_THROUGH_ACTUAL_MAIN_AND_FALLBACK_READERS',sourceCommit:build.commitSha,adapterVersion:pending.adapterVersion,candidateId:input.binding.releaseCandidateId,receiptSchemas:['plan-bound-source-quality-v1','job-projection-delta-receipt-v1'],mainAndFallbackReaderModulesByteIdentical:true,noWebChanges:true,noDatabase:true,noOfficialNetwork:true,noPrivateFixturesRead:true,checks};
writeFileSync(join(n,'compatibility/WEB-READER-COMPATIBILITY.json'),JSON.stringify(report,null,2)+'\n');
writeFileSync(join(root,'SYNTHETIC-READER-INPUT.json'),JSON.stringify({classification:'PURE_SYNTHETIC_IDENTITY_RULE_FIXTURE',sourceResult:row,jobRows:jobs,members,deltaReceipt:delta},null,2)+'\n');
console.log(JSON.stringify(report,null,2));
