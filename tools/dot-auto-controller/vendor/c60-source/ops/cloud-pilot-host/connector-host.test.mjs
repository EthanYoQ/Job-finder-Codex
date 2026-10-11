/** All external effects are stubbed. Fixtures are not activation or old-owner evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {HOST_ROOT,PRODUCER_ROOT,BINDING_ROOT,TASK_ROOT,RELAY_ROOT,SOURCE,SOURCE_HASH,MODE,PROJECT,SELECTOR} from './connector-host-binding.mjs';
const testRoot=process.env.CONNECTOR_TEST_HOST_ROOT??HOST_ROOT;
const sha=x=>createHash('sha256').update(x).digest('hex'),A=Object.getPrototypeOf(async function(){}).constructor;
const configSha=process.env.CONNECTOR_TEST_CONFIG_SHA;
if(!configSha)throw Error('OFFLINE_FIXTURE_REQUIRED');
const config=JSON.parse(fs.readFileSync(path.join(BINDING_ROOT,configSha+'.json')));
const env=extra=>({...process.env,JOBFINDER_CLOUD_SOURCE_ID:SOURCE,[SELECTOR]:configSha,...extra});
function cli(script,args,extra={}){return spawnSync(process.execPath,[path.join(testRoot,script),...args],{cwd:PRODUCER_ROOT,env:env(extra),encoding:'utf8'});}
function mustReject(r,pattern){assert.notEqual(r.status,0,r.stdout);assert.match(r.stderr,pattern);}
function make(kind='READ_CONTEXT',payload={projectId:PROJECT,sourceId:SOURCE,sourceConfigSha256:SOURCE_HASH,purpose:'PRE_CAPTURE'},expires=Date.now()+60000){const b={schemaVersion:1,requestId:randomUUID(),kind,expiresAt:new Date(expires).toISOString(),payload};return {...b,requestSha256:sha(JSON.stringify(b))};}
function put(r){const file=path.join(RELAY_ROOT,r.requestId+'.request.json');fs.writeFileSync(file,JSON.stringify(r),{flag:'wx',mode:0o600});return file;}
function binding(change){const c=structuredClone(config);change(c);const text=JSON.stringify(c),s=sha(text);fs.writeFileSync(path.join(BINDING_ROOT,s+'.json'),text,{flag:'wx',mode:0o400});return s;}
async function host(selected=configSha,launchEnv={},contextExtra={}){const calls=[],commands=[],state=new Map();
 const cfg={mode:MODE,bindingSha256:selected,root:testRoot,repo:PRODUCER_ROOT,project:PROJECT};
 const tools={exec_command:async({cmd,workdir})=>{commands.push(cmd);const r=spawnSync('/bin/bash',['-c',cmd],{cwd:workdir,env:env(launchEnv),encoding:'utf8'});return {exit_code:r.status,output:r.stdout+(r.status===0?'':r.stderr)};},apply_patch:async()=>{throw Error('NO_PATCH_WRITES_IN_CONNECTOR_MODE');},mcp__codex_apps__supabase_execute_sql:async x=>{calls.push(x);return {structuredContent:{result:'\n<untrusted-data-fixture>\n'+JSON.stringify([{context:{checkedAt:new Date().toISOString(),sourceId:SOURCE,sourceConfigSha256:SOURCE_HASH,jobs:[],latestAccepted:null,firstAccepted:null,...contextExtra}}])+'\n</untrusted-data-fixture>'}};}};
 const helpers=fs.readFileSync(path.join(testRoot,'host-helper-functions.js'),'utf8'),h=await new A('tools','load','store',helpers)(tools,()=>cfg,(k,v)=>state.set(k,v));
 const text=fs.readFileSync(path.join(testRoot,'host-stage-functions.js'),'utf8'),body='const cfg=h.cfg;\n'+text.slice(text.indexOf('async function handle')).replace('return {h,handle};','return handle;');
 const handle=await new A('h','tools','store','load',body)(h,tools,(k,v)=>state.set(k,v),k=>state.get(k));return {h,handle,calls,commands,state};
}
test('actual source-derived Takeda READ_CONTEXT succeeds through original connector shape',async()=>{
 const r=make();put(r);const {handle,calls}=await host();const out=await handle(r,RELAY_ROOT);assert.equal(out.status,'READ_CONTEXT');assert.equal(calls.length,1);assert.equal(calls[0].project_id,PROJECT);assert.match(calls[0].query,/source-takeda-china-social/);assert.match(calls[0].query,/job-projection-delta-receipt-v1/);assert.match(calls[0].query,/plan-bound-source-quality-v1/);assert.ok(!calls[0].query.includes('source-lilly-china-social'));assert.ok(fs.existsSync(path.join(RELAY_ROOT,r.requestId+'.dispatch.json')));assert.ok(fs.existsSync(path.join(RELAY_ROOT,r.requestId+'.response.json')));
});
test('source/hash mismatches never call SQL',async()=>{for(const payload of [{sourceId:'source-lilly-china-social'},{sourceConfigSha256:'f'.repeat(64)}]){const r=make('READ_CONTEXT',{projectId:PROJECT,sourceId:SOURCE,sourceConfigSha256:SOURCE_HASH,purpose:'PRE_CAPTURE',...payload});put(r);const {handle,calls}=await host();await assert.rejects(handle(r,RELAY_ROOT),/HOST_CONTEXT_SOURCE_BINDING/);assert.equal(calls.length,0);}});
test('candidate and build config mismatches never call SQL',async()=>{
 for(const change of [c=>{c.control.candidate.goalId='another-goal';},c=>{c.control.build.runtimeTreeSha256='0'.repeat(64);const {contentSha256,...base}=c.control.build;c.control.build.contentSha256=sha(JSON.stringify(base));}]){const selected=binding(change),r=make();put(r);const {handle,calls}=await host(selected);await assert.rejects(handle(r,RELAY_ROOT),/HOST_CONFIG_CANDIDATE|INTEGRITY_BUILD_MISMATCH/);assert.equal(calls.length,0);}
});
test('missing configuration is rejected before SQL',async()=>{const source=fs.readFileSync(path.join(testRoot,'host-helper-functions.js'),'utf8');await assert.rejects(new A('tools','load','store',source)({},()=>({mode:MODE}),()=>{}),/HOST_CONFIG_REQUIRED/);mustReject(cli('host-files.mts',['connector-validate'],{[SELECTOR]:''}),/HOST_CONFIG_REQUIRED/);});
test('fixed task path and ancestor symlink are rejected',()=>{
 mustReject(cli('relay-files.mjs',['next-meta',TASK_ROOT]),/RELAY_DIRECTORY_OUTSIDE_TASK/);
 const r=make(),file=put(r),link=path.join(RELAY_ROOT,randomUUID()+'.request.json');fs.symlinkSync(file,link);
 mustReject(cli('host-files.mts',['connector-read',link]),/HOST_FILE/);fs.unlinkSync(link);
 const outside=path.join(TASK_ROOT,r.requestId+'.request.json');fs.writeFileSync(outside,JSON.stringify(r),{mode:0o600});mustReject(cli('host-files.mts',['connector-read',outside]),/HOST_PATH_SCOPE/);
});
test('PUBLISH only waits for parent review, never marks or calls SQL',async()=>{
 const dispatchBefore=new Date(Date.now()+30000).toISOString(),r=make('PUBLISH',{projectId:PROJECT,sql:"SET LOCAL statement_timeout = '120000ms';\nDO $atomic_fixture$ BEGIN NULL; END; $atomic_fixture$;",dispatchBefore});put(r);
 const {handle,calls,state}=await host(),out=await handle(r,RELAY_ROOT);assert.equal(out.status,'AWAITING_PARENT_REVIEW');assert.equal(out.dispatchBefore,dispatchBefore);assert.equal(out.expiresAt,r.expiresAt);assert.equal(calls.length,0);assert.equal(fs.existsSync(path.join(RELAY_ROOT,r.requestId+'.dispatch.json')),false);assert.equal(state.get('cloudPilotPublishRequest'),r);
});
test('new mode rejects unused archive and legacy control kinds with zero SQL',async()=>{const {handle,calls}=await host();for(const kind of ['ARCHIVE_STORE','CREATE_PENDING','LEASE_ACQUIRE','LEASE_RENEW','LEASE_RELEASE'])await assert.rejects(handle(make(kind),RELAY_ROOT),/HOST_DB_STARTED_KIND/);assert.equal(calls.length,0);});
test('dispatch marker is exclusive and changed request hash is rejected',()=>{
 const r=make('PUBLISH',{projectId:PROJECT,sql:'SELECT 1',dispatchBefore:new Date(Date.now()+30000).toISOString()});put(r);
 mustReject(cli('relay-files.mjs',['mark-dispatch',RELAY_ROOT,r.requestId,'f'.repeat(64)]),/REQUEST_REVIEW_HASH/);
 const first=cli('relay-files.mjs',['mark-dispatch',RELAY_ROOT,r.requestId,r.requestSha256]);assert.equal(first.status,0,first.stderr);
 mustReject(cli('relay-files.mjs',['mark-dispatch',RELAY_ROOT,r.requestId,r.requestSha256]),/EEXIST/);
});
test('UNKNOWN expired marker remains readable and is never replayed or extended',async()=>{
 const r=make('PUBLISH',{projectId:PROJECT,sql:'SELECT 1',dispatchBefore:new Date(Date.now()-2000).toISOString()},Date.now()-1000),file=put(r),before=fs.readFileSync(file);
 fs.writeFileSync(path.join(RELAY_ROOT,r.requestId+'.dispatch.json'),JSON.stringify({schemaVersion:1,requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,state:'MAY_HAVE_BEEN_SENT',markedAt:new Date(Date.now()-3000).toISOString()}),{mode:0o600});
 const meta=cli('relay-files.mjs',['next-meta',RELAY_ROOT]);assert.equal(meta.status,0,meta.stderr);assert.ok(JSON.parse(meta.stdout).find(x=>x.requestId===r.requestId&&x.expired&&x.dispatchRecorded));
 const expired=cli('relay-files.mjs',['expire-undispatched',RELAY_ROOT,r.requestId,r.requestSha256]);assert.equal(expired.status,0,expired.stderr);assert.deepEqual(JSON.parse(expired.stdout),{settled:false,reason:'DISPATCH_UNCERTAIN',requestId:r.requestId});
 const {handle,calls}=await host();await assert.rejects(handle({...r,expired:true,dispatchRecorded:true},RELAY_ROOT),/HOST_STALE_OR_UNCERTAIN_REQUEST/);assert.equal(calls.length,0);assert.deepEqual(fs.readFileSync(file),before);assert.equal(fs.existsSync(path.join(RELAY_ROOT,r.requestId+'.response.json')),false);
});
test('expiry and dispatchBefore remain absolute, expired undispatched request settles once',()=>{
 const r=make('PUBLISH',{projectId:PROJECT,sql:'SELECT 1',dispatchBefore:new Date(Date.now()-1000).toISOString()}),file=put(r),before=fs.readFileSync(file);
 mustReject(cli('relay-files.mjs',['mark-dispatch',RELAY_ROOT,r.requestId,r.requestSha256]),/REQUEST_EXPIRED/);assert.deepEqual(fs.readFileSync(file),before);
 const expired=make('READ_CONTEXT',undefined,Date.now()-1000);put(expired);const out=cli('relay-files.mjs',['expire-undispatched',RELAY_ROOT,expired.requestId,expired.requestSha256]);assert.equal(out.status,0,out.stderr);assert.equal(JSON.parse(out.stdout).settled,true);const response=JSON.parse(fs.readFileSync(path.join(RELAY_ROOT,expired.requestId+'.response.json')));assert.equal(response.result.outcome,'NOT_DISPATCHED');assert.equal(response.result.code,'REQUEST_EXPIRED');
});
test('control-generated publication context rejects wrong candidate SQL',async()=>{
 const r=make('READ_PUBLICATION_CONTEXT',{projectId:PROJECT,sql:"SELECT 'wrong-candidate'"});put(r);const {handle,calls}=await host();await assert.rejects(handle(r,RELAY_ROOT),/HOST_CONTEXT_SQL_BINDING/);assert.equal(calls.length,0);
});
test('config cannot select a path, loader, provider, source, route or new publication mode',()=>{
 for(const change of [c=>{c.path='/etc/passwd';},c=>{c.loader='/tmp/code.mjs';},c=>{c.provider='postgres';},c=>{c.sourceId='source-lilly-china-social';},c=>{c.route='A';},c=>{c.publicationMode='DB_STARTED_OWNER_V1';}]){const selected=binding(change);mustReject(cli('host-files.mts',['connector-validate'],{[SELECTOR]:selected}),/HOST_CONFIG_SCOPE/);}
});

test('actual launcher ignores default PATH and inherited Node preload',async()=>{
 const r=make();put(r);const {handle,calls,commands}=await host(configSha,{PATH:'/usr/bin:/bin',NODE_OPTIONS:'--require=/this-must-not-execute.cjs'}),started=performance.now();
 const out=await handle(r,RELAY_ROOT);assert.equal(out.status,'READ_CONTEXT');assert.equal(calls.length,1);assert.ok(commands.every(c=>c.includes('/usr/bin/python3 -I ')&&c.includes('connector-host-launch.py')));
 console.log(JSON.stringify({event:'ACTUAL_HELPER_READ_CONTEXT_TIMING',elapsedMs:Math.round(performance.now()-started),defaultPath:'/usr/bin:/bin',usedFixedNode:true,fixtureOnly:true}));
});
test('config mode, hardlink and symlink are rejected without permission repair',()=>{
 const source=path.join(BINDING_ROOT,configSha+'.json'),text=fs.readFileSync(source,'utf8');
 for(const how of ['mode','link','symlink']){const c=JSON.parse(text);c.control.candidate.id='OFFLINE_FILE_'+how;const bytes=JSON.stringify(c),s=sha(bytes),file=path.join(BINDING_ROOT,s+'.json');
  if(how==='symlink')fs.symlinkSync(source,file);else{fs.writeFileSync(file,bytes,{flag:'wx',mode:how==='mode'?0o600:0o400});if(how==='link')fs.linkSync(file,file+'.second-link');}
  mustReject(cli('host-files.mts',['connector-validate'],{[SELECTOR]:s}),/HOST_FILE/);
  assert.equal(fs.lstatSync(file).isSymbolicLink(),how==='symlink');
 }
});

test('tool-isolate SHA256 matches Node crypto for padding and Unicode boundaries',async()=>{
 const {h}=await host();for(const value of ['', 'abc', 'a'.repeat(55),'a'.repeat(56),'a'.repeat(63),'a'.repeat(64),'中😀\'\\'.repeat(5000)])assert.deepEqual(h.responseDigest(value),{sha256:sha(value),byteCount:Buffer.byteLength(value),charCount:value.length});
});
test('200KiB-plus Unicode/quoted context crosses real launcher in bounded chunks',async()=>{
 const extra={large:"中'😀\\\n".repeat(22000)},r=make();put(r);const {handle,calls,commands}=await host(configSha,{PATH:'/usr/bin:/bin',NODE_OPTIONS:'--require=/must-not-load.cjs'},extra),start=performance.now();
 const out=await handle(r,RELAY_ROOT);assert.equal(out.status,'READ_CONTEXT');assert.equal(calls.length,1);assert.ok(commands.every(c=>Buffer.byteLength(c)<100000));
 const response=JSON.parse(fs.readFileSync(path.join(RELAY_ROOT,r.requestId+'.response.json')));assert.equal(response.result.large,extra.large);assert.ok(Buffer.byteLength(JSON.stringify(response))>200000);
 console.log(JSON.stringify({event:'LARGE_RESPONSE_TIMING',elapsedMs:Math.round(performance.now()-start),responseBytes:Buffer.byteLength(JSON.stringify(response)),maxCommandBytes:Math.max(...commands.map(c=>Buffer.byteLength(c))),sqlCalls:calls.length,fixtureOnly:true}));
});
test('multipart duplicate/out-of-order/missing/wrong request/hash stop before response',()=>{
 const r=make();put(r);const dest=path.join(RELAY_ROOT,r.requestId+'.host-result.json'),text=JSON.stringify({requestId:r.requestId,requestSha256:r.requestSha256,result:{value:'x'.repeat(20000)}}),meta={requestSha256:r.requestSha256,sha256:sha(text),byteCount:Buffer.byteLength(text),charCount:text.length,count:Math.ceil(text.length/16000)};
 const part=(index,change={})=>cli('host-files.mts',['connector-save-part',dest,JSON.stringify({...meta,index,text:text.slice(index*16000,(index+1)*16000),...change})]);
 const assemble=(change={})=>cli('host-files.mts',['connector-save-assemble',dest,JSON.stringify({...meta,...change})]);
 const finalize=(change={})=>cli('host-files.mts',['connector-save-finalize',dest,JSON.stringify({...meta,...change})]);
 mustReject(part(1),/ENOENT/);let out=part(0);assert.equal(out.status,0,out.stderr);mustReject(part(0),/EEXIST/);mustReject(assemble(),/ENOENT/);mustReject(part(1,{requestSha256:'f'.repeat(64)}),/HOST_RESPONSE_PART/);assert.equal(fs.existsSync(dest),false);
 out=part(1);assert.equal(out.status,0,out.stderr);mustReject(assemble({sha256:'f'.repeat(64)}),/HOST_RESPONSE_PART/);out=assemble();assert.equal(out.status,0,out.stderr);assert.equal(fs.existsSync(dest),false);mustReject(finalize({sha256:'f'.repeat(64)}),/HOST_RESPONSE_HASH/);
 out=finalize();assert.equal(out.status,0,out.stderr);assert.equal(fs.readFileSync(dest,'utf8'),text);mustReject(finalize(),/EEXIST/);assert.equal(fs.existsSync(path.join(RELAY_ROOT,r.requestId+'.response.json')),false);assert.equal(fs.existsSync(path.join(RELAY_ROOT,r.requestId+'.dispatch.json')),false);
});

test('1MiB response retains the original 60-second control window',async()=>{
 const extra={large:'x'.repeat(1024*1024)},r=make();put(r);const {handle,calls}=await host(configSha,{},extra),started=performance.now();
 const out=await handle(r,RELAY_ROOT),elapsedMs=Math.round(performance.now()-started);assert.equal(out.status,'READ_CONTEXT');assert.equal(calls.length,1);assert.ok(Date.now()<Date.parse(r.expiresAt));
 const response=JSON.parse(fs.readFileSync(path.join(RELAY_ROOT,r.requestId+'.response.json')));assert.equal(response.result.large,extra.large);console.log(JSON.stringify({event:'ONE_MIB_RESPONSE_TIMING',elapsedMs,originalExpiresAt:r.expiresAt,sqlCalls:calls.length,fixtureOnly:true}));
});
