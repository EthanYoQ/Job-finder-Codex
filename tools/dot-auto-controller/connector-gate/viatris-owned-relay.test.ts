/** Original Viatris compiler + owned FilePilotRelay, synthetic disk replies only. */
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FilePilotRelay,PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {fixture,initialize,configureSyntheticFixtureRuntime,dirs} from './viatris-synthetic-fixture.mts';
import {validateGateMessage,validateOutcomeMessage} from './viatris-pipe-protocol.mjs';
import {Prisma} from '@prisma/client';
import {runDbStartedCloudPublication} from '../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts';
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();dirs.splice(0); /* Preserve this run's synthetic evidence; never delete historical cases. */});
const selection={mode:'VIATRIS_OWNED_PIPE_CANDIDATE_V1' as const,launchChallenge:'a'.repeat(64)};
async function setup(){const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'viatris-owned-relay-'));dirs.push(dir);return {...f,dir,relay:new FilePilotRelay(dir)};}
async function reply(dir:string,kind:string,rows:unknown[],failure?:{status:'FAILED';code:string;outcome:'ROLLED_BACK'|'NOT_DISPATCHED'|'UNKNOWN'}){
 for(let n=0;n<200;n++){
  for(const name of await readdir(dir)){if(!name.endsWith('.request.json')||!(await readdir(dir)).includes(name.replace(/\.json$/,'.ready')))continue;const request=JSON.parse(await readFile(join(dir,name),'utf8'));if(request.kind!==kind)continue;
   await writeFile(join(dir,name.replace('.request.json','.response.json')),JSON.stringify({schemaVersion:1,requestId:request.requestId,requestSha256:request.requestSha256,kind,result:failure??{status:'SUCCEEDED',rows}}),{flag:'wx'});return request;
  }
  await new Promise(r=>setTimeout(r,10));
 }
 throw Error('SYNTHETIC_RELAY_REQUEST_TIMEOUT');
}
function captureIpc(){const messages:any[]=[],original=process.send;vi.spyOn(process as any,'send').mockImplementation(((message:any,...args:any[])=>{
 if(message?.type==='PRODUCER_REVIEW_CONSUMED_V1'||message?.type==='PRODUCER_OUTCOME_VERIFIED_V1'){messages.push(message);const callback=args.find(x=>typeof x==='function');callback?.(null);return true;}
 return (original as any).call(process,message,...args);
}) as any);return messages;}
it('original relay owns prepare, consume, publish and exact outcome, with one IPC event each',async()=>{
 const {input,dir,relay}=await setup(),messages=captureIpc();
 const handle=await relay.prepareOwnedViatrisPublish(input,selection);
 expect(Object.isFrozen(handle.packet)).toBe(true);
 await expect(relay.publishOwnedViatris(structuredClone(handle))).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');
 await expect(new FilePilotRelay(dir).publishOwnedViatris(handle)).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');
 const pending=relay.publishOwnedViatris(handle);await expect(relay.publishOwnedViatris(handle)).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');
 const request=await reply(dir,'PUBLISH',[]);await pending;
 const review=messages.find(x=>x.type==='PRODUCER_REVIEW_CONSUMED_V1');expect(review.binding.sourceId).toBe('source-viatris-social');expect(review.binding.requestSha256).toBe(request.requestSha256);
 validateGateMessage(review,{projectId:review.binding.projectId,candidateId:review.binding.candidateId,sourceId:review.binding.sourceId,batchId:review.binding.batchId,buildSha256:review.binding.buildSha256,launchChallenge:selection.launchChallenge,outerDeadline:input.outerDeadline},Date.now());
 const source=handle.packet.commit.sourceResult,deadline=Math.min(input.outerDeadline-PILOT_BUDGET.controlMs,Date.now()+PILOT_BUDGET.controlMs);
 const outcome=relay.readAndVerifyOwnedViatrisOutcome(handle,deadline);
 const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
 const physical=Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,(source as any)[f.name]??null]));
 const read=await reply(dir,'READ_OUTCOME',[{row:JSON.parse(JSON.stringify(physical)),batch:{id:source.batchId,releaseCandidateId:source.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:''}]);
 expect((await outcome).state).toBe('COMMITTED_EXACT');expect(messages).toHaveLength(2);
 const verified=messages[1];validateOutcomeMessage(verified,review.binding);expect(verified.readRequestSha256).toBe(read.requestSha256);
 await expect(relay.readAndVerifyOwnedViatrisOutcome(handle,deadline)).rejects.toThrow('RELAY_OWNED_OUTCOME_REQUIRED');
});
it('rejects caller proof fields and cross-source selection before any relay write',async()=>{
 const {input,dir,relay}=await setup();
 for(const selection of [{mode:'VIATRIS_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64),approved:true},{mode:'TAKEDA_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)}])await expect(relay.prepareOwnedViatrisPublish(input,selection as any)).rejects.toThrow();
 expect(await readdir(dir)).toEqual([]);
 await expect(relay.readAndVerifyOwnedViatrisOutcome({packet:{}} as any,Date.now()+60000)).rejects.toThrow('RELAY_OWNED_OUTCOME_REQUIRED');
});
it('db-started runner rejects dual owned modes before touching disk or relay',async()=>{
 await expect(runDbStartedCloudPublication({ownedViatrisPipe:{},ownedTakedaPipe:{}} as any)).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');
});

it.each(['ownedTakedaPipe','ownedBiogenPipe','ownedHengruiPipe','ownedUcbPipe'])('rejects Viatris plus %s before touching disk or relay',async other=>{await expect(runDbStartedCloudPublication({ownedViatrisPipe:{},[other]:{}} as any)).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');});

it('cancellation before request publication burns its handle and never retries',async()=>{
 const {input,dir,relay}=await setup();captureIpc();const handle=await relay.prepareOwnedViatrisPublish(input,selection),abort=new AbortController();abort.abort(new Error('SYNTHETIC_CANCELLED'));
 await expect(relay.publishOwnedViatris(handle,abort.signal)).rejects.toThrow('SYNTHETIC_CANCELLED');await expect(relay.publishOwnedViatris(handle)).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');expect(await readdir(dir)).toEqual([]);
});
it.each(['ROLLED_BACK','NOT_DISPATCHED','UNKNOWN'] as const)('original %s failure permits exactly one read-only reconciliation, never a second publish',async outcome=>{
 const {input,dir,relay}=await setup(),messages=captureIpc(),handle=await relay.prepareOwnedViatrisPublish(input,selection);
 const publishing=relay.publishOwnedViatris(handle),rejected=expect(publishing).rejects.toThrow('RELAY_SQL_FAILED');await reply(dir,'PUBLISH',[],{status:'FAILED',code:'40001',outcome});await rejected;
 await expect(relay.publishOwnedViatris(handle)).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');
 const reading=relay.readAndVerifyOwnedViatrisOutcome(handle,Math.min(input.outerDeadline-PILOT_BUDGET.controlMs,Date.now()+PILOT_BUDGET.controlMs));
 await reply(dir,'READ_OUTCOME',[{row:null,batch:null,holderId:null}]);expect(await reading).toEqual({state:'CONFLICT'});
 await expect(relay.readAndVerifyOwnedViatrisOutcome(handle,Date.now()+PILOT_BUDGET.controlMs)).rejects.toThrow('RELAY_OWNED_OUTCOME_REQUIRED');
 const requests=await Promise.all((await readdir(dir)).filter(n=>n.endsWith('.request.json')).map(async n=>JSON.parse(await readFile(join(dir,n),'utf8'))));expect(requests.map(r=>r.kind).sort()).toEqual(['PUBLISH','READ_OUTCOME']);expect(messages.filter(m=>m.type==='PRODUCER_OUTCOME_VERIFIED_V1')).toEqual([]);
});
