/** Original DB-started caller, compiler and file-relay seam. Every reply is synthetic. */
import {afterEach,beforeAll,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Prisma} from '@prisma/client';
import {FilePilotRelay} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {runDbStartedCloudPublication} from '../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts';
import {fixture,initialize,configureSyntheticFixtureRuntime,dirs} from './viatris-synthetic-fixture.mts';
beforeAll(()=>{initialize();configureSyntheticFixtureRuntime({setClock:at=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(at);},installFetch:fn=>vi.stubGlobal('fetch',fn)});});
afterEach(async()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();dirs.splice(0); /* Preserve this run's synthetic evidence; never delete historical cases. */});
async function respond(dir:string,kind:string,rows:()=>unknown[]){
 for(let i=0;i<500;i++){
  for(const name of await readdir(dir)){if(!name.endsWith('.request.json')||!(await readdir(dir)).includes(name.replace(/\.json$/,'.ready')))continue;const request=JSON.parse(await readFile(join(dir,name),'utf8'));if(request.kind!==kind)continue;
   await writeFile(join(dir,name.replace('.request.json','.response.json')),JSON.stringify({schemaVersion:1,requestId:request.requestId,requestSha256:request.requestSha256,kind,result:{status:'SUCCEEDED',rows:rows()}}),{flag:'wx'});return request;
  }
  await new Promise(r=>setTimeout(r,10));
 }
 throw Error('SYNTHETIC_REQUEST_TIMEOUT:'+kind);
}
it('actual DB-started caller chooses Viatris owned branch, preserves fresh context and emits exact committed readback',async()=>{
 const {input}=await fixture(),dir=await mkdtemp(join(tmpdir(),'viatris-db-started-'));dirs.push(dir);
 const relay=new FilePilotRelay(dir),controlPath=join(dir,'control.json'),{context,planned,...control}=input.publication.control;
 await writeFile(controlPath,JSON.stringify(control));
 let packet:any,prepareCalls=0;const originalPrepare=relay.prepareOwnedViatrisPublish.bind(relay);
 vi.spyOn(relay,'prepareOwnedViatrisPublish').mockImplementation(async(...args)=>{prepareCalls++;const result=await originalPrepare(...args);packet=result.packet;return result;});
 vi.spyOn(relay,'prepareOwnedTakedaPublish').mockImplementation(async()=>{throw Error('WRONG_TAKEDA_BRANCH');});
 const messages:any[]=[],send=process.send;
 vi.spyOn(process as any,'send').mockImplementation((message:any,...args:any[])=>{if(message?.type?.startsWith('PRODUCER_')){messages.push(message);args.find(x=>typeof x==='function')?.(null);return true;}return (send as any).call(process,message,...args);});
 const result=runDbStartedCloudPublication({relay,controlPath,planned,source:input.publication.source,initialCertificate:input.publication.source.sourceQualityAdmission.receipt,overallDeadline:input.outerDeadline,ownedViatrisPipe:{selection:{mode:'VIATRIS_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)},archive:input.archive,producerRoot:input.scope.producerRoot}});
 const readContext=await respond(dir,'READ_PUBLICATION_CONTEXT',()=>[{context}]);expect(readContext.payload.sql).toContain('source-viatris-social');
 const publish=await respond(dir,'PUBLISH',()=>[]);expect(publish.payload.sql).toBe(packet.sql);expect(prepareCalls).toBe(1);
 const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
 await respond(dir,'READ_OUTCOME',()=>[{row:Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,packet.commit.sourceResult[f.name]??null])),batch:{id:planned.batch.id,releaseCandidateId:planned.batch.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:''}]);
 expect(await result).toMatchObject({state:'COMMITTED_EXACT',publishAcknowledged:true,batchFinalizationRequired:false,jobCount:7,publicationMode:'DB_STARTED_JOB_PROJECTION_DELTA_V1'});
 expect(messages.map(x=>x.type)).toEqual(['PRODUCER_REVIEW_CONSUMED_V1','PRODUCER_OUTCOME_VERIFIED_V1']);
 expect(messages[0].binding.sourceId).toBe('source-viatris-social');expect(messages[0].binding.requestSha256).toBe(publish.requestSha256);
 expect(packet.sql).toContain('PILOT_V75_FENCE_FUNCTION_DRIFT');expect(packet.sql).toContain('PILOT_V75_FENCE_TRIGGER_DRIFT');
});
