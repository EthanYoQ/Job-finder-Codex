/** Original runDb + fixed relay + owned wrapper. All responses synthetic, no SQL execution. */
import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';import {mkdtemp,readdir,readFile,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {initialize} from './synthetic-fixture.mts';import {createOwnedSessionConsumer} from './pipe-protocol.mjs';
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
for(const scenario of ['success','bad-row'])test('original runDb readback through actual diagnostic wrapper '+scenario,{timeout:120000},async()=>{
 const directory=await mkdtemp(join(tmpdir(),'takeda-real-wrapper-')),build=initialize();
 const seed={projectId:'yiopvxysxrtrnvqxwgbx',candidateId:'synthetic-offline-gate',sourceId:'source-takeda-china-social',batchId:'wrapper-'+randomUUID(),buildSha256:build.contentSha256,launchChallenge:randomBytes(32).toString('hex')};
 const chunks:string[]=[];let ended:any=null,terminal:Promise<void>|undefined,stderr='';
 async function next(){const stop=Date.now()+90000;while(!chunks.length&&!ended){if(Date.now()>=stop)throw Error('SYNTHETIC_WRAPPER_PROGRESS_TIMEOUT');await delay(10);}return chunks.splice(0).join('');}
 const toolsPort={kind:'TRUSTED_SYNTHETIC_TOOL_PORT',launch:async()=>{
  const env:NodeJS.ProcessEnv={...process.env,JOBFINDER_OWNED_PIPE_MODE:'TEST_ONLY',JOBFINDER_CLOUD_SOURCE_ID:seed.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'};delete env.NODE_OPTIONS;delete env.NODE_PATH;
  const child=spawn(process.execPath,['connector-gate/run-with-owned-publication-pipe.mjs',JSON.stringify(seed),join(directory,'diagnostics'),'1800000','--',process.execPath,'--require','./test/no-network.cjs','--import','./node_modules/tsx/dist/loader.mjs','connector-gate/db-started-gate-child.mts',directory,JSON.stringify(seed),scenario],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe']});
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',(x:string)=>chunks.push(x));child.stderr.on('data',(x:string)=>{stderr+=x;});
  terminal=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended={code,signal};resolve();});});
  return {session_id:202,output:await next()};
 },poll:async(id:number)=>{assert.equal(id,202);const output=await next();return {session_id:202,output,...(ended?{exit_code:ended.code}: {})};}};
 const h=createOwnedSessionConsumer({launch:seed,toolsPort,mode:'TEST_ONLY'} as any);
 try{
  await h.start();assert.equal(typeof h.snapshot().outerDeadline,'number');
  while(!h.snapshot().reviewSeen&&!h.snapshot().toolEnded)await h.poll();assert.equal(h.snapshot().held,false);
  const directoryRelay=join(directory,'relay');let publish:any;
  for(const name of await readdir(directoryRelay)){if(name.endsWith('.request.json')){const r=JSON.parse(await readFile(join(directoryRelay,name),'utf8'));if(r.kind==='PUBLISH')publish=r;}}
  assert(publish);const {requestSha256,...body}=publish;assert.equal(sha(JSON.stringify(body)),requestSha256);
  const expected={...seed,outerDeadline:h.snapshot().outerDeadline,sourceResultId:seed.batchId+'--'+seed.sourceId,requestId:publish.requestId,requestSha256,sqlSha256:sha(publish.payload.sql),expiresAt:Date.parse(publish.expiresAt),dispatchBefore:Date.parse(publish.payload.dispatchBefore)};
  h.acceptExpectedRequest(expected);h.consumeReview();await writeFile(join(directory,'finish-test-only'),'synthetic',{flag:'wx'});
  while(!h.snapshot().toolEnded)await h.poll();await terminal;
  assert.equal(ended.code,0,stderr+'\n'+await readFile(join(directory,'diagnostics/stderr.log'),'utf8'));assert.equal(h.snapshot().held,false);assert.equal(h.snapshot().childEnded,true);
  if(scenario==='success'){
   assert.equal(h.snapshot().outcomeSeen,true);let read:any;
   for(const name of await readdir(directoryRelay)){if(name.endsWith('.request.json')){const r=JSON.parse(await readFile(join(directoryRelay,name),'utf8'));if(r.kind==='READ_OUTCOME')read=r;}}
   assert(read);const raw=await readFile(join(directoryRelay,read.requestId+'.response.json'));
   const expectedOutcome={type:'PRODUCER_OUTCOME_VERIFIED_V1',tuple:{releaseCandidateId:seed.candidateId,batchId:seed.batchId,sourceId:seed.sourceId,sourceResultId:expected.sourceResultId},readRequestSha256:read.requestSha256,responseSha256:sha(raw)};
   h.acceptExpectedOutcome(expectedOutcome);assert.deepEqual(h.consumeOutcome(),expectedOutcome);assert.throws(()=>h.consumeOutcome(),/NOT_VERIFIED/);
  }else{assert.equal(h.snapshot().outcomeSeen,false);assert.throws(()=>h.consumeOutcome(),/NOT_VERIFIED/);}
  assert.equal(h.snapshot().dispatchAllowed,false);assert.match(await readFile(join(directory,'diagnostics/stdout.log'),'utf8'),/forgedOrdinaryLog/);
 }finally{await writeFile(join(directory,'finish-test-only'),'synthetic').catch(()=>{});await terminal;await rm(directory,{recursive:true,force:true});}
});
