import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {preflight} from './host/runtime/preflight/preflight-launch.mjs';
const base=dirname(fileURLToPath(import.meta.url)),source=readFileSync(join(base,'host/runtime/continuous-relay-v3-durable-monitor.js'),'utf8');
const A=Object.getPrototypeOf(async function(){}).constructor,ns='deadlineCandidate47b:organon:',checks=[];
await assert.rejects(()=>preflight(['launch','never-read','never-read','never-read','a'.repeat(64),'never-created']),/PREFLIGHT_LEGACY_LAUNCH_DISABLED_USE_SUPERVISED_STARTER/);checks.push('legacy-launch-refused-before-files-or-spawn');
async function run(polls,wrapperExitCode=0){
 const stored=new Map(),messages=[],calls=[];let index=0,now=Date.now();
 class Clock extends Date{static now(){return now;}}
 const stages={h:{next:async()=>undefined,q:JSON.stringify,cmd:async()=>JSON.stringify({process:{event:'CHILD_EXIT',wrapperExitCode},supervisor:null,observer:null,http:{}})}};
 globalThis.__terminalFixture=()=>stages;
 const load=k=>k.endsWith('cloudPilotHostStages')?'return __terminalFixture();':k.endsWith('refreshCurrentRun')?'/synthetic/run':k.endsWith('refreshSession')?123:undefined;
 const tools={write_stdin:async input=>{calls.push(input.session_id);now+=1000;const p=polls[index++];if(p instanceof Error)throw p;if(!p)throw Error('UNEXPECTED_EXTRA_POLL');return p;}};
 let error;
 try{await new A('load','store','notify','text','tools','Date',source)(load,(k,v)=>stored.set(k,v),x=>messages.push(x),x=>messages.push(x),tools,Clock);}catch(e){error=e;}
 finally{delete globalThis.__terminalFixture;}
 return {stored,messages,calls,error};
}
const continued=await run([{session_id:123,output:'running'},{exit_code:0,output:'done'}]);
assert.deepEqual(continued.calls,[123,123]);assert.equal(continued.messages.filter(m=>m.status==='PROCESS_TERMINATED').length,1);
assert.equal(continued.messages[0].status,'WRAPPER_EXIT_ORIGINAL_EXEC_STILL_RUNNING');
assert.equal(continued.messages.at(-1).originalExec.state,'TERMINATED');
assert.equal(continued.messages.at(-1).levels.supervisor.state,'UNKNOWN');assert.equal(continued.messages.at(-1).levels.observer.state,'UNKNOWN');
assert.equal(continued.stored.get(ns+'lastPortableExecPoll').originalSessionId,123);checks.push('running-original-session-then-actual-zero-exit');
assert.equal(continued.error,undefined);assert.equal(continued.stored.get(ns+'lastPortableExecPoll').exit_code,0);
for(const [name,polls] of [['denial',[Error('SYNTHETIC_REVIEW_DENIED')]],['unknown-shape',[{}]],['wrong-session',[{session_id:999}]],['running-then-denial',[{session_id:123},Error('SYNTHETIC_REVIEW_DENIED')]]]){
 const result=await run(polls);assert.equal(result.calls.length,polls.length);assert.ok(result.calls.every(id=>id===123));
 assert.equal(result.messages.some(m=>m.status==='PROCESS_TERMINATED'),false);assert.equal(result.messages.at(-1).status,'ORIGINAL_EXEC_UNKNOWN');
 assert.equal(result.stored.get(ns+'lastPortableExecPoll').exit_code,undefined);checks.push(name+'-preserves-unknown-without-restart');
}
const mismatch=await run([{exit_code:0}],17);
assert.match(mismatch.error.message,/DURABLE_EXIT_TOOL_EXIT_MISMATCH/);
assert.equal(mismatch.stored.get(ns+'lastPortableExecPoll').exit_code,undefined);
assert.equal(mismatch.stored.get(ns+'lastPortableExecPollRaw').raw.exit_code,0);
assert.equal(mismatch.messages.some(m=>m.status==='PROCESS_TERMINATED'),false);
{
 const completion=readFileSync(join(base,'host/runtime/complete-reviewed-source-readback.js'),'utf8');
 const sourceId='source-organon-china-social',batch='synthetic-mismatch',candidateId='synthetic-candidate';
 const state=new Map([[ns+'refreshCurrentRun','/synthetic/host/'+batch],[ns+'refreshCurrentBatch',batch],[ns+'refreshSession',123],[ns+'lastPortableExecPoll',mismatch.stored.get(ns+'lastPortableExecPoll')],[ns+'registeredCandidateBinding',{status:'REGISTERED_VERIFIED',candidate:{id:candidateId,version:73}}],[ns+'publicationReview',{sourceResult:{id:batch+'--'+sourceId,sourceId,sourceConfigHash:'f'.repeat(64),releaseCandidateId:candidateId}}]]);
 let dbCalls=0,stateCalls=0,outputs=0;
 const helper={cfg:{root:'/synthetic/host',sourceId,sourceConfigSha256:'f'.repeat(64)},save:async()=>{stateCalls++;},cmd:async()=>{stateCalls++;}};
 globalThis.__mismatchCompletionFixture=()=>helper;
 try{await assert.rejects(()=>new A('load','tools','text',completion)(k=>k.endsWith('cloudPilotHostHelpers')?'return __mismatchCompletionFixture();':state.get(k),{mcp__codex_apps__supabase_execute_sql:async()=>{dbCalls++;throw Error('FORBIDDEN_DB');}},()=>{outputs++;}),/ACTUAL_ORIGINAL_ZERO_EXIT_REQUIRED/);}
 finally{delete globalThis.__mismatchCompletionFixture;}
 assert.equal(dbCalls,0);assert.equal(stateCalls,0);assert.equal(outputs,0);
 checks.push('wrapper-tool-mismatch-cannot-feed-completion');
}
console.log(JSON.stringify({status:'PASS_TERMINAL_AND_LAUNCH_REVISION',checks,realProducerExecuted:false,networkUsed:false,databaseUsed:false}));
