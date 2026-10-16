import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,writeFile,rm,stat} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {FilePilotRelay,PILOT_BUDGET,sha256} from '../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
for(const kind of ['READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME'] as const)test('unchanged old sql route '+kind,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'legacy-relay-')),relay=new FilePilotRelay(directory),deadline=Date.now()+200000;
 try{
  const promise=relay.sql(kind,'SYNTHETIC_NON_EXECUTABLE_SQL',deadline);let path='';
  while(!path){path=(await readdir(directory)).find(f=>f.endsWith('.request.json'))??'';if(!path)await delay(5);}
  const r=JSON.parse(await readFile(join(directory,path),'utf8')),{requestSha256,...body}=r;
  assert.equal(sha256(JSON.stringify(body)),requestSha256);assert.equal((await stat(join(directory,path))).mode&0o777,0o600);
  assert.equal(Date.parse(r.payload.dispatchBefore),deadline-(kind==='PUBLISH'?PILOT_BUDGET.publishDbMs+PILOT_BUDGET.publishTransportMs:PILOT_BUDGET.controlCompletionMs));
  await assert.rejects(writeFile(join(directory,path),'duplicate',{flag:'wx'}),{code:'EEXIST'});
  await writeFile(join(directory,r.requestId+'.response.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256,kind,result:{status:'SUCCEEDED',rows:[{synthetic:true}]}}),{flag:'wx'});
  assert.deepEqual(await promise,[{synthetic:true}]);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('new fixed method rejects copied handle and unavailable original IPC',async()=>{
 const relay=new FilePilotRelay('/tmp/unused-relay-no-io');
 await assert.rejects(relay.publishOwnedTakeda({packet:{}} as any),/SAME_PROCESS_REVIEW_REQUIRED/);
 await assert.rejects(relay.prepareOwnedTakedaPublish({} as any,{mode:'TAKEDA_OWNED_PIPE_CANDIDATE_V1',launchChallenge:'a'.repeat(64)}),/OWNED_CHILD_IPC_REQUIRED/);
});
