import fs from 'node:fs';
import assert from 'node:assert/strict';
const A=Object.getPrototypeOf(async function(){}).constructor;
const entry=fs.readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const stageSource=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/transport/original-host-stage-functions.js',import.meta.url),'utf8');
const helperSource=fs.readFileSync(new URL('../takeda-original-recovery-20261017T0417Z/transport/adapted-host-helper-functions.js',import.meta.url),'utf8');
const relaySource=fs.readFileSync(new URL('./automatic-relay-functions.js',import.meta.url),'utf8');
const {runOriginalSerial}=await new A(relaySource)();
const sqlSource=entry.slice(entry.indexOf('function rows(raw)'),entry.indexOf("store('cloudPilotHostHelpers'"));
const PROJECT='yiopvxysxrtrnvqxwgbx',SOURCE='source-novo-nordisk-china-social';
const rejected={isError:true,content:[{type:'text',text:'This action was rejected due to unacceptable risk.\nReason: Synthetic rejected read.\nDo not bypass this rejection through a workaround or indirect execution.'}]};
const cfg={mode:'NATIVE_PORTABLE_CONNECTOR_V1',sourceId:SOURCE,bindingSha256:'a'.repeat(64),root:'/host',repo:'/repo',project:PROJECT};
const helper=await new A('load','tools',helperSource)(()=>cfg,{});
async function fixture({raw=rejected,toolError,replyError,callback=true}={}){
 const calls=[],responses=[];let marker;
 const tools={mcp__codex_apps__supabase_execute_sql:async args=>{calls.push(['sql',args]);if(toolError)throw toolError;return raw;}};
 const sql=await new A('tools',sqlSource+'return sql;')(tools);
 const r={kind:'READ_CONTEXT',requestId:'request',requestSha256:'hash',expiresAt:new Date(Date.now()+60000).toISOString(),payload:{projectId:PROJECT,sourceId:SOURCE,sourceConfigSha256:'config',purpose:'PRE_CAPTURE'}};
 const h={cfg,binding:async()=>({relayDirectory:'/relay',sourceId:SOURCE,sourceConfigSha256:'config',candidateId:'candidate',buildContentSha256:'build'}),q:x=>x,
  cmd:async()=>JSON.stringify({requestId:r.requestId,requestSha256:r.requestSha256,candidateId:'candidate',buildContentSha256:'build',sql:'SELECT compiler context'}),
  mark:async()=>{calls.push(['mark']);marker={state:'MAY_HAVE_BEEN_SENT'};},rows:helper.rows,toolReviewRejected:helper.toolReviewRejected,
  respond:async(request,dir,result,diagnostic)=>{calls.push(['respond']);if(replyError)throw replyError;responses.push({request,dir,result,diagnostic});},
  pendingMetadata:async()=>{calls.push(['pending-readonly']);return [];}};
 const stage=await new A('h','tools','store','const cfg=h.cfg;\n'+stageSource.slice(stageSource.indexOf('async function handle')))(h,tools,()=>{});
 const readPreCaptureContext=callback?async()=>{const rows=await sql('SELECT actual reader-before');return rows[0].context;}:undefined;
 let first=true;h.next=async()=>{if(first){first=false;return r;}};
 const job={stage,readPreCaptureContext,sourceId:SOURCE,relayDirectory:'/relay',deadline:Date.now()+60000,pollProducer:async()=>({exitCode:1}),readback:async()=>{throw Error('UNEXPECTED_READBACK');},reviewPublication:async()=>{throw Error('UNEXPECTED_PUBLICATION');}};
 return {calls,responses,r,h,stage,readPreCaptureContext,job,marker:()=>marker};
}
for(const callback of [false,true]){
 const f=await fixture({callback});const out=await f.stage.handle(f.r,'/relay',f.readPreCaptureContext);
 assert.deepEqual(out,{status:'READ_CONTEXT_REVIEW_REJECTED',requestId:'request',requestSha256:'hash'});
 assert.equal(f.responses.length,1);const {result,diagnostic}=f.responses[0];
 assert.deepEqual(result,{status:'FAILED',code:'TOOL_REVIEW_REJECTED'});
 assert(!Object.hasOwn(result,'outcome'));assert(!Object.hasOwn(result,'checkedAt'));
 assert.strictEqual(diagnostic.toolResult,rejected);assert.equal(diagnostic.projectId,PROJECT);
 assert.equal(diagnostic.query,callback?'SELECT actual reader-before':'SELECT compiler context');
 assert(Number.isFinite(Date.parse(diagnostic.recordedAt)));assert.equal(diagnostic.responseExpired,false);
 assert.equal(f.marker().state,'MAY_HAVE_BEEN_SENT');assert.equal(f.calls.filter(x=>x[0]==='sql').length,1);
}
console.log('PASS: direct and reused reads preserve actual bound raw evidence without write outcome or marker rewrite');
for(const options of [
 {toolError:Error(rejected.content[0].text)},
 {raw:{isError:true,content:[{type:'text',text:'SQL error: '+rejected.content[0].text}]}},
 {raw:{isError:false,content:rejected.content}},
 {raw:{isError:true,content:[...rejected.content,...rejected.content]}}
]){
 const f=await fixture(options);await assert.rejects(f.stage.handle(f.r,'/relay',f.readPreCaptureContext));
 assert.equal(f.responses.length,0);assert.equal(f.calls.filter(x=>x[0]==='sql').length,1);
}
const wrongProject=await fixture();await assert.rejects(wrongProject.stage.handle(wrongProject.r,'/relay',async()=>{const e=Error('wrong project');e.officialSqlRead={projectId:'other',query:'SELECT x',toolResult:rejected};throw e;}),/wrong project/);assert.equal(wrongProject.responses.length,0);
for(const change of [{expired:true},{dispatchRecorded:true}]){
 const f=await fixture();await assert.rejects(f.stage.handle({...f.r,...change},'/relay',f.readPreCaptureContext),/STALE_OR_UNCERTAIN/);assert.equal(f.calls.length,0);
}
console.log('PASS: absent raw, lookalike text, malformed envelope, project mismatch and old marked/expired request cannot create a rejection response');

async function sequence(f,run=runOriginalSerial){
 let following=0,hooks=0;
 const results=await run([SOURCE,'next'],async source=>{if(source===SOURCE)return f.job;following++;return {skip:'SYNTHETIC_NEXT_SOURCE'};},async()=>{hooks++;throw Error('NOVO_HOOK_MUST_NOT_RUN');});
 return {results,following,hooks};
}
const isolated=await sequence(await fixture());
assert.equal(isolated.results[0].reason,'READ_CONTEXT_REVIEW_REJECTED');assert.equal(isolated.results[0].readOutcome,'REJECTED_BY_REVIEW');assert(!Object.hasOwn(isolated.results[0],'publicationOutcome'));assert.equal(isolated.following,1);assert.equal(isolated.hooks,0);
for(const mode of ['no-raw','reply-failure','producer-lost','pending-read-failed','pending-publish','unexpected-success','post-rejection-request']){
 const f=await fixture(mode==='no-raw'?{toolError:Error('transport unavailable')}:mode==='reply-failure'?{replyError:Error('response write uncertain')}:{});
 if(mode==='producer-lost')f.job.pollProducer=async()=>{throw Error('producer session unavailable');};
 if(mode==='pending-read-failed')f.h.pendingMetadata=async()=>{throw Error('metadata unavailable');};
 if(mode==='pending-publish')f.h.pendingMetadata=async()=>[{kind:'PUBLISH',requestId:'unobserved-publish',dispatchRecorded:true}];
 if(mode==='unexpected-success')f.job.pollProducer=async()=>({exitCode:0,outcomeState:'COMMITTED_EXACT'});
 if(mode==='post-rejection-request'){
  f.h.pendingMetadata=async()=>[{kind:'PUBLISH',requestId:'extra'}];f.job.pollProducer=async()=>({exitCode:null});
 }
 const result=await sequence(f);assert.equal(result.following,0,mode);assert.equal(result.hooks,0,mode);assert.notEqual(result.results[0].reason,'READ_CONTEXT_REVIEW_REJECTED',mode);
 if(['pending-read-failed','pending-publish','unexpected-success'].includes(mode))assert.equal(result.results[0].reason,'READ_CONTEXT_REJECTION_NOT_ISOLATED');
 else assert.equal(result.results[0].producerStateUnconfirmed,true);
}
let now=0;const timed=await new A('Date',relaySource)({now:()=>now,parse:Date.parse});const live=await fixture();live.job.deadline=100;live.job.pollProducer=async()=>{now=101;return {exitCode:null};};
const unfinished=await sequence(live,timed.runOriginalSerial);assert.equal(unfinished.results[0].reason,'SOURCE_DEADLINE');assert.equal(unfinished.following,0);assert.equal(unfinished.hooks,0);
console.log('PASS: only confirmed non-success producer terminal plus empty read-only pending list isolates source; Novo hook skipped; all uncertain boundaries stop');

// A later rejected read cannot turn a prior ambiguous write into a safe skip.
const requests=['READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','READ_CONTEXT'].map((kind,n)=>({kind,requestId:'q'+n,requestSha256:'h'+n,expiresAt:new Date(Date.now()+60000).toISOString(),payload:{purpose:'PRE_CAPTURE',dispatchBefore:new Date(Date.now()+50000).toISOString(),sql:'SQL'}}));
let writes=0,following=0;
const h={cfg:{project:PROJECT,sourceId:SOURCE},next:async()=>requests.shift(),sqlDispatch:async()=>{writes++;return {status:'FAILED',outcome:'UNKNOWN'};}};
const job={sourceId:SOURCE,relayDirectory:'/relay',deadline:Date.now()+60000,stage:{h,handle:async r=>r.requestId==='q3'?{status:'READ_CONTEXT_REVIEW_REJECTED',requestId:r.requestId,requestSha256:r.requestSha256}:{status:r.kind==='PUBLISH'?'AWAITING_PARENT_REVIEW':'SUCCEEDED'}},reviewPublication:async r=>r,pollProducer:async()=>({exitCode:null})};
const ambiguous=await runOriginalSerial([SOURCE,'next'],async source=>{if(source===SOURCE)return job;following++;return {skip:'unsafe'};});
assert.equal(ambiguous[0].reason,'UNKNOWN_PUBLICATION');assert.equal(ambiguous[0].requestId,'q2');assert.equal(writes,1);assert.equal(following,0);
console.log('PASS: prior PUBLISH uncertainty remains UNKNOWN with one write dispatch and no next source');

const commands=[];const readOnly=await new A('load','tools',helperSource)(()=>cfg,{exec_command:async args=>{commands.push(args.cmd);return {exit_code:0,output:'[]'};}});
assert.deepEqual(await readOnly.pendingMetadata('/relay'),[]);assert.equal(commands.length,1);assert(commands[0].includes(' next-meta '));assert(!commands[0].includes('expire-undispatched'));assert(!commands[0].includes('mark-dispatch'));
console.log('PASS: terminal pending proof uses existing read-only next-meta, never expiry settlement or queue mutation');

// Exercise the actual helper's expiry behavior in memory: it must not run after rejection.
let settled=false;const expiryCommands=[];
const expiryHelper=await new A('load','tools',helperSource)(()=>cfg,{exec_command:async args=>{
 expiryCommands.push(args.cmd);
 if(args.cmd.includes(' next-meta '))return {exit_code:0,output:JSON.stringify(settled?[]:[{requestId:'extra',requestSha256:'hash',kind:'PUBLISH',expired:true,dispatchRecorded:false}])};
 if(args.cmd.includes(' expire-undispatched ')){settled=true;return {exit_code:0,output:JSON.stringify({settled:true})};}
 throw Error('unexpected command');
}});
assert.equal(await expiryHelper.next('/relay'),undefined);assert(settled,'fixture must reproduce original mutating next behavior');
settled=false;expiryCommands.length=0;const extraExpired=await fixture();let initial=true;
extraExpired.h.next=async()=>{if(initial){initial=false;return extraExpired.r;}return expiryHelper.next('/relay');};
extraExpired.h.pendingMetadata=expiryHelper.pendingMetadata;extraExpired.job.pollProducer=async()=>({exitCode:null});
const guarded=await sequence(extraExpired);assert.equal(guarded.following,0);assert.equal(guarded.hooks,0);assert.equal(guarded.results[0].producerStateUnconfirmed,true);assert.equal(settled,false);assert(expiryCommands.every(cmd=>cmd.includes(' next-meta ')));
console.log('PASS: extra expired undispatched PUBLISH is detected read-only, not auto-settled or hidden by original next()');
