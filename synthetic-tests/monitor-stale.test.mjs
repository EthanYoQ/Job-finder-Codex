import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import vm from 'node:vm';
const base=resolve(dirname(new URL(import.meta.url).pathname),'../../..');
const code=readFileSync(base+'/hosts/hansoh/host/runtime/continuous-relay-v3-durable-monitor.js','utf8');
const seam='const A=Object.getPrototypeOf(async function(){}).constructor;\nconst s=await new A(load("proxyNode22:hansoh:cloudPilotHostStages"))();';
assert.equal(code.split(seam).length,2);
const serial=x=>JSON.parse(JSON.stringify(x));
const ns='proxyNode22:hansoh:',run='/synthetic-only/monitor-run',session=76543;
function fixture(options={}){
 const start=Date.parse('2026-10-07T12:00:00Z');let now=start,id=0,polls=0,nexts=0,output;
 const timers=[],events=[],notices=[],files=new Map(),state=new Map([[ns+'refreshCurrentRun',run],[ns+'refreshSession',session],[ns+'durableMonitorInvocationMode','start']]);
 files.set(run+'/diagnostics/process.jsonl',JSON.stringify({schemaVersion:1,event:'WRAPPER_START',timeoutMs:1800000,recordedAt:new Date(start).toISOString(),outerDeadline:start+1800000})+'\n');
 class Clock extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
 const schedule=(fn,ms=0)=>{timers.push({fn,at:now+ms,id:++id});};
 const flush=()=>new Promise(r=>setImmediate(r));
 async function tick(){await flush();if(!timers.length)return false;timers.sort((a,b)=>a.at-b.at||a.id-b.id);const t=timers.shift();now=t.at;t.fn();await flush();return true;}
 async function finish(p){let done=false,value,error;p.then(v=>{done=true;value=v;},e=>{done=true;error=e;});for(let i=0;i<10000&&!done;i++){await flush();if(!done&&!await tick())throw Error('SYNTHETIC_NO_PROGRESS');}if(!done)throw Error('SYNTHETIC_BUDGET');if(error)throw error;return value;}
 const defaultStatus={process:{event:'CHILD_STARTED',recordedAt:new Date(start-120000).toISOString()},observer:{status:'RUNNING'},lastSample:{recordedAt:new Date(start-120000).toISOString(),status:'RUNNING'},http:{},lastAt:new Date(start-120000).toISOString()};
 const f={events,notices,files,state,start,session,run,Clock,schedule,tick,flush,finish,get now(){return now;},get polls(){return polls;},get nexts(){return nexts;},get output(){return output;},setNow:v=>{now=v;}};
 const stages={h:{
  q:x=>x,
  next:async dir=>{assert.equal(dir,run+'/relay');nexts++;events.push({event:'NEXT',at:now});return options.next?.(f);},
  cmd:async()=>{if(options.statusError)throw Error('SYNTHETIC_STATUS_READ_FAILURE');return JSON.stringify(options.status?.(f)??defaultStatus);},
  save:async(path,value)=>{events.push({event:'SAVE',path,at:now});if(options.saveFailure)throw Error('SYNTHETIC_SAVE_FAILURE');assert.equal(files.has(path),false);files.set(path,JSON.stringify(value)+'\n');},
  readFile:async path=>{events.push({event:'READBACK',path,at:now});if(options.readFailure&&path.includes('/monitor-exec-evidence/'))throw Error('SYNTHETIC_READ_FAILURE');if(!files.has(path))throw Error('ENOENT');return {text:files.get(path)+(path.includes('/monitor-exec-evidence/')?(options.readSuffix??''):'')};}
 },handle:async(req,dir)=>{events.push({event:'HANDLE',kind:req.kind,at:now});return options.handle?.(req,dir,f)??{status:'SUCCEEDED'};}};
 const context=vm.createContext({stages,Date:Clock,setTimeout:schedule,load:k=>state.get(k),store:(k,v)=>{state.set(k,serial(v));events.push({event:'STORE',key:k,value:serial(v),at:now});},notify:v=>{notices.push(serial(v));events.push({event:'NOTIFY',value:serial(v),at:now});return options.notify?.(v,f);},text:v=>{output=serial(v);events.push({event:'TEXT',value:output,at:now});},tools:{write_stdin:async args=>{
  assert.equal(args.session_id,session);assert.equal(args.chars,'');assert.ok(args.yield_time_ms>0&&args.yield_time_ms<=1000);polls++;events.push({event:'POLL',at:now,args});
  return options.poll?options.poll(f):{session_id:session,output:'live raw',chunk_id:'live-'+polls,wall_time_seconds:0};
 }}});
 f.runMonitor=()=>vm.runInContext('(async()=>{'+code.replace(seam,'const s=stages;')+'})()',context);
 return f;
}
const terminal=exit_code=>({exit_code,chunk_id:'actual-synthetic-terminal',output:'full raw output\n'+'x'.repeat(20000),wall_time_seconds:0.01,original_token_count:20002});
const terminalStatus=exit=>({process:{event:'CHILD_EXIT',wrapperExitCode:exit},http:{},supervisor:null,observer:null});
const evidence=f=>[...f.files].filter(([p])=>p.includes('/monitor-exec-evidence/')).map(([p,v])=>({path:p,value:JSON.parse(v)}));

test('no CHILD_EXIT still polls same live session periodically; every complete raw precedes classification',async()=>{
 const f=fixture({poll:f=>f.polls<3?{session_id:f.session,output:'live-'+f.polls}:{...terminal(1)}});await f.finish(f.runMonitor());
 assert.equal(f.polls,3);assert.equal(f.output.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.output.originalExec.exitCode,1);assert.equal(f.output.classification,'DURABLE_WRAPPER_TERMINAL_MISSING');
 const saved=evidence(f);assert.equal(saved.length,3);assert.deepEqual(saved[2].value.raw,terminal(1));
 const calls=f.events.filter(x=>x.event==='POLL');assert.ok(calls[1].at-calls[0].at>=20000&&calls[1].at-calls[0].at<=22000);
 for(const savedPoll of saved){const read=f.events.findIndex(x=>x.event==='READBACK'&&x.path===savedPoll.path);const classified=f.events.findIndex(x=>x.event==='STORE'&&x.key===ns+'lastPortableExecPoll'&&x.value.evidencePath===savedPoll.path);assert.ok(read>=0&&classified>read);}
 assert.equal(f.state.get(ns+'durableMonitorLease:'+run).active,false);
});

test('real nonzero terminal is preserved and never becomes zero',async()=>{const f=fixture({poll:()=>terminal(17),status:()=>terminalStatus(17)});await f.finish(f.runMonitor());assert.equal(f.output.status,'PROCESS_TERMINATED');assert.equal(f.output.originalExec.exitCode,17);assert.deepEqual(evidence(f)[0].value.raw,terminal(17));});
for(const kind of ['missing','mismatch'])test('zero tool terminal with '+kind+' wrapper remains UNKNOWN',async()=>{const f=fixture({poll:()=>terminal(0),...kind==='mismatch'?{status:()=>terminalStatus(1)}:{}});await f.finish(f.runMonitor());assert.equal(f.output.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.output.successfulCompletionEligible,false);assert.equal(f.polls,1);assert.equal(f.output.originalExec.exitCode,0);});
for(const [name,poll]of [
 ['throw',()=>{const e=Error('SYNTHETIC_REJECT');e.code='REVIEW_DENIED';e.cause=Error('inner');throw e;}],
 ['unknown',()=>({status:'UNKNOWN',reason:'No such original session'})],
 ['reject',()=>({isError:true,content:[{type:'text',text:'Synthetic action rejected'}]})],
 ['cancel',()=>({status:'CANCELLED',exit_code:0})],
 ['malformed',()=>({session_id:session,exit_code:0,output:'not terminal'})]
])test(name+' tool result is persisted, UNKNOWN, and never automatically retried',async()=>{const f=fixture({poll});await f.finish(f.runMonitor());assert.equal(f.output.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.output.retryAuthorized,false);assert.equal(f.polls,1);assert.equal(evidence(f).length,1);const raw=evidence(f)[0].value;if(name==='throw'){assert.equal(raw.error.detail.code,'REVIEW_DENIED');assert.equal(raw.error.detail.cause.message,'inner');assert.match(raw.error.detail.stack,/SYNTHETIC_REJECT/);}else assert.deepEqual(raw.raw,poll());});
for(const options of [{saveFailure:true},{readFailure:true},{readSuffix:'\nTAMPER'}])test('evidence I/O '+JSON.stringify(options)+' blocks all result classification and further polling',async()=>{
 const f=fixture({...options,poll:()=>terminal(0),status:()=>terminalStatus(0)});await f.finish(f.runMonitor());assert.equal(f.polls,1);assert.equal(f.output.status,'ORIGINAL_EXEC_UNKNOWN');assert.equal(f.output.classification,'ORIGINAL_EXEC_EVIDENCE_UNSAVED_NO_RETRY');assert.equal(f.state.get(ns+'lastPortableExecPollRaw').evidenceVerified,undefined);assert.equal(f.events.some(x=>x.event==='STORE'&&x.value?.classification==='ORIGINAL_EXEC_RUNNING'),false);
});

test('old CHILD_STARTED and RUNNING sample carry recordedAt/age/STALE and never claim current capture',async()=>{
 const f=fixture({poll:f=>f.polls===1?{session_id:session,output:'live'}:terminal(1)});await f.finish(f.runMonitor());const n=f.notices.find(x=>x.status==='MONITOR_OBSERVATION');assert.equal(n.levels.wrapper.state,'UNKNOWN');assert.equal(n.levels.wrapper.freshness.state,'STALE');assert.equal(n.levels.observer.freshness.state,'STALE');assert.equal(n.levels.observer.freshness.recordedAt,new Date(f.start-120000).toISOString());assert.equal(n.levels.observer.freshness.ageMs,120000);assert.equal(n.originalExec.state,'RUNNING_AT_LAST_POLL');assert.equal(f.notices.some(x=>x.status==='CAPTURE_OR_CONTROL_RUNNING'),false);
});

test('missing samples and sample timestamps are explicit',async()=>{for(const sample of [null,{status:'RUNNING'}]){const f=fixture({status:()=>({process:{event:'CHILD_STARTED'},lastSample:sample}),poll:f=>f.polls===1?{session_id:session}:terminal(1)});await f.finish(f.runMonitor());const n=f.notices.find(x=>x.status==='MONITOR_OBSERVATION');assert.equal(n.levels.observer.freshness.state,sample?'TIMESTAMP_MISSING':'MISSING');}});

test('durable status read failure does not block original-session observation',async()=>{const f=fixture({statusError:true,poll:()=>terminal(1)});await f.finish(f.runMonitor());assert.equal(f.polls,1);assert.equal(f.output.status,'ORIGINAL_EXEC_UNKNOWN');assert.match(f.output.levels.durableReadError.message,/SYNTHETIC_STATUS_READ_FAILURE/);assert.equal(evidence(f).length,1);});

test('one loop services READ_OUTCOME while wrapper already exited and original tool is live; delayed messages do not detach await',async()=>{
 let served=false,messageFinished=false,finished=false;
 const f=fixture({status:()=>terminalStatus(0),poll:f=>f.polls<3?{session_id:session}:terminal(0),next:f=>!served&&f.now>=f.start+10000?{kind:'READ_OUTCOME',requestId:'synthetic-read',expiresAt:new Date(f.start+40000).toISOString()}:undefined,handle:(r,d,f)=>{assert.ok(f.now<f.start+40000);served=true;return {status:'SUCCEEDED'};},notify:(v,f)=>{if(v.status==='MONITOR_OBSERVATION')return new Promise(resolve=>f.schedule(()=>{messageFinished=true;resolve();},65000));}});
 const task=f.runMonitor().then(()=>{finished=true;});await f.flush();assert.equal(finished,false);await f.finish(task);assert.equal(served,true);assert.equal(f.polls,3);assert.equal(messageFinished,false);assert.equal(f.output.status,'PROCESS_TERMINATED');assert.equal(f.events.filter(x=>x.event==='HANDLE').length,1);
});

test('unchanged absolute 30-minute budget ends UNKNOWN; resume does not reset it or poll again',async()=>{
 const f=fixture();await f.finish(f.runMonitor());assert.equal(f.now,f.start+30*60*1000);assert.equal(f.output.classification,'ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED');const count=f.polls,lease=f.state.get(ns+'durableMonitorLease:'+run);assert.equal(lease.stopAt,f.start+30*60*1000);assert.ok(count>1&&count<100);f.state.set(ns+'durableMonitorInvocationMode','resume');await f.finish(f.runMonitor());assert.equal(f.polls,count);assert.equal(f.state.get(ns+'durableMonitorLease:'+run).stopAt,lease.stopAt);assert.equal(f.events.some(x=>x.event==='POLL'&&x.at>=lease.stopAt),false);
});

test('concurrent monitor is refused before relay or polling',async()=>{
 const f=fixture({poll:f=>f.polls<2?{session_id:session}:terminal(1)});const first=f.runMonitor();await f.flush();const calls=f.polls,nexts=f.nexts;await assert.rejects(f.runMonitor(),/ORIGINAL_EXEC_MONITOR_ALREADY_ACTIVE/);assert.equal(f.polls,calls);assert.equal(f.nexts,nexts);await f.finish(first);
});

test('active publication owner blocks standalone capture monitor before it can compete',async()=>{
 const f=fixture();f.state.set(ns+'cloudPilotPublishRequest',{requestId:'existing'});f.state.set(ns+'publishMonitorOwner:existing',{active:true,identity:{run,originalSessionId:session}});await assert.rejects(f.runMonitor(),/ORIGINAL_EXEC_PUBLICATION_OWNER_ACTIVE/);assert.equal(f.nexts,0);assert.equal(f.polls,0);
});

const setLaunch=(f,record)=>f.files.set(run+'/diagnostics/process.jsonl',JSON.stringify({schemaVersion:1,event:'WRAPPER_START',timeoutMs:1800000,recordedAt:new Date(f.start).toISOString(),outerDeadline:f.start+1800000,...record})+'\n');
const loseStore=f=>{f.state.clear();f.state.set(ns+'refreshCurrentRun',run);f.state.set(ns+'refreshSession',session);f.state.set(ns+'durableMonitorInvocationMode','resume');};
test('lost functions store restores original durable budget and uses distinct evidence paths',async()=>{
 const f=fixture({poll:()=>({status:'UNKNOWN',output:'synthetic original tool unavailable'})});await f.finish(f.runMonitor());
 const old=[...f.files].filter(([p])=>p.includes('/monitor-exec-evidence/'));loseStore(f);f.setNow(f.start+1700000);await f.finish(f.runMonitor());
 assert.equal(f.state.get(ns+'durableMonitorLease:'+run).stopAt,f.start+1800000);assert.equal(evidence(f).length,2);assert.equal(f.files.get(old[0][0]),old[0][1]);assert.notEqual(evidence(f)[0].path,evidence(f)[1].path);
});
test('late resume after store loss has only the original remaining minute',async()=>{
 const f=fixture();loseStore(f);f.setNow(f.start+1740000);await f.finish(f.runMonitor());
 assert.equal(f.now,f.start+1800000);assert.equal(f.output.classification,'ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED');assert.ok(f.polls>0&&f.polls<5);assert.equal(f.output.successfulCompletionEligible,false);
});
test('expired durable launch after store loss allows neither relay nor original-session polling',async()=>{
 const f=fixture();loseStore(f);f.setNow(f.start+1800000);await f.finish(f.runMonitor());assert.equal(f.polls,0);assert.equal(f.nexts,0);assert.equal(f.output.classification,'ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED');
});
for(const [name,mutate] of [
 ['missing',f=>f.files.delete(run+'/diagnostics/process.jsonl')],
 ['malformed',f=>f.files.set(run+'/diagnostics/process.jsonl','{broken\n')],
 ['duplicate',f=>f.files.set(run+'/diagnostics/process.jsonl',f.files.get(run+'/diagnostics/process.jsonl').repeat(2))],
 ['missing deadline',f=>setLaunch(f,{outerDeadline:null})],
 ['extended deadline',f=>setLaunch(f,{outerDeadline:f.start+1800001})],
 ['future launch',f=>setLaunch(f,{recordedAt:new Date(f.start+1).toISOString()})],
 ['wrong run',f=>setLaunch(f,{run:'/synthetic-only/other-run'})],
 ['changed saved budget',f=>f.state.set(ns+'durableMonitorLease:'+run,{active:false,run,originalSessionId:session,loopStarted:f.start,stopAt:f.start+1800001,generation:1})]
])test(name+' budget fails closed before relay or original exec',async()=>{
 const f=fixture();mutate(f);await f.finish(f.runMonitor());assert.equal(f.output.classification,'ORIGINAL_EXEC_BUDGET_UNAVAILABLE_NO_PUBLISH');assert.equal(f.output.successfulCompletionEligible,false);assert.equal(f.nexts,0);assert.equal(f.polls,0);
});
test('missing explicit start/resume mode is rejected before I/O',async()=>{const f=fixture();f.state.delete(ns+'durableMonitorInvocationMode');await assert.rejects(f.runMonitor(),/ORIGINAL_EXEC_MONITOR_MODE_REQUIRED/);assert.equal(f.events.length,0);});
test('one millisecond of original budget is never converted to a new 30 minutes',async()=>{
 const f=fixture();f.setNow(f.start+1799999);await f.finish(f.runMonitor());assert.equal(f.polls,1);assert.equal(f.events.find(x=>x.event==='POLL').args.yield_time_ms,1);assert.equal(f.now,f.start+1800000);
});
test('relay metadata crossing original deadline cannot dispatch its returned request',async()=>{
 const f=fixture({next:f=>{f.setNow(f.start+1800000);return {kind:'READ_OUTCOME'};}});await f.finish(f.runMonitor());assert.equal(f.polls,0);assert.equal(f.events.some(x=>x.event==='HANDLE'),false);assert.equal(f.output.classification,'ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED');
});

test('actual wrapper marker delay cannot replace the pre-spawn deadline anchor',async()=>{
 const f=fixture();f.setNow(f.start+250);setLaunch(f,{recordedAt:new Date(f.start+250).toISOString(),timeoutMs:1800000,outerDeadline:f.start+1800000});await f.finish(f.runMonitor());assert.equal(f.now,f.start+1800000);assert.equal(f.state.get(ns+'durableMonitorLease:'+run).loopStarted,f.start);assert.equal(f.state.get(ns+'durableMonitorLease:'+run).stopAt,f.start+1800000);
});
test('actual wrapper marker can be recorded after its tiny original budget has elapsed',async()=>{
 const f=fixture();f.setNow(f.start+20);setLaunch(f,{recordedAt:new Date(f.start+20).toISOString(),timeoutMs:1,outerDeadline:f.start+1});await f.finish(f.runMonitor());assert.equal(f.output.classification,'ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED');assert.equal(f.polls,0);assert.equal(f.nexts,0);
});
for(const [name,change]of [['oversized timeout',{timeoutMs:1800001}],['string deadline',{outerDeadline:'2026-10-07T12:30:00.000Z'}],['missing timeout',{timeoutMs:null}]])test('actual wrapper schema rejects '+name,async()=>{
 const f=fixture();setLaunch(f,change);await f.finish(f.runMonitor());assert.equal(f.output.classification,'ORIGINAL_EXEC_BUDGET_UNAVAILABLE_NO_PUBLISH');assert.equal(f.polls,0);
});

test('unverified placeholder lease is released so restored original budget can resume',async()=>{
 const f=fixture({poll:()=>terminal(1),status:()=>terminalStatus(1)}),path=run+'/diagnostics/process.jsonl',original=f.files.get(path);
 f.files.delete(path);await f.finish(f.runMonitor());assert.equal(f.polls,0);assert.equal(f.output.classification,'ORIGINAL_EXEC_BUDGET_UNAVAILABLE_NO_PUBLISH');
 f.files.set(path,original);f.setNow(f.start+60000);f.state.set(ns+'durableMonitorInvocationMode','resume');await f.finish(f.runMonitor());
 assert.equal(f.output.status,'PROCESS_TERMINATED');assert.equal(f.polls,1);assert.equal(f.state.get(ns+'durableMonitorLease:'+run).stopAt,f.start+1800000);
});
test('failed later budget read preserves previously verified original deadline',async()=>{
 const f=fixture({poll:()=>({status:'UNKNOWN'})}),path=run+'/diagnostics/process.jsonl',original=f.files.get(path);
 await f.finish(f.runMonitor());const previous=f.state.get(ns+'durableMonitorLease:'+run);f.files.delete(path);f.state.set(ns+'durableMonitorInvocationMode','resume');await f.finish(f.runMonitor());
 assert.equal(f.state.get(ns+'durableMonitorLease:'+run).stopAt,previous.stopAt);f.files.set(path,original);f.setNow(f.start+1800000);const count=f.polls;await f.finish(f.runMonitor());assert.equal(f.polls,count);assert.equal(f.output.classification,'ORIGINAL_EXEC_POLL_BUDGET_EXHAUSTED');
});
