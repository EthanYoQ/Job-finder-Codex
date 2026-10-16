import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,stat,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {join} from 'node:path';
const root=new URL('.',import.meta.url).pathname.replace(/\/$/,'');
const temporary=[];
async function newTestDirectory(){const path=await mkdtemp('/workspace/shared/job-finder-recovery/qilu-cloud-adapter-preflight/host-binding-test-');temporary.push(path);return path;}
after(async()=>{for(const path of temporary)await rm(path,{recursive:true,force:false});});
const source=await readFile(root+'/host-helper-functions.js','utf8');
const A=Object.getPrototypeOf(async function(){}).constructor;
const sha=s=>createHash('sha256').update(s).digest('hex');
function request(sql='SELECT 1'){
 const body={schemaVersion:1,requestId:randomUUID(),kind:'PUBLISH',expiresAt:new Date(Date.now()+60000).toISOString(),payload:{projectId:'yiopvxysxrtrnvqxwgbx',sql,dispatchBefore:new Date(Date.now()+30000).toISOString()}};
 return {...body,requestSha256:sha(JSON.stringify(body))};
}
async function helpers(r){
 const calls=[];const bytes=JSON.stringify(r);
 const tools={exec_command:async()=>({exit_code:0,output:JSON.stringify({text:bytes,sha256:sha(bytes),charCount:bytes.length,next:null})}),apply_patch:async()=>({}),mcp__codex_apps__supabase_execute_sql:async x=>{calls.push(x);return {content:[{type:'text',text:JSON.stringify({result:'\n<untrusted-data-test>\n[]\n</untrusted-data-test>'})}]};}};
 const h=await new A('tools','load','store',source)(tools,()=>({root,repo:root,project:'yiopvxysxrtrnvqxwgbx'}),()=>{});return {h,calls};
}
test('never dispatches SQL differing from the hash-bound request',async()=>{
 const r=request(),{h,calls}=await helpers(r);await assert.rejects(h.sqlDispatch(r,root,'SELECT 2'),/HOST_SQL_BINDING/);assert.equal(calls.length,0);
});
test('never dispatches a request for a different project',async()=>{
 const r=request();r.payload.projectId='different-project';const {h,calls}=await helpers(r);await assert.rejects(h.sqlDispatch(r,root,r.payload.sql),/HOST_SQL_BINDING/);assert.equal(calls.length,0);
});
test('mark refuses a newer on-disk request than the reviewed hash',async()=>{
 const dir=await newTestDirectory(),old=request(),changed={...old,payload:{...old.payload,sql:'SELECT 2'}};const {requestSha256,...body}=changed;changed.requestSha256=sha(JSON.stringify(body));
 await writeFile(join(dir,old.requestId+'.request.json'),JSON.stringify(changed));await writeFile(join(dir,old.requestId+'.request.ready'),'',{flag:'wx',mode:0o600});
 assert.throws(()=>execFileSync('node',[root+'/relay-files.mjs','mark-dispatch',dir,old.requestId,old.requestSha256],{stdio:'pipe'}),/REQUEST_REVIEW_HASH/);
 await assert.rejects(stat(join(dir,old.requestId+'.dispatch.json')),e=>e.code==='ENOENT');
});
test('an unchanged SQL request dispatches exactly once to the fixed project',async()=>{
 const r=request(),{h,calls}=await helpers(r);await h.sqlDispatch(r,root,r.payload.sql);assert.deepEqual(calls,[{project_id:r.payload.projectId,query:r.payload.sql}]);
});
test('in-memory request mutation is rejected against its stored bytes',async()=>{
 const r=request(),{h,calls}=await helpers(r);r.payload.sql='SELECT 2';await assert.rejects(h.sqlDispatch(r,root,r.payload.sql),/HOST_REQUEST_CHANGED/);assert.equal(calls.length,0);
});
test('a matching disk request can be marked only once',async()=>{
 const dir=await newTestDirectory(),r=request();await writeFile(join(dir,r.requestId+'.request.json'),JSON.stringify(r));await writeFile(join(dir,r.requestId+'.request.ready'),'',{flag:'wx',mode:0o600});
 execFileSync('node',[root+'/relay-files.mjs','mark-dispatch',dir,r.requestId,r.requestSha256],{stdio:'pipe'});
 assert.throws(()=>execFileSync('node',[root+'/relay-files.mjs','mark-dispatch',dir,r.requestId,r.requestSha256],{stdio:'pipe'}),/EEXIST/);
});
test('CREATE_PENDING rejects a generated SQL packet bound to another request',async()=>{
 const text=await readFile(root+'/host-stage-functions.js','utf8'),body='const cfg=h.cfg;\n'+text.slice(text.indexOf('async function handle')).replace('return {h,handle};','return handle;');
 const r={...request(),kind:'CREATE_PENDING'},calls=[];
 const h={cfg:{root,project:r.payload.projectId},q:JSON.stringify,cmd:async()=>JSON.stringify({output:'local.sql',sha256:'abc',requestSha256:'wrong'}),readFile:async()=>({text:'generated SQL',hash:'abc'}),mark:async()=>{},rows:x=>x.rows,respond:async()=>{}};
 const tools={mcp__codex_apps__supabase_execute_sql:async x=>{calls.push(x);return {rows:[{result:{batch:{},sourceRows:[]}}]};}};
 const handle=await new A('h','tools','store','load',body)(h,tools,()=>{},()=>{});await assert.rejects(handle(r,root),/HOST_CONTROL_REQUEST_BINDING/);assert.equal(calls.length,0);
});

test('next assembles a large request through bounded reads',async()=>{
 const r=request('SELECT '+JSON.stringify('q'.repeat(500000))), bytes=JSON.stringify(r);
 const calls=[];
 const tools={exec_command:async ({cmd})=>{
  calls.push(cmd);
  if(cmd.includes(' next-meta '))return {exit_code:0,output:JSON.stringify([{requestId:r.requestId,requestSha256:r.requestSha256,kind:r.kind,expired:false,dispatchRecorded:false}])};
  const offset=Number(cmd.match(/ (\d+)$/)[1]);
  return {exit_code:0,output:JSON.stringify({sha256:sha(bytes),charCount:bytes.length,text:bytes.slice(offset,offset+20000),next:offset+20000<bytes.length?offset+20000:null})};
 }};
 const h=await new A('tools','load','store',source)(tools,()=>({root,repo:root,project:r.payload.projectId}),()=>{});
 assert.deepEqual(await h.next(root),{...r,expired:false,dispatchRecorded:false});
 assert.ok(calls.length>20);assert.equal(calls.filter(c=>c.includes(' next-meta ')).length,1);
});
test('next rejects a changed request between metadata and bounded reads',async()=>{
 const r=request(), bytes=JSON.stringify(r);
 const tools={exec_command:async ({cmd})=>({exit_code:0,output:JSON.stringify(cmd.includes(' next-meta ')?[{requestId:r.requestId,requestSha256:'f'.repeat(64),kind:r.kind,expired:false,dispatchRecorded:false}]:{sha256:sha(bytes),charCount:bytes.length,text:bytes,next:null})})};
 const h=await new A('tools','load','store',source)(tools,()=>({root,repo:root,project:r.payload.projectId}),()=>{});
 await assert.rejects(h.next(root),/HOST_NEXT_REQUEST_CHANGED/);
});
test('next-meta never prints source SQL payload',async()=>{
 const dir=await newTestDirectory(),r=request('SELECT '+JSON.stringify('q'.repeat(500000)));
 await writeFile(join(dir,r.requestId+'.request.json'),JSON.stringify(r));await writeFile(join(dir,r.requestId+'.request.ready'),'',{flag:'wx',mode:0o600});
 const output=execFileSync('node',[root+'/relay-files.mjs','next-meta',dir],{encoding:'utf8'});
 assert.ok(output.length<1000);assert.equal(output.includes('SELECT'),false);
 assert.equal(JSON.parse(output)[0].requestSha256,r.requestSha256);
});
test('READ_CONTEXT rejects a different source or configuration before dispatch',async()=>{
 const text=await readFile(root+'/host-stage-functions.js','utf8'),body='const cfg=h.cfg;\n'+text.slice(text.indexOf('async function handle')).replace('return {h,handle};','return handle;');
 const calls=[],h={cfg:{root,project:'yiopvxysxrtrnvqxwgbx'},q:JSON.stringify,readFile:async()=>({text:'reviewed read query'}),mark:async()=>{},rows:x=>x.rows,respond:async()=>{}};
 const tools={mcp__codex_apps__supabase_execute_sql:async x=>{calls.push(x);return {rows:[{context:{checkedAt:new Date().toISOString()}}]};}};
 const handle=await new A('h','tools','store','load',body)(h,tools,()=>{},()=>{});
 for(const payload of [{projectId:h.cfg.project,sourceId:'source-novo-nordisk-china-social',sourceConfigSha256:'x'},{projectId:h.cfg.project,sourceId:'source-qilu-social',sourceConfigSha256:'wrong'}])await assert.rejects(handle({...request(),kind:'READ_CONTEXT',payload},root),/HOST_CONTEXT_SOURCE_BINDING/);
 assert.equal(calls.length,0);
});
test('Library store requires exact upload receipt and never claims remote recovery',async()=>{
 const text=await readFile(root+'/host-stage-functions.js','utf8'),body='const cfg=h.cfg;\n'+text.slice(text.indexOf('async function handle')).replace('return {h,handle};','return handle;');
 for(const corrupt of [false,'original-hash','original-size','upload-size','missing-id','status','version']){
  const r={...request(),kind:'ARCHIVE_STORE',payload:{bundlePath:root+'/archive.json',bundleSha256:'a'.repeat(64),byteCount:1729217}},responses=[],uploads=[];
  const audit={sha256:corrupt==='original-hash'?'wrong':r.payload.bundleSha256,bytes:corrupt==='original-size'?1:r.payload.byteCount,output:root+'/transfer.json',packedSha256:'b'.repeat(64),packedBytes:442103};
  const pending={payload:{projectId:'yiopvxysxrtrnvqxwgbx',planned:{batch:{id:'batch',releaseCandidateId:'candidate'},sources:[{id:'result',sourceId:'source-qilu-social',sourceConfigHash:'c'.repeat(64)}]}}};
  const h={cfg:{root,project:pending.payload.projectId},q:JSON.stringify,mark:async()=>{},save:async()=>{},respond:async(_r,_d,result)=>responses.push(result),cmd:async command=>command.includes('prepare-archive-upload')?JSON.stringify(audit):'{}'};
  const tools={mcp__codex_apps__library_create_library_file:async x=>{uploads.push(x);return {structuredContent:{status:corrupt==='status'?'unknown':'succeeded',library_file_id:'libfile_abcd',file_id:corrupt==='missing-id'?undefined:'file_abcd',file_name:'test.json',current_version_number:corrupt==='version'?null:0,file_size_bytes:corrupt==='upload-size'?1:audit.packedBytes,xattrs:[]}};},mcp__codex_apps__library_search:async()=>{throw Error('REMOTE_LOOKUP_MUST_BE_AFTER_COMMIT');},mcp__codex_apps__library_read:async()=>{throw Error('REMOTE_LOOKUP_MUST_BE_AFTER_COMMIT');}};
  const handle=await new A('h','tools','store','load',body)(h,tools,()=>{},()=>pending);
  if(corrupt){await assert.rejects(handle(r,root),/HOST_ARCHIVE_BINDING|HOST_ARCHIVE_UPLOAD_UNCERTAIN|HOST_ARCHIVE_UPLOAD_RECEIPT/);assert.equal(responses.length,0);}
  else{await handle(r,root);assert.equal(uploads[0].file,audit.output);assert.equal(responses[0].bundleSha256,r.payload.bundleSha256);assert.equal(responses[0].bundleByteCount,r.payload.byteCount);assert.equal(responses[0].stored,true);assert.equal(responses[0].recoveryVerification,'PENDING');assert.equal(Object.hasOwn(responses[0],'fullContentVerified'),false);}
 }
});
