// Synthetic registration and read-only source-binding checks. No live registration/activation.
import assert from 'node:assert/strict';
import {readFileSync,existsSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRegistrationReadback} from './bind-registered-readback.mjs';
import {paths,stripCombinedObservation} from './supervision/create-combined-starter.mjs';
const base=dirname(fileURLToPath(import.meta.url)),host=join(base,'host'),read=p=>readFileSync(p,'utf8'),A=Object.getPrototypeOf(async function(){}).constructor,ns='deadlineCandidate47b:grifols:';
const cfg=JSON.parse(read(join(host,'host-config.template.json'))),control=JSON.parse(read(join(host,'control-base.template.json'))),build=control.build;
const expected=JSON.parse(read(join(base,'EXPECTED_REGISTRATION.json'))),checks=[];
assert.equal(control.candidate,null);assert.equal(existsSync(join(host,'activation.json')),false);assert.equal(existsSync(join(host,'control-base.json')),false);assert.deepEqual(JSON.parse(read(join(host,'host-config.json'))),cfg);checks.push('actual-activation-control-remain-absent-static-config-ready-template-candidate-null');
const now=Date.now(),candidate={id:'synthetic-grifols-binding-only',goalId:expected.goalId,version:73};
const input={checkedAt:new Date(now).toISOString(),row:{...expected,...candidate,status:'BUILDING'}};
const registered=validateRegistrationReadback(input,now),unregistered={status:'UNREGISTERED',candidate:null,build};
assert.deepEqual(registered,{status:'REGISTERED_VERIFIED',build,candidate});checks.push('synthetic-registration-positive-in-memory-only');
for(const [name,change,pattern] of [
 ['stale',x=>x.checkedAt=new Date(now-60001).toISOString(),/FRESH/],['future',x=>x.checkedAt=new Date(now+1).toISOString(),/FRESH/],
 ['old-id',x=>x.row.id='dot-cloud-restored-fb0b8e3-20261005T2028Z',/ROW/],['invalid-version',x=>x.row.version=null,/ROW/],
 ['commit',x=>x.row.commitSha='0'.repeat(40),/IDENTITY/],['runtime',x=>x.row.runtimeTreeHash='0'.repeat(64),/IDENTITY/],
 ['source',x=>x.row.sourceConfigHash='0'.repeat(64),/IDENTITY/],['historical-schema',x=>x.row.schemaHash='0'.repeat(64),/IDENTITY/],
 ['snapshot',x=>x.row.dbSnapshotHash='0'.repeat(64),/IDENTITY/],['status',x=>x.row.status='INVALIDATED',/ROW/]
 ]){const x=structuredClone(input);change(x);assert.throws(()=>validateRegistrationReadback(x,now),pattern);checks.push('registration-reject-'+name);}
const business=read(join(host,'runtime/start-monitor-portable42.js')),combined=read(join(base,'supervision/start-monitor-grifols47b-combined.js'));
assert.equal(stripCombinedObservation(combined),business);assert.ok(business.includes(' 1800000 -- node --max-old-space-size=256 '));assert.ok(business.includes('P0_SOURCE_HTTP_TIMEOUT_MS=45000'));
const old=read(join(base,'../../workspaces/deadline-companion-r3-safe/host/runtime/start-monitor-portable42.js'));
const gate=s=>s.slice(s.indexOf('// BEGIN OBSERVATION_DUE_GATE'),s.indexOf('// END OBSERVATION_DUE_GATE'));
assert.equal(gate(old),gate(business));checks.push('due-gate-byte-identical-original-business-roundtrip-and-budgets');
for(const [name,code] of [['business',business],['supervised',combined]]){
 let calls=0;globalThis.__bindingHelper=()=>({cfg});
 try{await assert.rejects(()=>new A('load','store','notify','tools',code)(k=>k.endsWith('cloudPilotHostHelpers')?'return __bindingHelper();':k.endsWith('registeredCandidateBinding')?unregistered:undefined,()=>calls++,()=>calls++,new Proxy({},{get(){calls++;throw Error('FORBIDDEN_TOOL');}})),/CANDIDATE_NOT_REGISTERED/);}
 finally{delete globalThis.__bindingHelper;}
 assert.equal(calls,0);checks.push(name+'-unregistered-blocks-before-tools');
}
const loader=read(join(host,'runtime/load-host-state.js'));
const hostFiles=(mode='valid')=>{
 const c=structuredClone(cfg),ctl={...structuredClone(control),candidate:structuredClone(candidate)},b=structuredClone(registered);
 if(mode==='unregistered')b.status='UNREGISTERED';
 if(mode==='wrong-repo')c.repo='/synthetic/wrong-repo';
 if(mode==='wrong-hash')c.sourceConfigSha256='0'.repeat(64);
 if(mode==='wrong-project')ctl.projectId='other';
 if(mode==='wrong-build'){ctl.build.runtimeTreeSha256='0'.repeat(64);b.build.runtimeTreeSha256='0'.repeat(64);}
 if(mode==='partial-binding')ctl.candidate.id='synthetic-other';
 if(mode==='wrong-version')b.candidate.version=0;
 return {'host-config.json':JSON.stringify(c),'control-base.json':JSON.stringify(ctl),'activation.json':JSON.stringify(b),'host-helper-functions.js':read(join(host,'host-helper-functions.js')),'host-stage-functions.js':read(join(host,'host-stage-functions.js'))};
};
for(const mode of ['valid','unregistered','wrong-repo','wrong-hash','wrong-project','wrong-build','partial-binding','wrong-version','wrong-helper']){
 const files=hostFiles(mode);if(mode==='wrong-helper')files['host-stage-functions.js']=files['host-stage-functions.js'].replaceAll(cfg.sourceId,'source-takeda-china-social');
 const saved=new Map();let calls=0;
 const run=()=>new A('root','sourceId','candidateId','commit','store','tools',loader)(host,cfg.sourceId,candidate.id,build.commitSha,(k,v)=>saved.set(k,v),{exec_command:async()=>{calls++;return {exit_code:0,output:JSON.stringify(files)}}});
 if(mode==='valid'){await run();assert.equal(saved.size,4);assert.deepEqual(saved.get(ns+'registeredCandidateBinding'),registered);}
 else{await assert.rejects(run,/CANDIDATE_NOT_REGISTERED|HOST_LOAD_BINDING_MISMATCH|HOST_LOCAL_BUILD_BINDING_MISMATCH|HOST_LOAD_HELPER_SCOPE_MISMATCH/);assert.equal(saved.size,0);}
 assert.equal(calls,1);checks.push('reconstructed-r3-loader-'+mode);
}
{
 const runtimeLoader=read(join(host,'runtime/load-source-runtime.js'));
 const runtimeFiles={'load-host-state.js':loader,'../../supervision/start-monitor-grifols47b-combined.js':combined,'continuous-relay-v3-durable-monitor.js':read(join(host,'runtime/continuous-relay-v3-durable-monitor.js')),'complete-reviewed-source-readback.js':read(join(host,'runtime/complete-reviewed-source-readback.js')),'../activation.json':JSON.stringify(registered)};
 const saved=new Map();let calls=0;
 globalThis.tools={exec_command:async()=>({exit_code:0,output:JSON.stringify(++calls===1?runtimeFiles:hostFiles())})};globalThis.store=(k,v)=>saved.set(k,v);
 try{await new A('sourceKey','load','store','text','tools',runtimeLoader)('grifols',()=>undefined,globalThis.store,()=>{},globalThis.tools);}finally{delete globalThis.tools;delete globalThis.store;}
 assert.equal(calls,2);assert.equal(saved.get(ns+'restoredPortableSourceStartCode'),combined);assert.equal(saved.get(ns+'completeReviewedSourceCode'),runtimeFiles['complete-reviewed-source-readback.js']);assert.ok([...saved.keys()].every(k=>k.startsWith(ns)));checks.push('complete-runtime-loader-selects-grifols-supervised-entry-and-r3-completion');
 let reads=0,stores=0;await assert.rejects(()=>new A('sourceKey','load','store','text','tools',runtimeLoader)('grifols',()=>undefined,()=>stores++,()=>{}, {exec_command:async()=>{reads++;return {exit_code:0,output:JSON.stringify({'../activation.json':JSON.stringify(unregistered)})};}}),/CANDIDATE_NOT_REGISTERED/);assert.equal(reads,1);assert.equal(stores,0);checks.push('runtime-unregistered-rejects-before-state-replacement');
}
assert.equal(existsSync(join(host,'activation.json')),false);assert.equal(existsSync(join(host,'control-base.json')),false);
mkdirSync(join(base,'verification'),{recursive:true});const report={status:'PASS_OFFLINE_BINDING_AND_PATHS',checks,loaderReconstructedNotOriginalBytes:true,actualCandidate:null,activationAbsent:true,controlAbsent:true,networkUsed:false,databaseUsed:false,realProducerExecuted:false};
writeFileSync(join(base,'verification/BINDING_RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
