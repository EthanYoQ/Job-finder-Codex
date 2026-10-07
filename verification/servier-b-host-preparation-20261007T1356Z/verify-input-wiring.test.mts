import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import {makeServierFixture,sha} from './servier-b-proof.fixture.mts';
import {verifyIndependentValidationInput} from '../../hosts/servier/host/runtime/verify-independent-validation.mts';
const R=resolve(import.meta.dirname,'../..'),H=join(R,'hosts/servier/host'),cfg=JSON.parse(readFileSync(join(H,'host-config.json'),'utf8'));
const fixture=await makeServierFixture(),bytes=Buffer.from(JSON.stringify(fixture.validation));
test('original independent validation bytes pass current B check without rewriting time',()=>{const before=bytes.toString();const report=verifyIndependentValidationInput(bytes,sha(bytes),fixture.now);assert.equal(report.status,'VALIDATED_CURRENT_RUN');assert.equal(report.observedAt,fixture.validation.observedAt);assert.equal(bytes.toString(),before);});
test('changed bytes fail exact input hash',()=>assert.throws(()=>verifyIndependentValidationInput(Buffer.from('{}'),sha(bytes),fixture.now),/INPUT_HASH/));
test('original DOM observation expires after one hour despite seven-day validation expiry',()=>assert.throws(()=>verifyIndependentValidationInput(bytes,sha(bytes),new Date(Date.parse(fixture.validation.observedAt)+3600001)),/TOO_OLD|EXPIRED/));
test('future native receipts are never accepted as current input',()=>assert.throws(()=>verifyIndependentValidationInput(bytes,sha(bytes),new Date(Date.parse(fixture.validation.observedAt)+1000)),/FUTURE_RECEIPT/));
test('changed source and restamped observation are rejected despite recomputed file hash',()=>{for(const field of ['sourceId','observedAt']){const value=structuredClone(fixture.validation);if(field==='sourceId')value.sourceId='source-gsk-china-social';else value.observedAt=new Date(Date.parse(value.observedAt)+1000).toISOString();const data=Buffer.from(JSON.stringify(value));assert.throws(()=>verifyIndependentValidationInput(data,sha(data),fixture.now));}});
test('actual readonly input CLI checks a fresh synthetic file and hash',async()=>{const f=await makeServierFixture({now:new Date()}),dir=mkdtempSync(join(import.meta.dirname,'synthetic-input-cli-')),path=join(dir,'validation.json'),data=Buffer.from(JSON.stringify(f.validation));writeFileSync(path,data);const p=spawnSync(cfg.node,['--require',join(R,'no-network.cjs'),'--import',join(cfg.repo,'node_modules/tsx/dist/loader.mjs'),join(H,'runtime/verify-independent-validation.mts'),path,sha(data)],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);assert.equal(JSON.parse(p.stdout).independentValidationSha256,sha(data));assert.equal(readFileSync(path).toString(),data.toString());});

const starter=readFileSync(join(H,'../supervision/start-monitor-servier51-combined.unbound.template.js'),'utf8');
const binding={status:'REGISTERED_VERIFIED',build:{commitSha:'28402a299bb04cbf5873da66c2fe8ca76827c0d1'},candidate:{id:'dot-cloud-delta-proxy-28402a29-20261007',goalId:'jobfinder-portable-required-40',version:51}};
function harness(mode='valid'){
 const state=new Map(),ns='proxyNode22:servier:',descriptor={path:'/synthetic-only/independent.json',sha256:'a'.repeat(64)},writes=new Map();
 state.set(ns+'cloudPilotHostHelpers','return fixtureH;');state.set(ns+'registeredCandidateBinding',binding);state.set(ns+'nextBatchId','synthetic-b-bootstrap');
 state.set(ns+'currentIndependentValidationInput',mode==='missing'?null:mode==='extra-field'?{...descriptor,legacy:true}:descriptor);
 let sqlCalls=0,commands=0;
 const checked=new Date(),observed=new Date(checked.getTime()-13*3600000),start=new Date(observed.getTime()-1000),finish=new Date(observed.getTime()+1000);
 const source={sourceId:cfg.sourceId,sourceConfigHash:cfg.sourceConfigSha256,sourceResultId:'synthetic-previous-result',batchId:'synthetic-previous-batch',releaseCandidateId:'synthetic-previous-candidate',startedAt:start.toISOString(),finishedAt:finish.toISOString(),observations:[{id:'synthetic-observation',sourceResultId:'synthetic-previous-result',sourceId:cfg.sourceId,batchId:'synthetic-previous-batch',releaseCandidateId:'synthetic-previous-candidate',sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:observed.toISOString(),observedFrom:start.toISOString(),observedTo:finish.toISOString(),successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true}]};
 const row={checkedAt:checked.toISOString(),holderId:'',candidateRows:[{...binding.candidate,commitSha:binding.build.commitSha}],latestSuccessfulSource:source};
 const fixtureH={cfg,q:(s:string)=>"'"+s+"'",rows:(x:any)=>[x],machineJson:(s:string)=>JSON.parse(s),save:async(path:string,data:any)=>{writes.set(path,structuredClone(data));},readFile:async(path:string)=>({text:JSON.stringify(writes.get(path)),hash:'f'.repeat(64)}),cmd:async(command:string)=>{commands++;if(command.includes('verify-independent-validation.mts')){if(mode==='invalid-input')throw Error('SERVIER_B_INPUT_HASH');return JSON.stringify({status:'VALIDATED_CURRENT_RUN',sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,independentValidationSha256:mode==='proof-mismatch'?'b'.repeat(64):descriptor.sha256});}throw Error('SYNTHETIC_STOP_BEFORE_PREFLIGHT_AND_LAUNCH');}};
 const context=vm.createContext({fixtureH,load:(k:string)=>state.get(k),store:(k:string,v:any)=>state.set(k,v),notify:()=>{},tools:{mcp__codex_apps__supabase_execute_sql:async()=>{sqlCalls++;return row;}}});
 const code=starter.replace('const expectedCandidate=null; // OWNER_CANDIDATE_BINDING','const expectedCandidate='+JSON.stringify(binding.candidate)+'; // OWNER_CANDIDATE_BINDING');
 return {run:()=>vm.compileFunction('return(async()=>{'+code+'})()',[],{parsingContext:context})(),writes,descriptor,get sqlCalls(){return sqlCalls;},get commands(){return commands;}};
}
test('actual starter carries only independentValidation into original fresh bootstrap',async()=>{const h=harness();await assert.rejects(h.run(),/SYNTHETIC_STOP_BEFORE_PREFLIGHT_AND_LAUNCH/);assert.equal(h.sqlCalls,1);const boot=h.writes.get(H+'/synthetic-b-bootstrap/bootstrap.json');assert.deepEqual(boot.independentValidation,h.descriptor);assert.equal('currentCapture' in boot,false);});
for(const mode of ['missing','extra-field','invalid-input','proof-mismatch'])test('B input '+mode+' stops actual starter before SQL/launch',async()=>{const h=harness(mode);await assert.rejects(h.run(),/SERVIER_B_/);assert.equal(h.sqlCalls,0);assert.equal(h.writes.size,0);});
