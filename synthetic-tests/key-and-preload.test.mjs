import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import vm from 'node:vm';
const O=resolve(dirname(new URL(import.meta.url).pathname),'..');
const manifest=JSON.parse(readFileSync(join(O,'baseline-manifest.json'),'utf8'));
const preload=readFileSync(join(O,'preload-owner.exec.js'),'utf8');
const entry=readFileSync(join(O,'publish-reviewed-and-monitor.exec.js'),'utf8');
const factory=readFileSync(join(O,'publish-and-monitor-owner.js'),'utf8');
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixture(key,change){
 const ns='proxyNode22:'+key+':',root=manifest.runtimeRoot+'/hosts/'+key+'/host',state=new Map();
 for(const [name,rel]of [['cloudPilotHostHelpers','host-helper-functions.js'],['cloudPilotHostStages','host-stage-functions.js'],['continuousPortableRelayCodeWithPoll','runtime/continuous-relay-v3-durable-monitor.js']])state.set(ns+name,readFileSync(join(root,rel),'utf8'));
 state.set(ns+'cloudPilotHostConfig',{root});if(change)change(state,ns);
 let calls=0;const context=vm.createContext({load:k=>state.get(k),store:(k,v)=>state.set(k,v),text:()=>{},notify:()=>{},tools:{exec_command:async args=>{calls++;assert(args.cmd.startsWith('python3 - ')&&args.cmd.includes('PY_OWNER_LOAD'));const p=spawnSync('/bin/bash',['-c',args.cmd],{encoding:'utf8',env:process.env,maxBuffer:2e6});return {exit_code:p.status,output:p.stdout+p.stderr};}}});
 return {state,ns,context,run:()=>vm.compileFunction('return (async()=>{'+preload+'})()',['sourceKey'],{parsingContext:context})(key),get calls(){return calls;}};
}
for(const key of ['hansoh','fosun']){
 test(key+' actual preload resolves exact five-file mapping and stores only its namespace',async()=>{const f=fixture(key);await f.run();assert.equal(f.calls,1);const p=f.state.get(f.ns+'publishMonitorPrepared');assert.equal(p.ownerCode,factory);assert.equal(p.ownerSha256,sha(factory));assert([...f.state.keys()].every(k=>k.startsWith(f.ns)));});
 for(const name of ['cloudPilotHostHelpers','cloudPilotHostStages','continuousPortableRelayCodeWithPoll','cloudPilotHostConfig'])test(key+' rejects changed stored '+name,async()=>{const f=fixture(key,(s,ns)=>s.set(ns+name,name==='cloudPilotHostConfig'?{root:'/wrong'}:'changed'));await assert.rejects(f.run(),/OWNER_PRELOAD_STORED_CODE_MISMATCH/);assert.equal(f.state.has(f.ns+'publishMonitorPrepared'),false);});
}
for(const key of ['../astellas','astellas/','astellas..','astellas-takeda','Ast ellas',' astellas','takeda ','TAKEDA','','a'.repeat(65),null,42]){
 test('three entry validators reject '+JSON.stringify(key)+' before tool dispatch',async()=>{let calls=0;const context=vm.createContext({tools:new Proxy({},{get(){calls++;throw Error('NO_TOOL_ALLOWED');}}),load:()=>{calls++;throw Error('NO_LOAD_ALLOWED');},store:()=>{calls++;throw Error('NO_STORE_ALLOWED');}});
 await assert.rejects(vm.compileFunction('return (async()=>{'+preload+'})()',['sourceKey'],{parsingContext:context})(key),/OWNER_SOURCE_KEY/);
 await assert.rejects(vm.compileFunction('return (async()=>{'+entry+'})()',['sourceKey','ownerMode'],{parsingContext:context})(key,'publish'),/OWNER_ENTRY_ARGUMENT/);
 const owner=await vm.compileFunction('return (async()=>{'+factory+'})()',['env'],{parsingContext:context})({tools:{},load:()=>{},store:()=>{},notify:()=>{},text:()=>{},setTimeout:()=>{throw Error('NO_TIMER_ALLOWED');}});await assert.rejects(owner({sourceKey:key}),/OWNER_ARGUMENT/);assert.equal(calls,0);
 });
}
test('minimal closure has exactly ten fixed mappings for two C51 hosts',()=>{assert.equal(Object.keys(manifest.files).length,10);for(const [p,v]of Object.entries(manifest.files)){assert(/\/hosts\/(hansoh|fosun)\/host\//.test(p));assert.equal(sha(readFileSync(p)),v.sha256);}});
