import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const HOST=path.dirname(HERE),EVIDENCE=path.resolve(HOST,'../../../evidence/lifecycle'),wait=ms=>new Promise(r=>setTimeout(r,ms));

export function prepareFixture(entry){
 const p=spawnSync('/usr/bin/python3',['-I',path.join(HERE,'prepare-lifecycle-fixture.py')],{input:entry,encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
 assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
}
export function writer(fixture){
 const p=spawnSync('/usr/bin/python3',['-I',path.join(HERE,'probe-lifecycle-writer.py'),path.join(fixture.stable,'fixture.json')],{encoding:'utf8',env:{PATH:'/usr/bin:/bin'}});
 assert.ok([0,78].includes(p.status),p.stderr);return JSON.parse(p.stdout);
}
export function holderTools(fixture,fake={},hooks={}){
 let next=4000,holder=null;const sessions=new Map();
 async function collect(s){
  for(let n=0;n<100&&s.output.indexOf('\n')<0&&s.code===undefined;n++)await wait(2);
  const output=s.output;s.output='';
  return {session_id:s.id,output,...s.code===undefined?{}:{exit_code:s.code}};
 }
 const tools={...fake,
  async exec_command(args){
   if(args.workdir!==fixture.stable)return fake.exec_command(args);
   const child=spawn('/bin/bash',['-c',args.cmd],{cwd:args.workdir,env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
   const s={id:++next,child,output:'',stderr:'',code:undefined};holder=s;sessions.set(s.id,s);
   child.stdout.on('data',b=>{s.output+=b.toString();});child.stderr.on('data',b=>{s.stderr+=b.toString();});
   child.on('close',(code,signal)=>{s.code=code??(signal==='SIGKILL'?137:128);});
   child.stdin.on('error',()=>{});
   const result=await collect(s);if(hooks.started)await hooks.started(s,result);return result;
  },
  async write_stdin(args){
   const s=sessions.get(args.session_id);if(!s)return fake.write_stdin(args);
   if(hooks.beforeWrite)await hooks.beforeWrite(s,args);
   if(args.chars&&s.code===undefined)s.child.stdin.write(args.chars);
   const result=await collect(s);if(hooks.afterRead)await hooks.afterRead(s,args,result);return result;
  }
 };
 return {tools,get holder(){return holder;},async stop(){for(const s of sessions.values()){if(s.code===undefined)s.child.kill('SIGKILL');}await wait(20);},sessions};
}
export function loader(fixture,tools,notify=()=>{}){
 return new Function('tools','notify',fs.readFileSync(fixture.loader,'utf8'))(tools,notify);
}
const SUCCESS={status:'LIVE_ROUND_VERIFIED',pipe:{held:false,integrityHeld:false,pendingFrame:null,childEnded:true,toolEnded:true,childExit:0,childSignal:null,toolExit:0,outcomeConsumed:true},terminalObservedAt:1,errors:[],publicationCallCount:1,sameOriginalPromise:true,databaseStatus:'LIVE_VERIFIED',observer:{status:'LIVE_VERIFIED'},ui:{status:'PASS_LIST_AND_SOURCE_TIME_ONLY'}};
const smallEntry=(body='')=>`return Object.freeze({async runLiveRound(){lifecycleScope.assertOriginal();${body};return ${JSON.stringify(SUCCESS)};}});`;

async function runTests(){
 const reports=[];
 async function test(name,entry,fn){const fixture=prepareFixture(entry);let owner;
  try{await fn(fixture,x=>{owner=x;return x;});reports.push({name,passed:true});}
  finally{if(owner)await owner.stop();fs.rmSync(fixture.case,{recursive:true,force:true});}
 }
 await test('real-holder-blocks-EX-until-original-promise-settles',smallEntry("const original=tools.mcp__codex_apps__supabase_execute_sql({synthetic:true});await tools.exec_command({cmd:'SYNTHETIC_WRAPPER_TERMINAL'});await original"),async(f,own)=>{
  let resolve,terminal=false;const promise=new Promise(r=>{resolve=r;});
  const owner=own(holderTools(f,{mcp__codex_apps__supabase_execute_sql(){return promise;},async exec_command(){terminal=true;return {exit_code:0,output:''};}}));
  const running=loader(f,owner.tools).runPinnedRound();while(!terminal)await wait(2);
  assert.equal(writer(f).reason,'LIFECYCLE_BUSY');assert.ok(fs.existsSync(f.active));
  await wait(30);assert.equal(writer(f).reason,'LIFECYCLE_BUSY');resolve({synthetic:true});
  const result=await running;assert.equal(result.lifecycle.state,'ORIGINAL_ROUND_FINISHED');assert.equal(writer(f).status,'IDLE');assert.equal(fs.existsSync(f.active),false);
 });
 await test('holder-SIGKILL-after-terminal-keeps-ACTIVE-after-late-success',smallEntry("const original=tools.mcp__codex_apps__supabase_execute_sql({synthetic:true});await tools.exec_command({cmd:'SYNTHETIC_WRAPPER_TERMINAL'});await original"),async(f,own)=>{
  let resolve,terminal=false;const promise=new Promise(r=>{resolve=r;});
  const owner=own(holderTools(f,{mcp__codex_apps__supabase_execute_sql(){return promise;},async exec_command(){terminal=true;return {exit_code:0,output:''};}}));
  const running=loader(f,owner.tools).runPinnedRound();const rejection=assert.rejects(running,/LIFECYCLE_/);while(!terminal)await wait(2);
  owner.holder.child.kill('SIGKILL');await wait(30);assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');
  resolve({synthetic:true});await rejection;assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');assert.ok(fs.existsSync(f.active));
 });
 await test('holder-loss-during-load-prevents-eval',smallEntry("await tools.mcp__codex_apps__supabase_execute_sql({synthetic:true})"),async(f,own)=>{
  let calls=0,killed=false;const owner=own(holderTools(f,{mcp__codex_apps__supabase_execute_sql(){calls++;return Promise.resolve();}}, {async beforeWrite(s,a){if(!killed&&a.chars.includes('"read"')){killed=true;s.child.kill('SIGKILL');await wait(20);}}}));
  await assert.rejects(loader(f,owner.tools).runPinnedRound(),/LIFECYCLE_/);assert.equal(calls,0);assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');
 });
 await test('wrong-holder-session-rejected-before-eval',smallEntry(),async(f,own)=>{
  const owner=own(holderTools(f,{}, {afterRead(s,a,r){if(a.chars.includes('"read"'))r.session_id++;}}));
  await assert.rejects(loader(f,owner.tools).runPinnedRound(),/LIFECYCLE_FOREIGN_SESSION/);assert.ok(fs.existsSync(f.active));
 });
 await test('HOLD-result-preserves-ACTIVE',smallEntry("return {status:'HOLD'}"),async(f,own)=>{
  const owner=own(holderTools(f));const result=await loader(f,owner.tools).runPinnedRound();assert.equal(result.status,'HOLD');await wait(20);assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');
 });
 await test('throw-preserves-ACTIVE',smallEntry("throw Error('SYNTHETIC_FAILURE')"),async(f,own)=>{
  const owner=own(holderTools(f));await assert.rejects(loader(f,owner.tools).runPinnedRound(),/SYNTHETIC_FAILURE/);await wait(20);assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');
 });
 await test('ordinary-result-cannot-clear-without-real-terminal',smallEntry("return {status:'LIVE_ROUND_VERIFIED',terminal:true}"),async(f,own)=>{
  const owner=own(holderTools(f));const result=await loader(f,owner.tools).runPinnedRound();assert.equal(result.lifecycle,undefined);await wait(20);assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_ROUND');
 });
 await test('enabled-entry-pin-change-fails-before-tools',smallEntry(),async(f,own)=>{
  fs.chmodSync(f.entry,0o600);fs.appendFileSync(f.entry,' ');let calls=0;
  const owner=own(holderTools(f,{mcp__codex_apps__supabase_execute_sql(){calls++;return Promise.resolve();}}));
  await assert.rejects(loader(f,owner.tools).runPinnedRound(),/LIFECYCLE_/);assert.equal(calls,0);assert.ok(fs.existsSync(f.active));
 });
 const defaultApi=new Function('tools',fs.readFileSync(path.join(HOST,'functions-loader.js'),'utf8'))({});
 assert.equal((await defaultApi.runPinnedRound()).status,'DISABLED');await assert.rejects(defaultApi.runPinnedRound({terminal:true}),/LIFECYCLE_NO_ARGUMENTS/);
 reports.push({name:'default-disabled-no-tools-and-no-argument-authority',passed:true});
 const result={kind:'REAL_PYTHON_HOLDER_SYNTHETIC_FUNCTIONS_BRIDGE',passed:true,cases:reports.length,tests:reports,realDatabaseCalls:0,networkCalls:0,productionActivated:false,smallEntryFixtures:true};
 fs.writeFileSync(path.join(EVIDENCE,'lifecycle-bridge-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]===fileURLToPath(import.meta.url))await runTests();
