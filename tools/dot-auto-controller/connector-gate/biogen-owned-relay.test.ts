/** Original Biogen compiler + owned FilePilotRelay, synthetic disk replies only. */
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {FilePilotRelay,PILOT_BUDGET} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {fixture,initialize,configureSyntheticFixtureRuntime,dirs} from './biogen-synthetic-fixture.mts';
import {validateGateMessage,validateOutcomeMessage} from './biogen-pipe-protocol.mjs';
import {Prisma} from '../vendor/c60-source/node_modules/@prisma/client/index.js';
import {runDbStartedCloudPublication} from '../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts';
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
const selection={mode:'BIOGEN_OWNED_PIPE_CANDIDATE_V1' as const,launchChallenge:'a'.repeat(64)};
async function setup(){const f=await fixture(),dir=await mkdtemp(join(tmpdir(),'biogen-owned-relay-'));dirs.push(dir);return {...f,dir,relay:new FilePilotRelay(dir)};}
async function reply(dir:string,kind:string,rows:unknown[]){
 for(let n=0;n<200;n++){
  for(const name of await readdir(dir)){if(!name.endsWith('.request.json'))continue;const request=JSON.parse(await readFile(join(dir,name),'utf8'));if(request.kind!==kind)continue;
   await writeFile(join(dir,name.replace('.request.json','.response.json')),JSON.stringify({schemaVersion:1,requestId:request.requestId,requestSha256:request.requestSha256,kind,result:{status:'SUCCEEDED',rows}}),{flag:'wx'});return request;
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
 const handle=await relay.prepareOwnedBiogenPublish(input,selection);
 expect(Object.isFrozen(handle.packet)).toBe(true);
 await expect(relay.publishOwnedBiogen(structuredClone(handle))).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');
 await expect(new FilePilotRelay(dir).publishOwnedBiogen(handle)).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');
 const pending=relay.publishOwnedBiogen(handle);await expect(relay.publishOwnedBiogen(handle)).rejects.toThrow('RELAY_SAME_PROCESS_REVIEW_REQUIRED');
 const request=await reply(dir,'PUBLISH',[]);await pending;
 const review=messages.find(x=>x.type==='PRODUCER_REVIEW_CONSUMED_V1');expect(review.binding.sourceId).toBe('source-biogen-china-social');expect(review.binding.requestSha256).toBe(request.requestSha256);
 validateGateMessage(review,{projectId:review.binding.projectId,candidateId:review.binding.candidateId,sourceId:review.binding.sourceId,batchId:review.binding.batchId,buildSha256:review.binding.buildSha256,launchChallenge:selection.launchChallenge,outerDeadline:input.outerDeadline},Date.now());
 const source=handle.packet.commit.sourceResult,deadline=Math.min(input.outerDeadline-PILOT_BUDGET.controlMs,Date.now()+PILOT_BUDGET.controlMs);
 const outcome=relay.readAndVerifyOwnedBiogenOutcome(handle,deadline);
 const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
 const physical=Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,(source as any)[f.name]??null]));
 const read=await reply(dir,'READ_OUTCOME',[{row:JSON.parse(JSON.stringify(physical)),batch:{id:source.batchId,releaseCandidateId:source.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:''}]);
 expect((await outcome).state).toBe('COMMITTED_EXACT');expect(messages).toHaveLength(2);
 const verified=messages[1];validateOutcomeMessage(verified,review.binding);expect(verified.readRequestSha256).toBe(read.requestSha256);
 await expect(relay.readAndVerifyOwnedBiogenOutcome(handle,deadline)).rejects.toThrow('RELAY_OWNED_OUTCOME_REQUIRED');
});
it('rejects caller proof fields and cross-source selection before any relay write',async()=>{
 const {input,dir,relay}=await setup();
 for(const selection of [{mode:'BIOGEN_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64),approved:true},{mode:'TAKEDA_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)}])await expect(relay.prepareOwnedBiogenPublish(input,selection as any)).rejects.toThrow();
 expect(await readdir(dir)).toEqual([]);
 await expect(relay.readAndVerifyOwnedBiogenOutcome({packet:{}} as any,Date.now()+60000)).rejects.toThrow('RELAY_OWNED_OUTCOME_REQUIRED');
});
it('db-started runner rejects dual owned modes before touching disk or relay',async()=>{
 await expect(runDbStartedCloudPublication({ownedBiogenPipe:{},ownedTakedaPipe:{}} as any)).rejects.toThrow('PILOT_OWNED_PIPE_SELECTION_CONFLICT');
});
