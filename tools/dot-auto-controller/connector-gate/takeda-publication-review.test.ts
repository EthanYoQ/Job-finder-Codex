import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {prepareTakedaConnectorPublicationReview,consumeReviewedTakedaPublication} from './takeda-publication-review.mts';
import {parseJobProjectionDeltaReceipt} from '../vendor/c60-source/src/domain/jobProjectionDeltaReceipt.ts';
import {fixture,request,rehash,priorFrom,initialize,configureSyntheticFixtureRuntime,dirs,NOW} from './synthetic-fixture.mts';
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function prepared(){const f=await fixture(),gate=await prepareTakedaConnectorPublicationReview(f.input);return {...f,gate,r:request(gate.packet)};}
it('replays complete original compiler and both physical archives, consumes once without dispatch',async()=>{
 const {gate,r,httpCalls,input}=await prepared();const before=httpCalls();
 for(const gateName of ['PILOT_CONTEXT_CHANGED','PILOT_MIGRATION_HISTORY','PILOT_INCREMENTAL_FUNCTION_DEFINITION_DRIFT','PILOT_CANDIDATE_DRIFT','CRAWL_LEASE_BUSY'])expect(gate.packet.sql).toContain(gateName);
 const token=await gate.review(r),out=await consumeReviewedTakedaPublication(token,r);
 expect(out.mode).toBe('OFFLINE_REVIEW_ONLY');expect(out.buildContentSha256).toBe(input.scope.build.contentSha256);expect(Object.isFrozen(out)).toBe(true);expect(out.request).toEqual(r);expect(httpCalls()).toBe(before);
 expect(Object.isFrozen(token)).toBe(true);expect(Object.isFrozen(out.request.payload)).toBe(true);
 await expect(consumeReviewedTakedaPublication(token,r)).rejects.toThrow('REVIEW_SAME_PROCESS_CAPABILITY_REQUIRED');
});
it.each(['sql-tail','sql-literal','project','expiry','dispatchBefore','extra-key','request-hash'])('rejects rehashed external request tampering: %s',async kind=>{
 const {gate,r}=await prepared();const bad=structuredClone(r) as any;
 if(kind==='sql-tail')bad.payload.sql+='\nSELECT 1;';if(kind==='sql-literal')bad.payload.sql=bad.payload.sql.replace('Role 10001','Corrupt 10001');
 if(kind==='project')bad.payload.projectId='different-project';if(kind==='expiry')bad.expiresAt=new Date(Date.parse(bad.expiresAt)+1).toISOString();
 if(kind==='dispatchBefore')bad.payload.dispatchBefore=new Date(Date.parse(bad.payload.dispatchBefore)+1).toISOString();if(kind==='extra-key')bad.payload.bypass=true;
 rehash(bad);if(kind==='request-hash')bad.requestSha256='0'.repeat(64);
 await expect(gate.review(bad)).rejects.toThrow();await expect(gate.review(r)).rejects.toThrow('REVIEW_ALREADY_ATTEMPTED');
});
it.each(['admission-json','source','config','owner','registration','runtime-root','runtime-build','old-context','pre-request-context','profile'])('rejects source/runtime/snapshot mixing: %s',async kind=>{
 const {input}=await fixture();
 if(kind==='admission-json')input.publication.source.sourceQualityAdmission=structuredClone(input.publication.source.sourceQualityAdmission);
 if(kind==='source')input.publication.source.plan.source.id='source-abbvie-china-social';if(kind==='config')input.publication.source.pending.sourceConfigHash='0'.repeat(64);
 if(kind==='owner')input.publication.source.identity.ownerId='different-owner';if(kind==='registration')input.scope.registration={...input.scope.registration,version:101};
 if(kind==='runtime-root')input.scope.producerRoot=resolve('vendor/reader-main');if(kind==='runtime-build')input.publication.control.build={...input.publication.control.build,runtimeTreeSha256:'0'.repeat(64)};
 if(kind==='old-context')input.publication.control.context.checkedAt=new Date(Date.now()-61001).toISOString();if(kind==='pre-request-context')input.publication.control.context.checkedAt=new Date(Date.now()-1001).toISOString();
 if(kind==='profile')delete input.publication.control.databaseIdentity;await expect(prepareTakedaConnectorPublicationReview(input)).rejects.toThrow();
});
it.each(['original','restored','bundle','artifact-tuple','payload','snapshot'])('rejects mutation after preparation: %s',async kind=>{
 const {input,gate,r}=await prepared();const artifact=input.publication.source.artifacts[0]!;
 if(kind==='original'||kind==='restored')await writeFile(join(kind==='original'?input.archive.originalRoot:input.archive.restoredRoot,artifact.path),'changed bytes');
 if(kind==='bundle')await writeFile(input.archive.bundlePath,'{}');if(kind==='artifact-tuple')(artifact as any).sourceResultId='different-result';
 if(kind==='payload')input.publication.source.result.jobs[0]!.officialTitle='mutated';if(kind==='snapshot')input.publication.control.context.jobs.push({dedupeKey:'extra'});
 await expect(gate.review(r)).rejects.toThrow();
});
it('rechecks archive at consumption, burns failed token, rejects JSON ownership',async()=>{
 const {input,gate,r}=await prepared(),token=await gate.review(r);
 await expect(consumeReviewedTakedaPublication(structuredClone(token),r)).rejects.toThrow('REVIEW_SAME_PROCESS_CAPABILITY_REQUIRED');
 await writeFile(join(input.archive.restoredRoot,input.publication.source.artifacts[0]!.path),'changed after review');
 await expect(consumeReviewedTakedaPublication(token,r)).rejects.toThrow();await expect(consumeReviewedTakedaPublication(token,r)).rejects.toThrow('REVIEW_SAME_PROCESS_CAPABILITY_REQUIRED');
});
it('cannot renew stale context or original expiry while waiting for consumption',async()=>{
 const {gate,r}=await prepared(),token=await gate.review(r);vi.setSystemTime(Date.parse(r.expiresAt));await expect(consumeReviewedTakedaPublication(token,r)).rejects.toThrow();
});
it('incomplete pagination cannot acquire original admission',async()=>{await expect(fixture({incomplete:true})).rejects.toThrow();});
it('new/missing/GRACE use original lifecycle and delta without historical counts',async()=>{
 const first=await fixture(),initial=await prepareTakedaConnectorPublicationReview(first.input),prior=await priorFrom(first,initial.packet);
 const next=await fixture({at:'2026-10-11T22:00:00.000Z',ids:['10001','10003'],prior,changedTitle:true}),gate=await prepareTakedaConnectorPublicationReview(next.input);
 const r=request(gate.packet),token=await gate.review(r);await consumeReviewedTakedaPublication(token,r);
 const receipt=parseJobProjectionDeltaReceipt(gate.packet.commit.sourceResult.completenessCertificate,String(gate.packet.commit.sourceResult.completenessCertificateSha256));
 expect(receipt.members.filter(m=>m.setKind==='CURRENT')).toHaveLength(2);expect(receipt.members.filter(m=>m.setKind==='GRACE')).toHaveLength(1);expect(receipt.members.filter(m=>m.setKind==='VISIBLE')).toHaveLength(3);
 const missing=receipt.members.find(m=>m.setKind==='GRACE')!;expect(missing.lastConfirmedObservedAt).toBe(NOW);expect(missing.lastPresentResultId).toBe(initial.packet.commit.sourceResult.id);expect(missing.missingCount).toBe(1);
 expect(gate.packet.commit.commands.some((c:any)=>c.type==='UPSERT_JOB'&&c.record.sourceJobId==='10003')).toBe(true);
});
it('uses real last accepted observation for the 12-hour cadence',async()=>{
 const first=await fixture(),initial=await prepareTakedaConnectorPublicationReview(first.input),prior=await priorFrom(first,initial.packet),next=await fixture({at:'2026-10-11T21:59:59.999Z',prior});
 await expect(prepareTakedaConnectorPublicationReview(next.input)).rejects.toThrow('REVIEW_SOURCE_NOT_DUE');
});
it('changing consumed request rejects even a valid new hash',async()=>{
 const {gate,r}=await prepared(),token=await gate.review(r),bad=structuredClone(r);bad.payload.sql+='\nSELECT 1;';rehash(bad);
 await expect(consumeReviewedTakedaPublication(token,bad)).rejects.toThrow('REVIEW_REQUEST_CHANGED');await expect(consumeReviewedTakedaPublication(token,r)).rejects.toThrow('REVIEW_SAME_PROCESS_CAPABILITY_REQUIRED');
});
it('await-time input mutation is rejected even when the old admission is still live',async()=>{
 const {input}=await fixture(),pending=prepareTakedaConnectorPublicationReview(input);
 input.publication.control.context.jobs.push({dedupeKey:'changed-during-await'});
 await expect(pending).rejects.toThrow();
});
it('matching fabricated runtime hashes in scope/control still fail actual local byte measurement',async()=>{
 const {input}=await fixture();const fake={...input.scope.build,runtimeTreeSha256:'0'.repeat(64)};
 const {createHash}=await import('node:crypto');fake.contentSha256=createHash('sha256').update(JSON.stringify({schemaVersion:fake.schemaVersion,commitSha:fake.commitSha,sourceTreeSha256:fake.sourceTreeSha256,runtimeTreeSha256:fake.runtimeTreeSha256})).digest('hex');
 input.scope.build=fake;input.publication.control.build=fake;input.scope.registration.runtimeTreeHash=fake.runtimeTreeSha256;
 await expect(prepareTakedaConnectorPublicationReview(input)).rejects.toThrow('REVIEW_RUNTIME_BYTES_CHANGED');
});
it('a second verified absence ends GRACE through the original reducer',async()=>{
 const first=await fixture(),a=await prepareTakedaConnectorPublicationReview(first.input),prior=await priorFrom(first,a.packet);
 const second=await fixture({at:'2026-10-11T22:00:00.000Z',ids:['10001'],prior}),b=await prepareTakedaConnectorPublicationReview(second.input),prior2=await priorFrom(second,b.packet);
 const third=await fixture({at:'2026-10-12T10:00:00.000Z',ids:['10001'],prior:prior2}),c=await prepareTakedaConnectorPublicationReview(third.input),r=request(c.packet);
 await consumeReviewedTakedaPublication(await c.review(r),r);
 const receipt=parseJobProjectionDeltaReceipt(c.packet.commit.sourceResult.completenessCertificate,String(c.packet.commit.sourceResult.completenessCertificateSha256));
 expect(receipt.members.filter(m=>m.setKind==='GRACE')).toHaveLength(0);expect(receipt.members.filter(m=>m.setKind==='CURRENT')).toHaveLength(1);
 expect(c.packet.commit.commands.find((x:any)=>x.type==='UPSERT_JOB'&&x.record.sourceJobId==='10002')).toMatchObject({lifecycleStatus:'SUSPECTED_OFFLINE',missingSuccessfulCrawlCount:2,visibleInFrontend:false});
});
it('actual gate token composes with test observer; copied token invokes no synthetic tool',async()=>{
 const {createDispatchObserver}=await import('./dispatch-observer.mjs');const {gate,r}=await prepared();
 const token=await gate.review(r);let publications=0;
 const port={kind:'TEST_ONLY_SYNTHETIC_PORT',markIntent:async()=>({marked:true,exclusive:true,requestId:r.requestId,requestSha256:r.requestSha256}),publish:()=>{publications++;return Promise.resolve({isError:false,structuredContent:{result:'\n<untrusted-data-test-only>\n[]\n</untrusted-data-test-only>'}});},writeResponseOnce:async({result}:any)=>({written:true,exclusive:true,requestId:r.requestId,requestSha256:r.requestSha256,result})};
 const forged=(createDispatchObserver as any)({request:r,authorization:structuredClone(token),consumeAuthorization:consumeReviewedTakedaPublication,mode:'TEST_ONLY',testOnlyPort:port});
 expect((await forged.dispatch()).status).toBe('UNKNOWN');expect(publications).toBe(0);
 const actual=(createDispatchObserver as any)({request:r,authorization:token,consumeAuthorization:consumeReviewedTakedaPublication,mode:'TEST_ONLY',testOnlyPort:port});
 await actual.dispatch();await actual.settlementPromise;expect(publications).toBe(1);expect(actual.snapshot().newBatchAllowed).toBe(false);expect(actual.snapshot().testOnlyCompletionVerified).toBe(false);
 await expect(actual.dispatch()).rejects.toThrow('DISPATCH_ALREADY_CLAIMED');
});
it('review waiting preserves the original fresh-at-receipt context and exact DB CAS',async()=>{
 const {gate,r,input}=await prepared(),checked=input.publication.control.context.checkedAt;
 vi.setSystemTime(Date.now()+61001);
 const token=await gate.review(r);await consumeReviewedTakedaPublication(token,r);
 expect(input.publication.control.context.checkedAt).toBe(checked);expect(gate.packet.sql).toContain("(current_context-'checkedAt') IS DISTINCT FROM (expected_context_data-'checkedAt')");
});

it('explicit historical49 route still runs full original compiler and archive review',async()=>{
 const f=await fixture({databaseProfile:'SQL49'}),gate=await prepareTakedaConnectorPublicationReview(f.input),r=request(gate.packet);
 const token=await gate.review(r);expect((await consumeReviewedTakedaPublication(token,r)).mode).toBe('OFFLINE_REVIEW_ONLY');
 expect(gate.packet.sql).not.toContain('PILOT_V75_FENCE_FUNCTION_DRIFT');
});
it('explicit schema50 route includes the complete fence in original compiled SQL',async()=>{
 const {gate,r}=await prepared();
 for(const code of ['PILOT_V75_FENCE_FUNCTION_DRIFT','PILOT_V75_FENCE_TRIGGER_DRIFT','PILOT_MIGRATION_HISTORY'])expect(gate.packet.sql).toContain(code);
 const token=await gate.review(r);expect((await consumeReviewedTakedaPublication(token,r)).mode).toBe('OFFLINE_REVIEW_ONLY');
});
it.each(['SQL49','SCHEMA50'] as const)('full gate rejects opposite database profile on %s route',async profile=>{
 const f=await fixture({databaseProfile:profile==='SQL49'?'SCHEMA50':'SQL49'});f.input.scope.databaseProfile=profile;
 await expect(prepareTakedaConnectorPublicationReview(f.input)).rejects.toThrow(profile==='SQL49'?'REVIEW_EXISTING_49_PROFILE_REQUIRED':'REVIEW_EXACT_50_PROFILE_REQUIRED');
});
it('profile mutation after preparation invalidates the original review',async()=>{
 const {input,gate,r}=await prepared();input.scope.databaseProfile='SQL49';await expect(gate.review(r)).rejects.toThrow('REVIEW_INPUT_CHANGED');
});
