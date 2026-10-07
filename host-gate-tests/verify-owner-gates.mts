// Offline only. Host fragments receive in-memory synthetic bindings; no DB/API/producer launch.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { verifyNodeRuntimeProfile } from '../producer/scripts/verify-node-runtime-profile.ts';
import { compileCloudPilotPublicationContextSql } from '../producer/src/db/cloudPilotSqlControl.ts';
import { deriveCurrentStagedScheduleExpectation } from '../producer/src/crawler/stagedScheduleAuthority.ts';
import { preflight } from '../hosts/novartis-next/host/runtime/preflight/preflight-launch.mjs';
const base=resolve(import.meta.dirname,'..'),host=join(base,'hosts/novartis-next/host');
const output=mkdtempSync(join(import.meta.dirname,'owner-run-'));
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
const template=JSON.parse(readFileSync(join(host,'control-base.json'),'utf8'));
const actualActivation=JSON.parse(readFileSync(join(host,'activation.json'),'utf8'));
const build=JSON.parse(readFileSync(join(base,'NEW_LOCAL_BUILD_IDENTITY.json'),'utf8'));
const sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const protectedNames=['activation.json','control-base.json','host-config.json','context-read.sql'];
const protectedBefore=Object.fromEntries(protectedNames.map(n=>[n,existsSync(join(host,n))?sha(readFileSync(join(host,n))):null]));
const results:any[]=[];const pass=(name:string,detail?:unknown)=>results.push({name,passed:true,...detail?{detail}:{}});
const A=Object.getPrototypeOf(async function(){}).constructor;
assert.equal(build.commitSha,'0edb12df2ea9b466b25eb388eff1f230636bbd7e');assert.deepEqual(template.build,build);
assert.equal(template.candidate,null);assert.equal(template.databaseIdentity,null);assert.equal(actualActivation.candidate,null);assert.equal(actualActivation.databaseIdentity,null);assert.equal(actualActivation.status,'UNREGISTERED_NOT_ACTIVATED');
pass('Actual 0edb host remains unbound with null candidate and DB identity');
const candidate={id:'synthetic-only-novartis-new-host',goalId:'jobfinder-portable-required-40',version:53};
const databaseIdentity={migrationVersion:'20261006172300_job_projection_delta_contract',schemaHash:'d'.repeat(64),dbSnapshotHash:'e'.repeat(64)};
const control={...template,candidate,databaseIdentity};
const context=compileCloudPilotPublicationContextSql(control,'PLAN_BOUND_SOURCE_QUALITY_V1');
const binding={status:'REGISTERED_VERIFIED',build,databaseIdentity,candidate,contextReadSha256:sha(context)};
const nodeRuntime=await verifyNodeRuntimeProfile();assert.equal(nodeRuntime.execPath,cfg.node);assert.equal(nodeRuntime.version,'v22.23.3');pass('Executing Node has exact pinned version, path and binary hash');
const helperSource=readFileSync(join(host,'host-helper-functions.js'),'utf8');
const machineSource=readFileSync(join(host,'machine-json.js'),'utf8');
const files:any={'machine-json.js':machineSource,'host-config.json':JSON.stringify(cfg),'control-base.json':JSON.stringify(control),'activation.json':JSON.stringify(binding),'context-read.sql':context,'__contextReadSha256':sha(context),'host-helper-functions.js':helperSource,'host-stage-functions.js':readFileSync(join(host,'host-stage-functions.js'),'utf8')};
const rawLoader=readFileSync(join(host,'runtime/load-host-state.js'),'utf8');
const candidateMarker='const expectedCandidate=null; // OWNER_CANDIDATE_BINDING',dbMarker='const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING';
assert.equal(rawLoader.split(candidateMarker).length,2);assert.equal(rawLoader.split(dbMarker).length,2);
// Bind only this in-memory test string. The real host loader stays null and unlaunchable.
const loader=rawLoader.replace(candidateMarker,'const expectedCandidate='+JSON.stringify(candidate)+'; // OWNER_CANDIDATE_BINDING').replace(dbMarker,'const expectedDatabaseIdentity='+JSON.stringify(databaseIdentity)+'; // OWNER_DATABASE_BINDING');
const baselineProof={build,candidate,nodeRuntime,contextReadSha256:sha(context)};
async function runLoader(data:any,proof:any=baselineProof,source=loader,args:any={root:cfg.root,sourceId:cfg.sourceId,candidateId:candidate.id,commit:build.commitSha}){
 const stored:any[]=[];let calls=0;
 const tools=new Proxy({exec_command:async()=>({exit_code:0,output:JSON.stringify(calls++===0?data:proof)})},{get(t:any,k){if(!(k in t))throw Error('OFFLINE_TOOL_FORBIDDEN:'+String(k));return t[k];}});
 try{const value=await new A('root','sourceId','candidateId','commit','tools','store','notify',source)(args.root,args.sourceId,args.candidateId,args.commit,tools,(k:any,v:any)=>stored.push([k,v]),()=>{});return {value,stored,calls};}
 catch(error:any){assert.equal(stored.length,0,'Every rejected loader must preserve session state');error.offlineCalls=calls;throw error;}
}
await assert.rejects(runLoader(files,baselineProof,rawLoader),(e:any)=>e.message==='HOST_OWNER_BINDING_REQUIRED'&&e.offlineCalls===0);pass('Unbound actual loader rejects before any tools or stores');
assert.equal((await runLoader(files)).stored.length,5);pass('In-memory synthetic version52 exact tuple passes five stores after proof');
for(const [name,mutate] of [
 ['no candidate',(c:any,b:any)=>{c.candidate=null;b.candidate=null;}],
 ['old version 52',(c:any,b:any)=>{c.candidate.version=52;b.candidate.version=52;}],
 ['future version 54 mismatch',(c:any,b:any)=>{c.candidate.version=54;b.candidate.version=54;}],
 ['future fractional version',(c:any,b:any)=>{c.candidate.version=53.5;b.candidate.version=53.5;}],
 ['candidate id mismatch',(c:any,b:any)=>{b.candidate.id+='-wrong';}],
 ['same wrong candidate id in both files',(c:any,b:any)=>{c.candidate.id+='-wrong';b.candidate.id=c.candidate.id;}],
 ['candidate goal mismatch',(c:any,b:any)=>{b.candidate.goalId='wrong-goal';}],
 ['candidate extra field',(c:any,b:any)=>{b.candidate.extra=true;}],
 ['not registered',(c:any,b:any)=>{b.status='UNREGISTERED_NOT_ACTIVATED';}],
 ['old build commit',(c:any,b:any)=>{c.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';b.build.commitSha=c.build.commitSha;}],
 ['same wrong source tree in both files',(c:any,b:any)=>{c.build.sourceTreeSha256='0'.repeat(64);b.build.sourceTreeSha256=c.build.sourceTreeSha256;}],
 ['same wrong runtime tree in both files',(c:any,b:any)=>{c.build.runtimeTreeSha256='0'.repeat(64);b.build.runtimeTreeSha256=c.build.runtimeTreeSha256;}],
 ['same wrong content hash in both files',(c:any,b:any)=>{c.build.contentSha256='0'.repeat(64);b.build.contentSha256=c.build.contentSha256;}],
 ['missing DB identity',(c:any,b:any)=>{c.databaseIdentity=null;b.databaseIdentity=null;}],
 ['DB snapshot mismatch',(c:any,b:any)=>{b.databaseIdentity.dbSnapshotHash='0'.repeat(64);}],
 ['same wrong DB snapshot in both files',(c:any,b:any)=>{c.databaseIdentity.dbSnapshotHash='0'.repeat(64);b.databaseIdentity.dbSnapshotHash=c.databaseIdentity.dbSnapshotHash;}],
 ['context hash mismatch',(c:any,b:any)=>{b.contextReadSha256='0'.repeat(64);}],
 ['wrong project',(c:any,b:any)=>{c.projectId='wrong-project';}]
] as const){const d=structuredClone(files),c=JSON.parse(d['control-base.json']),b=JSON.parse(d['activation.json']);mutate(c,b);d['control-base.json']=JSON.stringify(c);d['activation.json']=JSON.stringify(b);await assert.rejects(runLoader(d));pass('Loader rejects '+name+' before stores');}
for(const [name,mutate] of [
 ['wrong node path',(x:any)=>{x.node='/usr/bin/node';}],['wrong producer root',(x:any)=>{x.repo+='/wrong';}],['wrong host root',(x:any)=>{x.root+='/wrong';}],['wrong source id',(x:any)=>{x.sourceId='source-grifols-china-social';}],['wrong source hash',(x:any)=>{x.sourceConfigSha256='0'.repeat(64);}]
] as const){const d=structuredClone(files),c=JSON.parse(d['host-config.json']);mutate(c);d['host-config.json']=JSON.stringify(c);await assert.rejects(runLoader(d));pass('Loader rejects '+name+' before stores');}
for(const [name,mutate] of [
 ['proof build mismatch',(p:any)=>{p.build.contentSha256='0'.repeat(64);}],['proof candidate mismatch',(p:any)=>{p.candidate.version=54;}],['proof context mismatch',(p:any)=>{p.contextReadSha256='0'.repeat(64);}]
] as const){const proof=structuredClone(baselineProof);mutate(proof);await assert.rejects(runLoader(files,proof));pass('Loader rejects '+name+' before stores');}
const noDbLoader=rawLoader.replace(candidateMarker,'const expectedCandidate='+JSON.stringify(candidate)+'; // OWNER_CANDIDATE_BINDING');
await assert.rejects(runLoader(files,baselineProof,noDbLoader),(e:any)=>e.message==='HOST_OWNER_BINDING_REQUIRED'&&e.offlineCalls===0);pass('Candidate without owner DB binding rejects before tools or stores');
// Exercise the actual host save implementation through the real local apply_patch CLI.
let patchCount=0;
const helper=await new A('load','store','tools','notify',helperSource)((key:string)=>key.endsWith(':cloudPilotMachineJson')?machineSource:cfg,()=>{},new Proxy({apply_patch:async(patch:string)=>{
 const match=/\*\*\* Add File: ([^\n]+)/.exec(patch);assert(match);assert(resolve(match[1]).startsWith(output+'/'),'SAVE_OUTSIDE_SYNTHETIC_ROOT');
 const response=execFileSync('/usr/local/bin/apply_patch',[patch],{encoding:'utf8'});patchCount++;return {output:response};
}},{get(t:any,k){if(!(k in t))throw Error('OFFLINE_TOOL_FORBIDDEN:'+String(k));return t[k];}}),()=>{});
const starter=readFileSync(join(host,'../supervision/start-monitor-novartis-next-combined.js'),'utf8');
async function rejectStarter(source:string,syntheticBinding:any,expectedError:RegExp){
 let toolCalls=0,stores=0;
 const load=(key:string)=>key.endsWith(':cloudPilotHostHelpers')?"return {cfg:{sourceId:'source-novartis-social'}};":syntheticBinding;
 const tools=new Proxy({}, {get(){toolCalls++;throw Error('OFFLINE_STARTER_TOOL_FORBIDDEN');}});
 await assert.rejects(new A('load','store','tools','notify',source)(load,()=>{stores++;},tools,()=>{}),expectedError);
 assert.equal(toolCalls,0);assert.equal(stores,0);
}
await rejectStarter(starter,binding,/HOST_OWNER_BINDING_REQUIRED/);pass('Actual unbound starter rejects before any tools or stores');
const syntheticStarter=starter.replace(candidateMarker,'const expectedCandidate='+JSON.stringify(candidate)+'; // OWNER_CANDIDATE_BINDING');
for(const [name,mutate] of [
 ['no candidate',(b:any)=>{b.candidate=null;}],['version51',(b:any)=>{b.candidate.version=52;}],['version53 tuple mismatch',(b:any)=>{b.candidate.version=54;}],['wrong candidate id',(b:any)=>{b.candidate.id+='-wrong';}],['wrong candidate goal',(b:any)=>{b.candidate.goalId='wrong-goal';}],['old commit',(b:any)=>{b.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';}]
] as const){const b=structuredClone(binding);mutate(b);await rejectStarter(syntheticStarter,b,/CANDIDATE_NOT_REGISTERED|HOST_CANDIDATE_IDENTITY_MISMATCH/);pass('Starter rejects '+name+' before any tools or stores');}
const start=starter.indexOf('function buildObservedCommand('),end=starter.indexOf('function buildCombinedCommand(',start);assert(start>=0&&end>start);
const buildObservedCommand=new Function(starter.slice(start,end)+'\nreturn buildObservedCommand;')();
const command=buildObservedCommand('synthetic-command-never-executed',{samplerPath:'/synthetic/sampler.py',expectedArg:'synthetic-only',outputDir:join(output,'not-created'),label:'SYNTHETIC_ONLY'},helper.q);
const commandPath=join(output,'reviewed-combined-command.txt');await helper.save(commandPath,command);
const commandBytes=readFileSync(commandPath);assert.equal(commandBytes.toString(),command+'\n');assert.equal(commandBytes.filter(b=>b===0x0a).length,6);assert(!command.includes('\\nif '));assert(commandBytes.includes(Buffer.from('\nif wait ')));assert.equal(patchCount,1);
pass('Actual helper.save persists extracted combined-command builder with real 0a line separators',{path:commandPath,lfBytes:commandBytes.filter(b=>b===0x0a).length,sha256:sha(commandBytes)});
// Actual check mode only, with all output under this synthetic fixture; launch is never invoked.
const fixtureHost=join(output,'synthetic-preflight-host');mkdirSync(fixtureHost);
const fixtureCfg={...cfg,root:fixtureHost};const expected=deriveCurrentStagedScheduleExpectation(build);
const candidateRow={...candidate,commitSha:build.commitSha,...databaseIdentity,rosterHash:expected.rosterSha256,sourcePlanHash:expected.sourcePlanSha256,sourceConfigHash:expected.sourceConfigSha256,adapterBundleHash:expected.adapterBundleSha256,sourceTreeHash:expected.sourceTreeSha256,runtimeTreeHash:expected.runtimeTreeSha256,oracleVersion:'staged-official-source-v1',minimumStableCompanyCount:expected.minimumStableCompanyCount,status:'BUILDING'};
const bootstrap={schemaVersion:1,batchId:'synthetic-preflight-only',checkedAt:new Date().toISOString(),candidateRows:[candidateRow]};
const bootstrapText=JSON.stringify(bootstrap);const configPath=join(fixtureHost,'host-config.json'),controlPath=join(fixtureHost,'control-base.json'),bootPath=join(fixtureHost,'bootstrap.json');
writeFileSync(configPath,JSON.stringify(fixtureCfg));writeFileSync(controlPath,JSON.stringify(control));writeFileSync(bootPath,bootstrapText);
const checked=await preflight(['check',configPath,controlPath,bootPath,sha(bootstrapText),join(output,'preflight-output')]);
assert.equal(checked.report.mode,'check');assert.equal(checked.report.noNetworkDuringPreflight,true);assert.equal(checked.report.noDatabaseDuringPreflight,true);assert.equal(checked.report.runtime.archiveSmoke.passed,true);assert(!existsSync(join(output,'preflight-output','launch-intent.json')));
const reportBytes=readFileSync(checked.reportPath);assert.equal(reportBytes.at(-1),0x0a);assert(!reportBytes.subarray(-2).equals(Buffer.from('\\n')));assert.equal(JSON.parse(reportBytes.toString()).localChecksPassed,true);
pass('Actual preflight check creates parseable report ending 0a after local archive smoke',{path:checked.reportPath,finalByteHex:reportBytes.subarray(-1).toString('hex'),sha256:sha(reportBytes)});
// Exercise the actual binder with invented owner/readback values, only into an isolated prepared directory.
const ownerTemplate=JSON.parse(readFileSync(join(host,'owner-binding-input.template.json'),'utf8'));
const ownerInput={...ownerTemplate,candidate,databaseIdentity};
const ownerInputPath=join(output,'synthetic-owner-input.json'),readbackPath=join(output,'synthetic-registration-readback.json');
writeFileSync(ownerInputPath,JSON.stringify(ownerInput));writeFileSync(readbackPath,JSON.stringify({candidateRow}));
const binder=(ownerFile:string,readbackFile:string,preparedPath:string)=>execFileSync(cfg.node,['--import',join(cfg.repo,'node_modules/tsx/dist/loader.mjs'),join(host,'runtime/prepare-owner-binding.mts'),ownerFile,readbackFile,preparedPath],{cwd:cfg.repo,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,JOBFINDER_CLOUD_SOURCE_ID:cfg.sourceId,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',PYTHONDONTWRITEBYTECODE:'1',GIT_OPTIONAL_LOCKS:'0'}});
const preparedPath=join(output,'synthetic-prepared-binding');const prepared=JSON.parse(binder(ownerInputPath,readbackPath,preparedPath));
assert.equal(prepared.classification,'OWNER_BINDING_PREPARED_NOT_ACTIVATED');assert.equal(prepared.registrationPerformed,false);assert.equal(prepared.sqlExecuted,false);assert.equal(prepared.activationWritten,false);
assert.equal(existsSync(join(preparedPath,'host/activation.json')),false);const preparedActivation=JSON.parse(readFileSync(join(preparedPath,'host/activation.prepared.json'),'utf8'));assert.equal(preparedActivation.status,'PREPARED_NOT_ACTIVATED');
assert.equal(readFileSync(join(preparedPath,'host/context-read.sql'),'utf8'),context);assert.equal(prepared.contextReadSha256,sha(context));
assert.equal(readFileSync(join(preparedPath,'host/runtime/load-host-state.js'),'utf8'),loader);assert.equal(readFileSync(join(preparedPath,'supervision/start-monitor-novartis-next-combined.js'),'utf8'),syntheticStarter);
for(const item of prepared.files){const bytes=readFileSync(join(preparedPath,item.path));assert.equal(bytes.length,item.bytes);assert.equal(sha(bytes),item.sha256);}
pass('Actual binder validates synthetic registration tuple and emits hashed PREPARED_NOT_ACTIVATED files only',{path:preparedPath});
let negativeIndex=0;
for(const [name,mutate] of [
 ['null candidate',(o:any)=>{o.candidate=null;}],['version51',(o:any)=>{o.candidate.version=52;}],['missing DB binding',(o:any)=>{o.databaseIdentity=null;}],['old build',(o:any)=>{o.build.commitSha='28402a299bb04cbf5873da66c2fe8ca76827c0d1';}],['wrong content hash',(o:any)=>{o.build.contentSha256='0'.repeat(64);}],['unrecognized owner field',(o:any)=>{o.unapproved=true;}]
] as const){const o=structuredClone(ownerInput);mutate(o);const op=join(output,'negative-owner-'+negativeIndex+'.json'),dest=join(output,'rejected-owner-'+negativeIndex++);writeFileSync(op,JSON.stringify(o));assert.throws(()=>binder(op,readbackPath,dest));assert(!existsSync(dest));pass('Binder rejects '+name+' before preparing output');}
for(const field of ['id','goalId','version','commitSha','migrationVersion','schemaHash','dbSnapshotHash','rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash','sourceTreeHash','runtimeTreeHash','minimumStableCompanyCount','oracleVersion','status']){
 const row=structuredClone(candidateRow) as any;row[field]=typeof row[field]==='number'?row[field]+1:String(row[field])+'-wrong';
 const rp=join(output,'negative-readback-'+negativeIndex+'.json'),dest=join(output,'rejected-readback-'+negativeIndex++);writeFileSync(rp,JSON.stringify({candidateRow:row}));assert.throws(()=>binder(ownerInputPath,rp,dest));assert(!existsSync(dest));pass('Binder rejects readback '+field+' mismatch before preparing output');
}
const preparedManifestBefore=sha(readFileSync(join(preparedPath,'PREPARED_BINDING_MANIFEST.json')));assert.throws(()=>binder(ownerInputPath,readbackPath,preparedPath));assert.equal(sha(readFileSync(join(preparedPath,'PREPARED_BINDING_MANIFEST.json'))),preparedManifestBefore);pass('Binder refuses overwriting an existing prepared output');
for(const name of protectedNames)assert.equal(existsSync(join(host,name))?sha(readFileSync(join(host,name))):null,protectedBefore[name]);pass('Host activation, control, config and context bytes unchanged');
const git=execFileSync('git',['status','--porcelain'],{cwd:cfg.repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});assert.equal(git,'');pass('Frozen producer remains git-clean');
const report={qualification:false,syntheticOnly:true,noExternalHttp:true,noDatabase:true,noLaunch:true,sourceHostUnchanged:true,build,syntheticCandidate:candidate,syntheticDatabaseIdentity:databaseIdentity,output,passed:results.length,results};
writeFileSync(join(output,'OWNER_GATE_RESULTS.json'),JSON.stringify(report,null,2)+'\n');writeFileSync(join(import.meta.dirname,'OWNER_GATE_RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:results.length,output,report:join(output,'OWNER_GATE_RESULTS.json')}));
