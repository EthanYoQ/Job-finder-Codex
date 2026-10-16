import {readyRequestNames} from '../vendor/c60-source/ops/cloud-pilot-host/relay-request-ready.mjs';
/** Real owned child / IPC / gate, synthetic tool-session port only. Never dispatches. */
import test from 'node:test';import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {initialize} from './synthetic-fixture.mts';
import {superviseOwnedProducer} from './owned-supervisor.mjs';
import {createOwnedSessionConsumer,seedFromLaunch} from './pipe-protocol.mjs';
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
for(const entry of ['pipe-gate-child.mts','relay-gate-child.mts'])test('real same-process gate IPC '+entry, {timeout:120_000},async()=>{
 const build=initialize(),directory=await mkdtemp(join(tmpdir(),'takeda-gate-pipe-'));
 const launch={projectId:'yiopvxysxrtrnvqxwgbx',candidateId:'synthetic-offline-gate',sourceId:'source-takeda-china-social',batchId:'bridge-'+randomUUID(),buildSha256:build.contentSha256,launchChallenge:randomBytes(32).toString('hex'),outerDeadline:Date.now()+22*60_000};
 const frames:string[]=[];let terminal:Promise<any>|undefined,closed:any=null,launched=0;
 const chunks=async()=>{const deadline=Date.now()+90_000;while(frames.length===0&&!closed){if(Date.now()>=deadline)throw Error('SYNTHETIC_CHILD_PROGRESS_TIMEOUT');await delay(20);}return frames.splice(0).join('');};
 const toolsPort={kind:'TRUSTED_SYNTHETIC_TOOL_PORT',launch:async()=>{
  launched++;const env:NodeJS.ProcessEnv={...process.env,JOBFINDER_CLOUD_SOURCE_ID:launch.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const owner=superviseOwnedProducer({command:process.execPath,args:['--require','./test/no-network.cjs','--import','./node_modules/tsx/dist/loader.mjs','connector-gate/'+entry,directory,JSON.stringify(launch)],cwd:process.cwd(),env,launch,stdoutPath:join(directory,'stdout'),stderrPath:join(directory,'stderr'),emit:(frame:string)=>frames.push(frame),mode:'TEST_ONLY'});
  terminal=owner.terminal.then(value=>{closed=value;return value;});return {session_id:101,output:await chunks()};
 },poll:async(id:number)=>{assert.equal(id,101);const output=await chunks();return {session_id:101,output,...(closed?{exit_code:closed.exitCode}: {})};}};
 const consumer=createOwnedSessionConsumer({launch:seedFromLaunch(launch),toolsPort,mode:'TEST_ONLY'} as any);
 try{
  assert.equal((await consumer.start()).dispatchAllowed,false);
  while(!consumer.snapshot().reviewSeen){await consumer.poll();assert.equal(consumer.snapshot().held,false);}
  assert.equal(consumer.snapshot().status,'REVIEW_OBSERVED');assert.equal(consumer.snapshot().dispatchAllowed,false);
  const files=entry!=='pipe-gate-child.mts'?await readdir(join(directory,'relay')):[];
  if(files.length)assert.equal(files.filter(n=>n.endsWith('.request.json')).length,entry==='db-started-gate-child.mts'?2:1);
  let publishFile='';for(const name of readyRequestNames(files)){if(name.endsWith('.request.json')&&JSON.parse(await readFile(join(directory,'relay',name),'utf8')).kind==='PUBLISH')publishFile=name;}
  const requestPath=entry!=='pipe-gate-child.mts'?join(directory,'relay',publishFile):join(directory,'request.json');
  assert.equal((await stat(requestPath)).mode&0o777,0o600);
  const r=JSON.parse(await readFile(requestPath,'utf8')),{requestSha256,...body}=r;
  assert.equal(sha(JSON.stringify(body)),requestSha256);assert.equal(r.payload.sql.includes('SYNTHETIC_AWAIT_TIME_MUTATION'),false);
  const expected={...launch,sourceResultId:launch.batchId+'--'+launch.sourceId,requestId:r.requestId,requestSha256,sqlSha256:sha(r.payload.sql),dispatchBefore:Date.parse(r.payload.dispatchBefore),expiresAt:Date.parse(r.expiresAt)};
  assert.equal(consumer.acceptExpectedRequest(expected).dispatchAllowed,true);
  assert.deepEqual(consumer.consumeReview(),expected);assert.equal(consumer.snapshot().dispatchAllowed,false);
  assert.throws(()=>consumer.consumeReview(),/NOT_DISPATCHABLE/);assert.equal(launched,1);
  if(entry==='relay-gate-child.mts')await writeFile(join(directory,'relay',r.requestId+'.response.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:'PUBLISH',result:{status:'SUCCEEDED',rows:[{synthetic:'RELAY_RESPONSE_NOT_DATABASE_EVIDENCE'}]}}),{flag:'wx',mode:0o600});
  else await writeFile(join(directory,'finish-test-only'),'test-only',{flag:'wx'});
  await terminal;while(!consumer.snapshot().toolEnded)await consumer.poll();
  assert.equal(closed.actualChildClosed,true);assert.equal(closed.reviewSeen,true);assert.equal(closed.protocolFailed,false);assert.equal(closed.exitCode,0,await readFile(join(directory,'stderr'),'utf8'));
  assert.equal(consumer.snapshot().childEnded,true);assert.equal(consumer.snapshot().held,false);assert.equal(consumer.snapshot().dispatchAllowed,false);
  assert.match(await readFile(join(directory,'stdout'),'utf8'),/forgedOrdinaryLog/);
 }finally{
  await writeFile(join(directory,'finish-test-only'),'test-only').catch(()=>{});
  if(entry==='relay-gate-child.mts'&&!closed){try{for(const name of readyRequestNames(await readdir(join(directory,'relay')))){if(!name.endsWith('.request.json'))continue;const r=JSON.parse(await readFile(join(directory,'relay',name),'utf8'));await writeFile(join(directory,'relay',r.requestId+'.response.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,result:{status:'FAILED',code:'SYNTHETIC_TEST_ABORT',outcome:'UNKNOWN'}}),{flag:'wx'}).catch(()=>{});}}catch{}}
  await terminal;await rm(directory,{recursive:true,force:true});
 }
});
