import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareFixture,holderTools,writer,loader} from './lifecycle-bridge.test.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url)),HOST=path.dirname(HERE),EVIDENCE=path.resolve(HOST,'../../../evidence/lifecycle'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const ENTRY="tools.syntheticEval();return {async runLiveRound(){return {status:'HOLD'};}};";
function prepare(f){const p=spawnSync('/usr/bin/python3',['-I',path.join(HERE,'prepare-activation-lifecycle-fixture.py'),path.join(f.stable,'fixture.json')],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);}
function api(a,tools){return new Function('tools',fs.readFileSync(a.wrapper,'utf8'))(tools);}
function rows(a){return {structuredContent:{result:'\n<untrusted-data-synthetic>\n'+JSON.stringify([{candidate:a.binding.deployment.expectedRow,checkedAt:new Date().toISOString()}])+'\n</untrusted-data-synthetic>'}};}
const reports=[];
async function test(name,fn){const f=prepareFixture(ENTRY),a=prepare(f),owners=[];try{await fn(f,a,o=>{owners.push(o);return o;});reports.push({name,passed:true});}finally{for(const o of owners)await o.stop();fs.rmSync(f.case,{recursive:true,force:true});}}
await test('EX-activation-spans-original-registration-Promise',async(f,a,own)=>{
 let resolve,calls=0;const pending=new Promise(r=>resolve=r),owner=own(holderTools(f,{mcp__codex_apps__supabase_execute_sql(){calls++;return pending;}}));
 const running=api(a,owner.tools).activateFixedDeployment();while(calls===0)await wait(2);
 assert.equal(writer(f).reason,'LIFECYCLE_BUSY');assert.ok(fs.existsSync(f.mutation));
 let evals=0;const reader=own(holderTools(f,{syntheticEval(){evals++;}}));await assert.rejects(loader(f,reader.tools).runPinnedRound(),/LIFECYCLE_/);assert.equal(evals,0);
 resolve(rows(a));const result=await running;assert.equal(result.lifecycleExclusiveTransaction,true);assert.equal(result.originalPromiseRetained,true);assert.equal(writer(f).status,'IDLE');assert.equal(fs.existsSync(f.mutation),false);
});
await test('put-success-then-holder-SIGKILL-keeps-mutation-and-blocks-new-SH-EX',async(f,a,own)=>{
 let killed=false;const owner=own(holderTools(f,{mcp__codex_apps__supabase_execute_sql(){return Promise.resolve(rows(a));}},{async afterRead(s,arg,r){if(!killed&&r.output.includes('FIXED_DEPLOYMENT_ACTIVATED')){killed=true;s.child.kill('SIGKILL');await wait(25);}}}));
 await assert.rejects(api(a,owner.tools).activateFixedDeployment(),/EXCLUSIVE_/);assert.equal(killed,true);assert.ok(fs.existsSync(f.entry));assert.ok(fs.existsSync(f.mutation));assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_MUTATION');
 let evals=0,sql=0;const reader=own(holderTools(f,{syntheticEval(){evals++;},mcp__codex_apps__supabase_execute_sql(){sql++;return Promise.resolve();}}));
 await assert.rejects(loader(f,reader.tools).runPinnedRound(),/LIFECYCLE_/);assert.equal(evals,0);assert.equal(sql,0);assert.equal(fs.existsSync(f.active),false);
});
await test('registration-rejection-preserves-unknown-mutation',async(f,a,own)=>{
 const owner=own(holderTools(f,{mcp__codex_apps__supabase_execute_sql(){return Promise.reject(Error('SYNTHETIC_DB_FAILURE'));}}));await assert.rejects(api(a,owner.tools).activateFixedDeployment(),/SYNTHETIC_DB_FAILURE/);await wait(20);assert.equal(writer(f).reason,'ACTIVE_OR_UNKNOWN_MUTATION');
});
await test('ordinary-input-cannot-authorize-activation-finish',async(f,a,own)=>{
 const owner=own(holderTools(f,{}));await assert.rejects(api(a,owner.tools).activateFixedDeployment({finished:true}),/ACTIVATION_NO_ARGUMENTS/);assert.equal(owner.holder,null);assert.equal(writer(f).status,'IDLE');
});
const defaultApi=new Function('tools',fs.readFileSync(path.join(HOST,'functions-activate.js'),'utf8'))({});assert.equal((await defaultApi.activateFixedDeployment()).status,'DISABLED');reports.push({name:'default-null-disabled-no-tools',passed:true});
const result={kind:'REAL_EX_HOLDER_SYNTHETIC_ACTIVATION_PROTOCOL',passed:true,cases:reports.length,tests:reports,helper:'synthetic, not original qualification helper',database:'synthetic Promise, zero real DB calls',productionActivated:false};fs.writeFileSync(path.join(EVIDENCE,'lifecycle-activation-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
