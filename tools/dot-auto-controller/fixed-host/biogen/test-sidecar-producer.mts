/** TEST_ONLY actual native prepare/gate/writer in a freshly installed private case. */
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {createHash,randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {FilePilotRelay} from '../../vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {initialize,configureSyntheticFixtureRuntime,fixture} from '../../connector-gate/biogen-synthetic-fixture.mts';
const [target,scenario]=process.argv.slice(2),pkg=path.resolve(import.meta.dirname,'../..');
assert(target&&path.isAbsolute(target)&&target.endsWith('/installed-disabled')&&target.includes('/lifecycle-cases/case-'));
assert.equal(pkg,path.join(target,'runtime-checkout/tools/dot-auto-controller'));assert.equal(process.cwd(),pkg);
assert(process.send&&process.connected,'REAL_FORK_IPC_REQUIRED');assert.equal(process.env.JOBFINDER_CLOUD_SOURCE_ID,'source-biogen-china-social');
const known=['success','default-unselected','wrong-source','wrong-project','wrong-build','wrong-candidate','wrong-batch','wrong-mode','wrong-relay','seed-mode','seed-symlink','existing-projections','existing-publication'];assert(known.includes(scenario));
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const deployment=fs.readdirSync(target+'/deployments').filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(target+'/deployments/'+n,'utf8'))).find(d=>d.kind==='LIVE_DEPLOYMENT');assert(deployment&&deployment.sourceId==='source-biogen-china-social');
const build=initialize({commitSha:deployment.build.commitSha,candidate:deployment.candidate,databaseIdentity:deployment.databaseIdentity});assert.deepEqual(build,deployment.build);
configureSyntheticFixtureRuntime({setClock:at=>assert(Math.abs(Date.now()-Date.parse(at))<1000),installFetch:fn=>{globalThis.fetch=fn as typeof fetch;}});
const round='round-'+randomBytes(16).toString('hex'),roundRoot=target+'/rounds/'+round,task=roundRoot+'/connector-host-task',relay=task+'/relay';
for(const p of [target+'/rounds',roundRoot,task,relay,target+'/connector-host-bindings']){if(!fs.existsSync(p))fs.mkdirSync(p,{mode:0o700});assert.equal(fs.lstatSync(p).mode&0o777,0o700);}
const f=await fixture({at:new Date().toISOString(),syntheticBatchId:'fixed-v4-'+round.slice(6),syntheticArtifactParent:roundRoot});
const control=f.input.publication.control,source=f.input.publication.source;
const binding={schemaVersion:1,kind:'NATIVE_PORTABLE_CONNECTOR_V1',enabled:true,projectId:control.projectId,sourceId:source.plan.source.id,sourceConfigSha256:source.pending.sourceConfigHash,route:'PORTABLE',publicationMode:'DB_STARTED_JOB_PROJECTION_DELTA_V1',ownerId:source.identity.ownerId,control:{projectId:control.projectId,build:control.build,candidate:control.candidate,databaseIdentity:control.databaseIdentity},lockSha256:sha(fs.readFileSync(pkg+'/vendor/c60-source/package-lock.json')),entrypointHashes:Object.fromEntries(Object.entries({producer:'scripts/p0-cloud-portable-source-pilot.ts',wrapper:'scripts/run-with-http-diagnostics.mjs',controlCompiler:'src/db/cloudPilotSqlControl.ts',publicationCompiler:'src/db/ingestionRepository.ts',dbStarted:'src/crawler/cloudDbStartedPilot.ts'}).map(([k,p])=>[k,sha(fs.readFileSync(pkg+'/vendor/c60-source/'+p))]))};
const bindingBytes=JSON.stringify(binding),selector=sha(bindingBytes),bindingPath=target+'/connector-host-bindings/'+selector+'.json';
if(!fs.existsSync(bindingPath))fs.writeFileSync(bindingPath,bindingBytes,{flag:'wx',mode:0o400});else assert.equal(fs.readFileSync(bindingPath,'utf8'),bindingBytes);
const seed:any={candidateId:control.candidate.id,buildSha256:control.build.contentSha256,sourceId:source.plan.source.id,projectId:control.projectId,batchId:source.batchId};
const expectError:Record<string,string>={'wrong-source':'FIXED_PROJECTION_SEED','wrong-project':'FIXED_PROJECTION_SEED','wrong-build':'FIXED_PROJECTION_SEED','wrong-candidate':'FIXED_PROJECTION_SEED','wrong-batch':'FIXED_PROJECTION_SEED','wrong-mode':'FIXED_PROJECTION_MODE','wrong-relay':'FIXED_PROJECTION_PATH','seed-mode':'HOST_FILE','seed-symlink':'HOST_FILE','existing-projections':'EEXIST','existing-publication':'EEXIST'};
if(scenario==='wrong-source')seed.sourceId='source-takeda-china-social';if(scenario==='wrong-project')seed.projectId='different';if(scenario==='wrong-build')seed.buildSha256='0'.repeat(64);if(scenario==='wrong-candidate')seed.candidateId='different';if(scenario==='wrong-batch')seed.batchId='different';
const seedFile=task+'/fixed-seed.json';if(scenario==='seed-symlink'){fs.writeFileSync(task+'/synthetic-seed-target.json',JSON.stringify(seed),{flag:'wx',mode:0o600});fs.symlinkSync('synthetic-seed-target.json',seedFile);}else fs.writeFileSync(seedFile,JSON.stringify(seed),{flag:'wx',mode:scenario==='seed-mode'?0o644:0o600});
const retained=Buffer.from('EXISTING SYNTHETIC EVIDENCE');let occupied:string|undefined;
if(scenario==='existing-projections'||scenario==='existing-publication'){occupied=task+(scenario==='existing-projections'?'/reviewed-projections.json':'/reviewed-publication-data.json');fs.writeFileSync(occupied,retained,{flag:'wx',mode:0o600});}
Object.assign(process.env,{JOBFINDER_CONNECTOR_ROUND_ID:round,JOBFINDER_CONNECTOR_HOST_SHA256:selector,JOBFINDER_CLOUD_SOURCE_ID:source.plan.source.id,JOBFINDER_FIXED_PROJECTION_MODE:'TEST_ONLY',JOBFINDER_OWNED_PIPE_MODE:scenario==='wrong-mode'?'LIVE':'TEST_ONLY'});
if(scenario==='default-unselected')delete process.env.JOBFINDER_FIXED_PROJECTION_MODE;
const selection={mode:'BIOGEN_OWNED_PIPE_CANDIDATE_V1' as const,launchChallenge:'a'.repeat(64)},port=new FilePilotRelay(scenario==='wrong-relay'?task+'/wrong-relay':relay);
let result:any;
if(expectError[scenario]){
 await assert.rejects(port.prepareOwnedBiogenPublish(f.input,selection),new RegExp(expectError[scenario]));if(occupied)assert.deepEqual(fs.readFileSync(occupied),retained);
 assert.equal(fs.readdirSync(relay).filter(n=>n.endsWith('.request.json')).length,0);
 if(!occupied)assert(!fs.existsSync(task+'/reviewed-publication-data.json'));
 result={passed:true,scenario,expectedError:expectError[scenario],noPublishRequests:true,existingEvidenceUnchanged:true};
}else{
 const handle=await port.prepareOwnedBiogenPublish(f.input,selection);
 if(scenario==='default-unselected'){assert(!fs.existsSync(task+'/reviewed-projections.json'));assert(!fs.existsSync(task+'/reviewed-publication-data.json'));result={passed:true,scenario,sidecarWrites:0};}
 else{
  const pbytes=fs.readFileSync(task+'/reviewed-projections.json'),publication=JSON.parse(fs.readFileSync(task+'/reviewed-publication-data.json','utf8')),projections=JSON.parse(pbytes.toString('utf8'));
  assert.equal(projections.projections.length,7);assert.equal(publication.projectionsSha256,sha(pbytes));assert.equal(publication.sql,handle.packet.sql);assert.equal(publication.sqlSha256,sha(handle.packet.sql));assert.equal(publication.sourceResult.sourceId,'source-biogen-china-social');
  for(const name of ['reviewed-projections.json','reviewed-publication-data.json','test-only-reviewed-packet.json'])assert.equal(fs.lstatSync(task+'/'+name).mode&0o777,0o600);
  const pending=port.publishOwnedBiogen(handle);let request:any;
  for(let n=0;n<500&&!request;n++){const marker=fs.readdirSync(relay).find(n=>n.endsWith('.request.ready'));if(marker){const file=relay+'/'+marker.replace(/\.ready$/,'.json');const {assertRelayRequestReady}=await import('../../vendor/c60-source/ops/cloud-pilot-host/relay-request-ready.mjs');assertRelayRequestReady(file);request=JSON.parse(fs.readFileSync(file,'utf8'));}else await delay(10);}
  assert(request,'ORIGINAL_PUBLISH_REQUEST_MISSING');assert.equal(request.kind,'PUBLISH');assert.equal(request.payload.sql,handle.packet.sql);
  // The official SQL tool is the only simulated seam: no database is contacted.
  fs.writeFileSync(relay+'/'+request.requestId+'.response.json',JSON.stringify({schemaVersion:1,requestId:request.requestId,requestSha256:request.requestSha256,kind:'PUBLISH',result:{status:'SUCCEEDED',rows:[]}}),{flag:'wx',mode:0o600});
  await pending;await assert.rejects(port.publishOwnedBiogen(handle),/RELAY_SAME_PROCESS_REVIEW_REQUIRED/);
  result={passed:true,scenario,projections:7,requestSha256:request.requestSha256,sqlSha256:sha(handle.packet.sql),originalOneShotGateConsumed:true,prepopulatedReviewedFiles:false};
 }
}
const out={...result,target,round,selector,task,build:control.build,archive:f.input.archive,realDatabaseCalls:0,realNetworkCalls:0,productionQualified:false};fs.writeFileSync(roundRoot+'/test-sidecar-result.json',JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(out));process.disconnect?.();
