import {toPrismaJobCategory} from './candidate/src/db/prismaMappers.ts';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readPortablePublicSnapshot as oldRead} from '../inactive-reader-three-clones-20261018T0620Z/candidate/src/db/portablePublicSnapshotRepository.ts';
import {readPortablePublicSnapshot as newRead} from './candidate/src/db/portablePublicSnapshotRepository.ts';
import {accepted,job,plan,NOW,FIRST,SECOND} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/tests/helpers/portablePublicSnapshotFixture.ts';
import {hashProjectionJson,hashDeltaManifest,hashJobPersistedProjection,sortJobProjectionMembers,JOB_PROJECTION_DELTA_SCHEMA,JOB_PERSISTED_PROJECTION_SCHEMA} from './candidate/src/domain/jobProjectionDeltaReceipt.ts';
import {buildStagedSourceCrawlPlans,getPlanBySourceId} from './candidate/src/crawler/sourcePlan.ts';
import {candidateCompanies} from './candidate/src/data/companyRegistry.ts';
function fixture(grace=false,badHash=false){
 const previous=accepted(FIRST),current=accepted(SECOND,grace?[]:['job-1'],grace?['job-1']:[]);
 const j={...job('job-1',grace?FIRST:SECOND,grace?1:0),sourceJobId:'job-1',listUrl:'https://hspharm.zhiye.com/social'};
 const binding={releaseCandidateId:current.result.releaseCandidateId,batchId:current.result.batchId,sourceId:plan.source.id,sourceResultId:current.result.id};
 const members=sortJobProjectionMembers(current.members.map(m=>({...m,jobProjectionSha256:hashJobPersistedProjection(j),lastConfirmedObservedAt:grace?FIRST:SECOND,lifecycleLastSeenAt:grace?FIRST:SECOND,lastPresentResultId:grace?previous.result.id:current.result.id})));
 const receipt={schemaVersion:JOB_PROJECTION_DELTA_SCHEMA,projectionSchemaVersion:JOB_PERSISTED_PROJECTION_SCHEMA,binding,verifiedAt:SECOND,observedAt:SECOND,legacyCertificate:current.receipt,legacyCertificateSha256:current.result.completenessCertificateSha256,detailEvidenceState:'UNKNOWN',members,manifestSha256:hashDeltaManifest(members)};
 current.result.completenessCertificate=receipt;current.result.completenessCertificateSha256=badHash?'0'.repeat(64):hashProjectionJson(receipt);
 return {results:[previous.result,current.result],members:[...previous.members,...current.members],jobs:[j]};
}
async function run(read,input,p=plan,now=NOW){
 const data=structuredClone(input),before=structuredClone(data),queries=[];
 const tx={crawlBatchSourceResult:{findMany:async q=>{queries.push(['results',q]);return data.results;}},lifecycleSetEvidenceMember:{findMany:async q=>{queries.push(['members',q]);return data.members.filter(m=>q.where.sourceResultId.in.includes(m.sourceResultId));}},job:{findMany:async q=>{queries.push(['jobs',q]);return data.jobs.filter(j=>q.where.OR.some(w=>j.sourceId===w.sourceId&&j.companyId===w.companyId&&j.lifecycleStatus===w.lifecycleStatus&&j.visibleInFrontend===w.visibleInFrontend&&w.dedupeKey.in.includes(j.dedupeKey)&&(!w.lastSeenAt||(j.lastSeenAt>=w.lastSeenAt.gte&&j.lastSeenAt<=w.lastSeenAt.lte))));}},lossLedgerEntry:{findMany:async()=>data.closureRecords??[]},evidenceArtifact:{findMany:async()=>data.artifacts??[]}};
 const db={$transaction:async(fn,opts)=>{assert.deepEqual(opts,{isolationLevel:'RepeatableRead',maxWait:5000,timeout:10000});return fn(tx);}};
 const output=await read(db,{currentTime:now},[p]);assert.deepEqual(data,before);return{output,queries};
}
const checks=[];
for(const [name,grace,bad] of [['current',false,false],['grace',true,false],['bad-hash-grace',true,true]]){
 const input=fixture(grace,bad),old=await run(oldRead,input),fresh=await run(newRead,input);assert.deepEqual(fresh.output,old.output);
 const s=fresh.output.sources[0];assert.equal(s.state,bad?'HOLD':'PUBLISHING');assert.equal(fresh.output.totalJobs,bad?0:1);
 if(!bad)assert.deepEqual(fresh.queries,old.queries);
 const ids=fresh.queries.find(([n])=>n==='members')[1].where.sourceResultId.in;
 if(grace)assert(ids.includes(input.results[0].id));
 checks.push({name,state:s.state,totalJobs:fresh.output.totalJobs,queriedMemberResults:ids.length,outputEqual:true,inputUnchanged:true});
}
// The existing small original Novo snapshot includes its actual closure records.
const raw=JSON.parse(readFileSync('../takeda-original-recovery-20261017T0417Z/novo-nordisk/READER_BEFORE.json','utf8'));
const dateKeys=new Set(['startedAt','finishedAt','crawledAt','observedFrom','observedTo','recordedAt','capturedAt','lastSeenAt','firstSeenAt','officialPublishedAt']);
function revive(v,inReceipt=false){if(Array.isArray(v))return v.map(x=>revive(x,inReceipt));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,!inReceipt&&dateKeys.has(k)&&typeof x==='string'?new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(x)?x:x+'Z'):revive(x,inReceipt||k==='completenessCertificate'||k==='details')]));return v;}
const real=revive(raw),p=getPlanBySourceId(buildStagedSourceCrawlPlans(candidateCompanies),raw.sourceId),when=new Date(raw.checkedAt);
for(const j of real.jobs){j.category=toPrismaJobCategory(j.category);if(j.humanCorrectedCategory!==null)j.humanCorrectedCategory=toPrismaJobCategory(j.humanCorrectedCategory);}
const a=await run(oldRead,real,p,when),b=await run(newRead,real,p,when);assert.deepEqual(a,b);assert.equal(b.output.totalJobs,15);assert.equal(b.output.sources[0].state,'PUBLISHING');
checks.push({name:'original-novo-before',rows:real.results.length,jobs:real.jobs.length,closureRecords:real.closureRecords.length,totalJobs:b.output.totalJobs,state:b.output.sources[0].state,outputQueriesEqual:true,inputUnchanged:true});
console.log(JSON.stringify({pass:true,checks}));
