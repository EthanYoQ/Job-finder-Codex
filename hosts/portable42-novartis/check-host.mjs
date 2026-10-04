// Novartis-only local host preparation/check; no production collection or publication.
import { readFile, writeFile, mkdir, readdir, statfs, open, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const base='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z';
const root=join(base,'hosts/portable42-novartis'),repo=join(base,'producer-source'),runtime=join(root,'runtime');
const selections={novartis:'source-novartis-social'};
const key=process.argv[2],sourceId=selections[key];
if(!sourceId||process.env.JOBFINDER_CLOUD_SOURCE_ID!==sourceId)throw Error('CHECK_SOURCE_SELECTION');
globalThis.fetch=async()=>{throw Error('CHECK_NETWORK_FORBIDDEN');};
const host=join(root,key),cfg=JSON.parse(await readFile(join(host,'host-config.json'))),control=JSON.parse(await readFile(join(host,'control-base.json')));
const sha=v=>createHash('sha256').update(v).digest('hex');
const checks=[];
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
for(const file of [join(host,'host-helper-functions.js'),join(host,'host-stage-functions.js'),...['load-host-state.js','start-monitor-portable42.js','continuous-relay-v3-durable-monitor.js','load-portable42-runtime.js'].map(n=>join(runtime,n))]){
  new AsyncFunction('root','sourceId','candidateId','commit','sourceKey',await readFile(file,'utf8'));
  checks.push({check:'functions.exec fragment syntax',path:file,passed:true});
}
for(const file of ['host-files.mts','relay-files.mjs','archive-transfer.mjs'].map(n=>join(host,n))){
  execFileSync(process.execPath,['--check',file],{encoding:'utf8',timeout:15000});
  checks.push({check:'node --check',path:file,passed:true});
}
const fromRepo=path=>import(pathToFileURL(join(repo,path)).href);
const portable=await fromRepo('scripts/p0-cloud-portable-source-pilot.ts');
const source=await fromRepo('scripts/p0-cloud-source-pilot.ts');
const {CLOUD_PILOT_SOURCE,compileCloudPilotPublicationContextSql}=await fromRepo('src/db/cloudPilotSqlControl.ts');
const {SOURCE_QUALITY_POLICY_ID}=await fromRepo('src/crawler/sourceQualityAdmission.ts');
const {archiveSourceEvidence,verifyArchivedSourceEvidence}=await fromRepo('src/crawler/artifactArchive.ts');
if(typeof portable.runCloudPortableSourcePilot!=='function'||source.PILOT_SOURCE!==sourceId||CLOUD_PILOT_SOURCE.sourceConfigSha256!==cfg.sourceConfigSha256)throw Error('CHECK_PORTABLE_IMPORT_BINDING');
checks.push({check:'frozen portable pilot import and exact source identity, no main',passed:true});
const {expiresAt,...currentControl}=control;
const canonicalSql=compileCloudPilotPublicationContextSql(currentControl,SOURCE_QUALITY_POLICY_ID)+'\n';
if(await readFile(join(host,'novartis-context-read.sql'),'utf8')!==canonicalSql)throw Error('CHECK_CONTEXT_COMPILER_BYTES');
if(!canonicalSql.includes('plan-bound-source-quality-v1')||!canonicalSql.includes(SOURCE_QUALITY_POLICY_ID)||!canonicalSql.includes(sourceId)||!canonicalSql.includes(control.candidate.id))throw Error('CHECK_CONTEXT_POLICY_SCOPE');
checks.push({check:'portable READ_CONTEXT SQL equals current compiler output; not executed',passed:true,sha256:sha(canonicalSql)});
const servierHelper=await readFile(join(base,'hosts/servier/host-helper-functions.js'),'utf8');
if(await readFile(join(host,'host-helper-functions.js'),'utf8')!==servierHelper.replaceAll('source-servier-china-social',sourceId))throw Error('CHECK_HELPER_BEHAVIOR_CHANGED');
const monitor=await readFile(join(runtime,'continuous-relay-v3-durable-monitor.js'));
if(!monitor.equals(await readFile(join(base,'host-runtime/continuous-relay-v3-durable-monitor.js'))))throw Error('CHECK_MONITOR_CHANGED');
checks.push({check:'restored helper timing/unknown-write behavior and V3 durable monitor preserved',passed:true,monitorSha256:sha(monitor)});
const {preflight,writableDirectory}=await import(pathToFileURL(join(runtime,'preflight/preflight-launch.mjs')).href);
// Preserve the actual old read timestamp. This fixture is deliberately stale and never launch authority.
const historical=JSON.parse(await readFile(join(base,'hosts/servier/dot-servier-b-20261004T0847Z-fb0b8e3/bootstrap.json')));
const fixture={schemaVersion:1,checkedAt:historical.checkedAt,candidateRows:historical.candidateRows,batchId:'non-qualifying-local-preparation-'+key};
const fixturePath=join(host,'NON_QUALIFYING_BOOTSTRAP.json'),fixtureBytes=JSON.stringify(fixture)+'\n';
await writeFile(fixturePath,fixtureBytes,{flag:'wx',mode:0o600});
const run=join(host,'preparation-check');
const checked=await preflight(['check',join(host,'host-config.json'),join(host,'control-base.json'),fixturePath,sha(fixtureBytes),run]);
if(!checked.report.localChecksPassed||checked.report.launchPermitted||checked.report.bootstrapFresh)throw Error('CHECK_STALE_FIXTURE_LAUNCH_AUTHORITY');
checks.push({check:'original restored preflight check with intentionally stale historical bootstrap',passed:true,launchPermitted:false,reportPath:checked.reportPath});
const directories=[root,runtime,join(runtime,'preflight'),host,run,...['artifacts','relay','preflight'].map(n=>join(run,n))];
for(const directory of directories){
  await writableDirectory(directory);
  const path=join(directory,'.roundtrip-'+randomUUID()),bytes=Buffer.from('NON_QUALIFYING_LOCAL_WRITE_READ_HASH_CHECK');
  const handle=await open(path,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  if(sha(await readFile(path))!==sha(bytes))throw Error('CHECK_DIRECTORY_ROUNDTRIP_HASH');
  await unlink(path);
  const fs=await statfs(directory);
  checks.push({check:'directory writable write/read/hash',path:directory,passed:true,availableBytes:Number(fs.bavail)*Number(fs.bsize)});
}
// Exercise the actual artifacts directory, in addition to preflight's retained local archive sample.
const id='local-preparation-archive-'+randomUUID();
const request={workspaceRoot:join(run,'artifacts'),releaseCandidateId:id,batchId:id,sourceId:'startup-diagnostic-only',sourceResultId:id,evidenceSubdirectory:'startup-diagnostic',captureTool:{name:'local-preparation-diagnostic',version:'1'},artifacts:[{id,logicalKey:'non-qualifying-local-sample',kind:'ATS_API_RESPONSE',requestedUrl:'https://example.invalid/local-preparation',finalUrl:'https://example.invalid/local-preparation',httpStatus:200,contentType:'application/json',capturedAt:new Date().toISOString(),body:'{"purpose":"NON_QUALIFYING_LOCAL_DIAGNOSTIC","jobs":[]}',extractorLocator:'LOCAL_DIAGNOSTIC_ONLY'}]};
const archive=await archiveSourceEvidence(request),verified=await verifyArchivedSourceEvidence({...request,artifacts:archive.artifacts});
if(verified.length!==1)throw Error('CHECK_ARTIFACT_ARCHIVE');
checks.push({check:'actual preparation artifacts-directory archive write/read/hash',passed:true,path:verified[0].path,sha256:verified[0].sha256,qualification:false});
const gitOptions={cwd:repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}};
if(execFileSync('git',['status','--porcelain'],gitOptions).trim())throw Error('CHECK_DIRTY_PRODUCER');
if(execFileSync('git',['rev-parse','HEAD'],gitOptions).trim()!==control.build.commitSha)throw Error('CHECK_PRODUCER_HEAD');
checks.push({check:'frozen producer clean and exact commit',passed:true});
const report={schemaVersion:1,checkedAt:new Date().toISOString(),sourceId,sourceConfigSha256:cfg.sourceConfigSha256,passed:true,scope:'LOCAL_SYNTAX_IMPORT_COMPILER_AND_ARCHIVE_PREFLIGHT_ONLY',networkAccessed:false,databaseAccessed:false,producerLaunched:false,producerModified:false,fullTestSuiteRun:false,fullBuildRun:false,launchAuthorizedByThisReport:false,checks};
await writeFile(join(host,'CHECK_RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({sourceId,passed:true,count:checks.length,reportPath:join(host,'CHECK_RESULTS.json'),launched:false,databaseAccessed:false}));
