// Synthetic/read-only checks only; never materializes a registered identity.
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,existsSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateRegistrationReadback} from './bind-registered-readback.mjs';
import {paths} from './supervision/create-combined-starter.mjs';
const base=dirname(fileURLToPath(import.meta.url)),r2=dirname(base),host=join(base,'host');
const oldHost=join(r2,'hosts46/takeda'),oldRepo=join(r2,'producer42'),newRepo=dirname(dirname(paths.wrapper));
const read=p=>readFileSync(p,'utf8'),checks=[];
const original=read(join(oldHost,'runtime/start-monitor-portable42.js')),candidate=read(join(host,'runtime/start-monitor-portable42.js'));
const command=s=>s.slice(s.indexOf('const command='),s.indexOf('\nawait h.save(run+"/reviewed-command.txt"'));
assert.equal(command(candidate),command(original).replaceAll(oldRepo,newRepo));checks.push('business-command-byte-exact-after-only-repo-path-map');
assert.ok(command(candidate).includes(newRepo+'/node_modules/tsx/dist/loader.mjs'));assert.ok(!command(candidate).includes(oldRepo));
assert.ok(command(candidate).includes(' 1800000 -- node --max-old-space-size=256 '));
assert.ok(command(candidate).includes('P0_SOURCE_HTTP_TIMEOUT_MS=45000'));checks.push('same-repo-wrapper-loader-heap-timeout-and-source-env');
const section=s=>s.slice(s.indexOf('// BEGIN OBSERVATION_DUE_GATE'),s.indexOf('// END OBSERVATION_DUE_GATE'));
assert.equal(section(candidate),section(original));checks.push('due-gate-byte-identical');
const cfg=JSON.parse(read(join(host,'host-config.json'))),activation=JSON.parse(read(join(host,'activation.json'))),control=JSON.parse(read(join(host,'control-base.json')));
assert.equal(cfg.repo,newRepo);assert.equal(cfg.root,host);assert.equal(activation.status,'UNREGISTERED');assert.equal(activation.candidate,null);assert.equal(control.candidate,null);checks.push('delivery-config-has-no-fake-candidate-or-version');
const expected=JSON.parse(read(join(base,'EXPECTED_REGISTRATION.json'))),now=Date.now();
const input={checkedAt:new Date(now).toISOString(),row:{...expected,id:'synthetic-deadline-test-only',version:1,status:'BUILDING'}};
assert.equal(validateRegistrationReadback(input,now).candidate.id,input.row.id);checks.push('synthetic-registration-binding');
for(const [name,value,re] of [
 ['stale',{...input,checkedAt:new Date(now-60001).toISOString()},/FRESH/],
 ['future',{...input,checkedAt:new Date(now+1).toISOString()},/FRESH/],
 ['version',{...input,row:{...input.row,version:null}},/ROW_REQUIRED/],
 ['old-id',{...input,row:{...input.row,id:'dot-cloud-restored-fb0b8e3-20261005T2028Z'}},/ROW_REQUIRED/],
 ['runtime',{...input,row:{...input.row,runtimeTreeHash:'0'.repeat(64)}},/IDENTITY:runtimeTreeHash/],
 ['source',{...input,row:{...input.row,sourceConfigHash:'0'.repeat(64)}},/IDENTITY:sourceConfigHash/]
 ]){assert.throws(()=>validateRegistrationReadback(value,now),re);checks.push('reject-'+name);}
const A=Object.getPrototypeOf(async function(){}).constructor;
for(const [name,source] of [['business-starter',candidate],['combined-starter',read(join(base,'supervision/start-monitor-takeda46-combined.js'))]]){
 let calls=0;const h={cfg};globalThis.__deadlineBindingFixture=()=>h;
 const load=k=>k.endsWith('cloudPilotHostHelpers')?'return __deadlineBindingFixture();':k.endsWith('registeredCandidateBinding')?activation:undefined;
 try{await assert.rejects(()=>new A('load','store','notify','tools',source)(load,()=>{calls++;},()=>{calls++;},new Proxy({},{get(){calls++;throw Error('UNEXPECTED_TOOL');}})),/CANDIDATE_NOT_REGISTERED/);}
 finally{delete globalThis.__deadlineBindingFixture;}
 assert.equal(calls,0);checks.push(name+'-rejects-unregistered-before-tools');
}
const loader=read(join(host,'runtime/load-source-runtime.js'));let stores=0,reads=0;
await assert.rejects(()=>new A('sourceKey','load','store','text','tools',loader)('takeda',()=>undefined,()=>{stores++;},()=>{}, {exec_command:async()=>{reads++;return {exit_code:0,output:JSON.stringify({'../activation.json':JSON.stringify(activation)})};}}),/CANDIDATE_NOT_REGISTERED/);
assert.equal(reads,1);assert.equal(stores,0);checks.push('runtime-loader-rejects-before-state-replacement');
const hostLoader=read(join(host,'runtime/load-host-state.js'));
const approvedBinding=validateRegistrationReadback(input,now);
const approvedControl={...control,candidate:approvedBinding.candidate};
for(const mode of ['synthetic-valid','unregistered','wrong-repo','wrong-build','partial-binding']){
 let saved=0;
 const readCfg={...cfg,...(mode==='wrong-repo'?{repo:oldRepo}:{})};
 const readBuild={...control.build,...(mode==='wrong-build'?{runtimeTreeSha256:'0'.repeat(64)}:{})};
 const readControl={...approvedControl,build:readBuild,...(mode==='partial-binding'?{candidate:{...approvedBinding.candidate,id:'synthetic-other'}}:{})};
 const readBinding=mode==='unregistered'?activation:{...approvedBinding,build:readBuild};
 const files={'host-config.json':JSON.stringify(readCfg),'control-base.json':JSON.stringify(readControl),'activation.json':JSON.stringify(readBinding),'host-helper-functions.js':read(join(host,'host-helper-functions.js')),'host-stage-functions.js':read(join(host,'host-stage-functions.js'))};
 const execute=()=>new A('root','sourceId','candidateId','commit','load','store','tools',hostLoader)(host,cfg.sourceId,approvedBinding.candidate.id,control.build.commitSha,()=>undefined,()=>{saved++;},{exec_command:async()=>({exit_code:0,output:JSON.stringify(files)})});
 if(mode==='synthetic-valid'){await execute();assert.equal(saved,4);}
 else{await assert.rejects(execute,/CANDIDATE_NOT_REGISTERED|HOST_LOAD_BINDING_MISMATCH|HOST_LOCAL_BUILD_BINDING_MISMATCH/);assert.equal(saved,0);}
 checks.push('host-loader-'+mode);
}
const oldReview=read(join(oldHost,'runtime/review-publication.py'));
const newReview=read(join(host,'runtime/review-publication.py')).replace("\nbinding=json.loads((host/'activation.json').read_text());control=json.loads((host/'control-base.json').read_text())\nassert binding['status']=='REGISTERED_VERIFIED' and binding['candidate'] and binding['build']==control['build'] and binding['candidate']==control['candidate']",'').replace("row['releaseCandidateId']==binding['candidate']['id']","row['releaseCandidateId']=='dot-cloud-restored-fb0b8e3-20261005T2028Z'");
assert.equal(newReview,oldReview);checks.push('reviewer-gates-byte-identical-except-added-registration-and-id-binding');
{
 const saved=new Map();let reads=0;
 const runtimeFiles={'load-host-state.js':hostLoader,'../../supervision/start-monitor-takeda46-combined.js':read(join(base,'supervision/start-monitor-takeda46-combined.js')),'continuous-relay-v3-durable-monitor.js':read(join(host,'runtime/continuous-relay-v3-durable-monitor.js')),'../activation.json':JSON.stringify(approvedBinding)};
 runtimeFiles['complete-reviewed-source-readback.js']=read(join(host,'runtime/complete-reviewed-source-readback.js'));
 const hostFiles={'host-config.json':JSON.stringify(cfg),'control-base.json':JSON.stringify(approvedControl),'activation.json':JSON.stringify(approvedBinding),'host-helper-functions.js':read(join(host,'host-helper-functions.js')),'host-stage-functions.js':read(join(host,'host-stage-functions.js'))};
 const tools={exec_command:async()=>({exit_code:0,output:JSON.stringify(++reads===1?runtimeFiles:hostFiles)})};
 globalThis.tools=tools;globalThis.store=(key,value)=>saved.set(key,value);
 try{await new A('sourceKey','load','store','text','tools',loader)('takeda',()=>undefined,globalThis.store,()=>{},tools);}
 finally{delete globalThis.tools;delete globalThis.store;}
 assert.equal(reads,2);
 assert.equal(saved.get('deadlineCandidate:takeda:restoredPortableSourceStartCode'),runtimeFiles['../../supervision/start-monitor-takeda46-combined.js']);
 assert.ok([...saved.keys()].every(key=>key.startsWith('deadlineCandidate:takeda:')));
 assert.equal(saved.get('deadlineCandidate:takeda:completeReviewedSourceCode'),runtimeFiles['complete-reviewed-source-readback.js']);
 checks.push('synthetic-valid-loader-selects-candidate-bound-completion');
 checks.push('synthetic-valid-loader-selects-supervised-starter-and-isolated-state');
}
mkdirSync(join(base,'verification'),{recursive:true});const artifacts=mkdtempSync(join(base,'verification/binding-'));
const review=spawnSync('python3',[join(host,'runtime/review-publication.py'),host,join(host,'synthetic-unregistered'), '11111111-1111-4111-8111-111111111111'],{encoding:'utf8'});
assert.notEqual(review.status,0);assert.match(review.stderr,/AssertionError/);assert.doesNotMatch(review.stderr,/FileNotFoundError/);checks.push('reviewer-rejects-unregistered-before-reading-packet');
const rejected=spawnSync(process.execPath,[paths.supervisor,'start',join(artifacts,'old-wrapper-control'),'synthetic-old-wrapper','--',process.execPath,join(oldRepo,'scripts/run-with-http-diagnostics.mjs'),join(artifacts,'diagnostics'),'500','--',process.execPath,'-e','process.exit(99)'],{encoding:'utf8'});
assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/ORIGINAL_WRAPPER_COMMAND_REQUIRED/);assert.equal(existsSync(join(artifacts,'diagnostics')),false);checks.push('new-supervisor-refuses-old-wrapper-path');
const report={status:'PASS_OFFLINE_BINDING_AND_PATHS',checks,realProducerExecuted:false,networkUsed:false,databaseUsed:false,activationStillUnregistered:JSON.parse(read(join(host,'activation.json'))).status==='UNREGISTERED',sameCandidatePath:newRepo};
writeFileSync(join(artifacts,'BINDING_RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
