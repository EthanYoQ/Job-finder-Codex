// Exercise actual loader read/parse/hash logic with only a temporary synthetic host.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
const F=process.argv[2];if(!F)throw Error('FROZEN_SAFE_ROOT_REQUIRED');
const sha=x=>createHash('sha256').update(x).digest('hex'),results=[];
for(const key of ['pfizer']){
 const host=join(F,'hosts',key,'host'),code=readFileSync(join(host,'runtime/load-source-runtime.js'),'utf8');
 const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
 const temp=mkdtempSync(join(tmpdir(),'synthetic-due-loader-')),h=join(temp,'host'),rt=join(h,'runtime'),supervision=join(temp,'supervision');
 mkdirSync(rt,{recursive:true});mkdirSync(supervision);
 const loader=readFileSync(join(host,'runtime/load-host-state.unbound.template.js'));
 const starter=readFileSync(join(F,'hosts',key,`supervision/start-monitor-${key}51-combined.unbound.template.js`));
 writeFileSync(join(rt,'load-host-state.js'),loader);writeFileSync(join(rt,'continuous-relay-v3-durable-monitor.js'),'');writeFileSync(join(rt,'complete-reviewed-source-readback.js'),'');writeFileSync(join(supervision,`start-monitor-${key}51-combined.js`),starter);
 for(const kind of ['loader-mismatch','starter-mismatch','correct-pins-still-unbound']){
  const binding={status:'REGISTERED_VERIFIED',candidate:{id:'dot-cloud-delta-proxy-28402a29-20261007',goalId:'jobfinder-portable-required-40',version:51},build:{commitSha:'28402a299bb04cbf5873da66c2fe8ca76827c0d1'},loaderSha256:kind==='loader-mismatch'?'0'.repeat(64):sha(loader),starterSha256:kind==='starter-mismatch'?'0'.repeat(64):sha(starter)};
  writeFileSync(join(h,'activation.json'),JSON.stringify(binding));let calls=0;
  const context=vm.createContext({tools:{exec_command:async args=>{calls++;assert.equal(calls,1);const p=spawnSync('/bin/bash',['-c',args.cmd.replace(cfg.root+'/runtime',rt)],{encoding:'utf8'});return {exit_code:p.status,output:p.stdout+p.stderr};}},load:()=>{throw Error('LOAD_FORBIDDEN');},store:()=>{throw Error('STORE_FORBIDDEN');},text:()=>{},notify:()=>{}});
  await assert.rejects(vm.compileFunction('return(async()=>{'+code+'})()',['sourceKey'],{parsingContext:context})(key),kind==='loader-mismatch'?/HOST_LOADER_PIN_MISMATCH/:kind==='starter-mismatch'?/HOST_STARTER_PIN_MISMATCH/:/HOST_OWNER_BINDING_REQUIRED/);
  assert.equal(calls,1);results.push({key,kind,passed:true});
 }
}
console.log(JSON.stringify({classification:'PURE_SYNTHETIC_OFFLINE',passed:results.length,results,network:false,sql:false}));
