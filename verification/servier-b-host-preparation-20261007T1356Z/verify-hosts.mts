// PURE SYNTHETIC OFFLINE: local compilation/rendering and mocked entrypoints only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import vm from 'node:vm';
import {deriveCurrentStagedScheduleExpectation} from '../../producer/src/crawler/stagedScheduleAuthority.ts';
import {compileCloudPilotPublicationContextSql} from '../../producer/src/db/cloudPilotSqlControl.ts';
const R=resolve(import.meta.dirname,'../..'),P=import.meta.dirname;
const key=process.argv[2];assert(['servier'].includes(key));
const base=join(R,'hosts',key),host=join(base,'host'),cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
const control=JSON.parse(readFileSync(join(host,'control-base.template.json'),'utf8'));
const e=deriveCurrentStagedScheduleExpectation(control.build),sha=(x:any)=>createHash('sha256').update(x).digest('hex');
const out=join(P,'synthetic-'+key);mkdirSync(out,{recursive:false,mode:0o700});
const candidate={id:'dot-cloud-delta-proxy-28402a29-20261007',goalId:'jobfinder-portable-required-40',version:51};
const databaseIdentity={migrationVersion:'20261006172300_job_projection_delta_contract',schemaHash:'d'.repeat(64),dbSnapshotHash:'e'.repeat(64)};
const owner={...JSON.parse(readFileSync(join(host,'owner-binding-input.template.json'),'utf8')),candidate,databaseIdentity};
const row={...candidate,...databaseIdentity,commitSha:e.commitSha,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,minimumStableCompanyCount:e.minimumStableCompanyCount,oracleVersion:'staged-official-source-v1',status:'BUILDING'};
const results:any[]=[];
for(const name of ['valid','null-candidate','null-database','wrong-version','wrong-source','wrong-source-hash','wrong-row-schema','wrong-row-source-config','wrong-row-candidate','wrong-build']){
 const o=structuredClone(owner),r=structuredClone(row);
 if(name==='null-candidate')o.candidate=null;
 if(name==='null-database')o.databaseIdentity=null;
 if(name==='wrong-version')o.candidate.version=50;
 if(name==='wrong-source')o.sourceId='source-amgen-china-social';
 if(name==='wrong-source-hash')o.sourceConfigSha256='0'.repeat(64);
 if(name==='wrong-row-schema')r.schemaHash='f'.repeat(64);
 if(name==='wrong-row-source-config')r.sourceConfigHash='f'.repeat(64);
 if(name==='wrong-row-candidate')r.id='synthetic-wrong-candidate';
 if(name==='wrong-build')o.build.contentSha256='f'.repeat(64);
 const ownerPath=join(out,name+'-owner.json'),readback=join(out,name+'-readback.json'),target=join(out,name+'-prepared');
 writeFileSync(ownerPath,JSON.stringify(o));writeFileSync(readback,JSON.stringify({classification:'PURE_SYNTHETIC_OFFLINE_NOT_REGISTRATION',candidateRow:r}));
 const run=spawnSync(cfg.node,['--require',join(R,'no-network.cjs'),'--import',join(cfg.repo,'node_modules/tsx/dist/loader.mjs'),join(host,'runtime/prepare-registered-control.mts'),ownerPath,readback,target],{cwd:cfg.repo,env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:cfg.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'},encoding:'utf8'});
 writeFileSync(join(out,name+'-exec.json'),JSON.stringify({status:run.status,stdout:run.stdout,stderr:run.stderr},null,2));
 assert.equal(run.status===0,name==='valid',name+':'+run.stderr);
 if(name==='valid'){
  const bound=JSON.parse(readFileSync(join(target,'host/control-base.json'),'utf8'));
  const sql=readFileSync(join(target,'host/context-read.sql'),'utf8');assert.equal(sql,compileCloudPilotPublicationContextSql(bound));assert(!sql.includes('PLAN_BOUND_SOURCE_QUALITY_V1'));
  const activation=JSON.parse(readFileSync(join(target,'host/activation.prepared.json'),'utf8'));assert.equal(activation.status,'PREPARED_NOT_ACTIVATED');assert.equal(activation.starterSha256,sha(readFileSync(join(target,`supervision/start-monitor-${key}51-combined.js`))));assert.equal(activation.loaderSha256,sha(readFileSync(join(target,'host/runtime/load-host-state.js'))));
  assert.equal(existsSync(join(target,'host/activation.json')),false);
 }else assert.equal(existsSync(target),false);
 results.push({name,passed:true});
}
// Prove unbound entrypoints stop before any external or local tool dispatch.
let calls=0;const sandbox=vm.createContext({tools:new Proxy({},{get(){calls++;throw Error('TOOLS_FORBIDDEN');}}),load:()=>{calls++;throw Error('LOAD_FORBIDDEN');},store:()=>{calls++;throw Error('STORE_FORBIDDEN');}});
const loader=readFileSync(join(host,'runtime/load-host-state.js'),'utf8'),starter=readFileSync(join(base,`supervision/start-monitor-${key}51-combined.js`),'utf8');
await assert.rejects(vm.compileFunction('return(async()=>{'+loader+'})()',['root','sourceId','candidateId','commit'],{parsingContext:sandbox})(host,cfg.sourceId,candidate.id,control.build.commitSha),/HOST_OWNER_BINDING_REQUIRED/);
await assert.rejects(vm.compileFunction('return(async()=>{'+starter+'})()',[],{parsingContext:sandbox})(),/HOST_OWNER_BINDING_REQUIRED/);assert.equal(calls,0);results.push({name:'unbound-loader-and-starter-no-tools',passed:true});
// Exercise unchanged actual observation gate from each starter.
const due=starter.split('// BEGIN OBSERVATION_DUE_GATE\n')[1].split('// END OBSERVATION_DUE_GATE')[0];
const requireDue=new Function(due+'\nreturn requireObservationDue;')();
const source={sourceId:cfg.sourceId,sourceConfigHash:cfg.sourceConfigSha256,sourceResultId:'synthetic-result',batchId:'synthetic-batch',releaseCandidateId:'synthetic-candidate',startedAt:'2026-10-06T01:00:00Z',finishedAt:'2026-10-06T01:00:02Z',observations:[{id:'synthetic-observation',sourceResultId:'synthetic-result',sourceId:cfg.sourceId,batchId:'synthetic-batch',releaseCandidateId:'synthetic-candidate',sourceConfigSha256:cfg.sourceConfigSha256,crawledAt:'2026-10-06T01:00:01Z',observedFrom:'2026-10-06T01:00:00Z',observedTo:'2026-10-06T01:00:02Z',successful:true,transportSucceeded:true,adapterSucceeded:true,completenessVerified:true,atomicCommitSucceeded:true}]};
const dueRow={checkedAt:'2026-10-06T13:00:01Z',latestSuccessfulSource:source};
assert.equal(requireDue(dueRow,cfg).ageMs,43200000);results.push({name:'exact-12h-due',passed:true});
for(const name of ['not-due','missing-source','missing-observation','multiple-observations','wrong-config','wrong-source','wrong-result','wrong-batch','wrong-candidate','wrong-observation-config','failed-transport','failed-adapter','failed-completeness','failed-commit','failed-success','bad-window','bad-date','future-crawl']){
 const r=structuredClone(dueRow),s=r.latestSuccessfulSource,o=s.observations[0];
 if(name==='not-due')r.checkedAt='2026-10-06T13:00:00.999Z';
 if(name==='missing-source')r.latestSuccessfulSource=null;
 if(name==='missing-observation')s.observations=[];
 if(name==='multiple-observations')s.observations.push({...o});
 if(name==='wrong-config')s.sourceConfigHash='0'.repeat(64);
 if(name==='wrong-source')s.sourceId='synthetic-wrong-source';
 if(name==='wrong-result')o.sourceResultId='wrong';
 if(name==='wrong-batch')o.batchId='wrong';
 if(name==='wrong-candidate')o.releaseCandidateId='wrong';
 if(name==='wrong-observation-config')o.sourceConfigSha256='0'.repeat(64);
 if(name==='failed-transport')o.transportSucceeded=false;
 if(name==='failed-adapter')o.adapterSucceeded=false;
 if(name==='failed-completeness')o.completenessVerified=false;
 if(name==='failed-commit')o.atomicCommitSucceeded=false;
 if(name==='failed-success')o.successful=false;
 if(name==='bad-window')o.observedFrom='2026-10-06T01:00:01Z';
 if(name==='bad-date')o.crawledAt='not a date';
 if(name==='future-crawl')r.checkedAt='2026-10-06T00:00:00Z';
 assert.throws(()=>requireDue(r,cfg),/SOURCE_/);results.push({name:'due-'+name,passed:true});
}
for(const name of ['activation.json','control-base.json','context-read.sql'])assert.equal(existsSync(join(host,name)),false);
assert(starter.includes('--max-old-space-size=384')&&starter.includes(' 1800000 -- ')&&starter.includes('P0_SOURCE_HTTP_TIMEOUT_MS=45000'));
assert(starter.includes('scripts/p0-cloud-source-pilot.ts')&&!starter.includes('scripts/p0-cloud-portable-source-pilot.ts'));
const complete=readFileSync(join(host,'runtime/complete-reviewed-source-readback.js'),'utf8');assert(complete.includes('const statePath="'+R+'/PUBLISHER-ACTIVE-STATE.json"'));
results.push({name:'original-B-protocol-and-single-global-state-path',passed:true});
writeFileSync(join(base,'verification/HOST_PREPARATION_RESULTS.json'),JSON.stringify({classification:'PURE_SYNTHETIC_OFFLINE',sourceId:cfg.sourceId,tests:results,passed:results.length,network:false,sqlExecuted:false,registration:false,hostUnbound:true,globalStateWritten:false},null,2)+'\n');
console.log(JSON.stringify({key,passed:results.length,hostUnbound:true,network:false,sqlExecuted:false}));
