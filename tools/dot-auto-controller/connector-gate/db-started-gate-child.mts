import {readyRequestNames} from '../vendor/c60-source/ops/cloud-pilot-host/relay-request-ready.mjs';
/** Original DB-started worker with real gate/relay; synthetic response files only. */
import assert from 'node:assert/strict';import {readdir,readFile,writeFile,rm,mkdir} from 'node:fs/promises';import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {Prisma} from '@prisma/client';
import {initialize,fixture,dirs} from './synthetic-fixture.mts';
import {FilePilotRelay} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {runDbStartedCloudPublication} from '../vendor/c60-source/src/crawler/cloudDbStartedPilot.ts';
const [directory,launchJson,scenario='success']=process.argv.slice(2),launch={...JSON.parse(launchJson),outerDeadline:Number(process.env.P0_PILOT_OUTER_DEADLINE_MS)||JSON.parse(launchJson).outerDeadline};let ended=false;
try{
 assert.equal(initialize().contentSha256,launch.buildSha256);
 const f=await fixture({databaseProfile:'SQL49',at:new Date().toISOString(),syntheticBatchId:launch.batchId,syntheticOuterDeadline:launch.outerDeadline});
 let packet:any;const kinds:string[]=[];
 // Test observation only; the original fixed method and its owned capability are unchanged.
 class ObservedRelay extends FilePilotRelay{override async prepareOwnedTakedaPublish(...args:Parameters<FilePilotRelay['prepareOwnedTakedaPublish']>){const h=await super.prepareOwnedTakedaPublish(...args);packet=h.packet;return h;}}
 const relayDirectory=join(directory,'relay'),relay=new ObservedRelay(relayDirectory);await mkdir(relayDirectory);
 const {planned,context,...control}=f.input.publication.control,controlPath=join(directory,'control.json');
 await writeFile(controlPath,JSON.stringify(control),{flag:'wx',mode:0o600});
 const responded=new Set<string>(),deadline=Date.now()+60_000;
 const syntheticResponder=(async()=>{while(!ended&&Date.now()<deadline){
  for(const name of readyRequestNames(await readdir(relayDirectory))){
   if(!name.endsWith('.request.json')||responded.has(name))continue;
   const r=JSON.parse(await readFile(join(relayDirectory,name),'utf8'));let rows:unknown[];
   if(r.kind==='READ_PUBLICATION_CONTEXT')rows=[{context:{...context,checkedAt:new Date().toISOString()}}];
   else if(r.kind==='PUBLISH'){
    try{await readFile(join(directory,'finish-test-only'));}catch{continue;}
    rows=[];
   }else if(r.kind==='READ_OUTCOME'){
    assert(packet);const model=Prisma.dmmf.datamodel.models.find(m=>m.name==='CrawlBatchSourceResult')!;
    const physical=Object.fromEntries(model.fields.filter(f=>f.kind!=='object').map(f=>[f.name,packet.commit.sourceResult[f.name]??null]));
    if(scenario==='bad-row')physical.dedupeOutputCount=Number(physical.dedupeOutputCount)+1;
    rows=[{row:physical,batch:{id:planned.batch.id,releaseCandidateId:planned.batch.releaseCandidateId,status:'SUCCESS',atomicCommittedCount:1,completenessVerifiedCount:1},holderId:''}];
   }else throw Error('SYNTHETIC_UNEXPECTED_REQUEST');
   kinds.push(r.kind);responded.add(name);
   await writeFile(join(relayDirectory,r.requestId+'.response.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,result:{status:'SUCCEEDED',rows}}),{flag:'wx',mode:0o600});
  }await delay(10);
 }})();
 console.log('JOBFINDER_OWNED_PIPE_V1 {"forgedOrdinaryLog":true}');
 const outcome=await runDbStartedCloudPublication({relay,controlPath,planned,source:f.input.publication.source,initialCertificate:f.input.publication.source.sourceQualityAdmission!.status==='ACCEPTED'?f.input.publication.source.sourceQualityAdmission!.receipt as any:null as any,overallDeadline:launch.outerDeadline,ownedTakedaPipe:{selection:{mode:'TAKEDA_OWNED_PIPE_CANDIDATE_V1',launchChallenge:launch.launchChallenge},archive:f.input.archive,producerRoot:f.input.scope.producerRoot}});
 ended=true;await syntheticResponder;
 assert.equal(outcome.state,scenario==='bad-row'?'CONFLICT':'COMMITTED_EXACT');assert.equal(outcome.publishAcknowledged,true);assert.deepEqual(kinds,['READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME']);
 assert.equal(packet.commit.sourceResult.completenessCertificate.detailEvidenceState,'UNKNOWN');
 console.log('SYNTHETIC_ONLY_ORIGINAL_DB_STARTED_THREE_STAGE_PASS');
}catch(error){ended=true;console.error(error);process.exitCode=1;}
finally{await Promise.all(dirs.splice(0).map(p=>rm(p,{recursive:true,force:true})));process.disconnect?.();}
