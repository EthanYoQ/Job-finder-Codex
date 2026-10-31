import {readFile, writeFile, mkdir, readdir, access} from 'node:fs/promises';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash, randomUUID} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createInstaboxDatabase, INSTABOX_APP_ROOT} from './instabox-postgres.mjs';
import {createPostgresStage} from './postgres-stage.mjs';
import {exportVerifiedSnapshot} from './verified-snapshot.mjs';

const exec = promisify(execFile), AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const RELAY = 'original-relay-automation-20261017T0609Z', RECOVERY = 'takeda-original-recovery-20261017T0417Z';
const PACKAGE = 'five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller';
const localRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value), {mode: 0o600});
const literal = value => "'" + value.replaceAll("'", "''") + "'";
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const digest = value => createHash('sha256').update(value).digest('hex');
const folders = {abbvie:'abbvie',amgen:'amgen',astellas:'astellas',astrazeneca:'astrazeneca','bayer-healthcare':'bayer',biogen:'biogen',bms:'bms','boehringer-ingelheim':'boehringer-ingelheim','cr-pharma':'cr-pharma',csl:'csl',cspc:'cspc',cttq:'cttq','daiichi-sankyo':'daiichi-sankyo','fosun-pharma':'fosun',gilead:'gilead',grifols:'grifols',gsk:'gsk',hansoh:'hansoh',hengrui:'hengrui','johnson-innovative-medicine':'jnj',kelun:'kelun',lilly:'lilly',merck:'merck',msd:'msd',novartis:'novartis','novo-nordisk':'novo-nordisk',organon:'organon',pfizer:'pfizer',qilu:'qilu',roche:'roche',sanofi:'sanofi',servier:'servier','shanghai-pharma':'shanghai-pharma',takeda:'takeda',ucb:'ucb',viatris:'viatris'};
const folderFor = id => folders[id.replace(/^source-/, '').replace(/-social$/, '').replace(/-china$/, '')];
// Exact persistent reasons from the current original entry; imported holds can only add.
export const FIXED_HOLDS = Object.freeze({
 'source-servier-china-social':'EXPIRED_20261030_APPROVAL_UNKNOWN_READONLY',
 'source-pfizer-china-social':'EXPIRED_20261030_APPROVAL_UNKNOWN_READONLY',
 'source-hengrui-social':'EXPIRED_20261030_APPROVAL_UNKNOWN_READONLY',
 'source-cttq-social':'UNRESOLVED_20261028_BATCH_READONLY',
 'source-novo-nordisk-china-social':'EXPIRED_20261029_DIRECT_JOB_VERIFICATION_UNKNOWN_READONLY',
 'source-abbvie-china-social':'PUBLICATION_REVIEW_REJECTED_20261030',
 'source-astellas-china-social':'PUBLICATION_REVIEW_REJECTED_20261030',
 'source-kelun-social':'PUBLICATION_REVIEW_REJECTED_20261030',
 'source-astrazeneca-social':'SOURCE_ACCESS_REVIEW_REJECTED_20261030',
 'source-bayer-healthcare-social':'SOURCE_ACCESS_REVIEW_REJECTED_20261030',
 'source-daiichi-sankyo-china-social':'SOURCE_ACCESS_REVIEW_REJECTED_20261030',
 'source-fosun-pharma-social':'SOURCE_ACCESS_REVIEW_REJECTED_20261030',
 'source-gilead-china-social':'SOURCE_ACCESS_REVIEW_REJECTED_20261030',
 'source-gsk-china-social':'SOURCE_ACCESS_REVIEW_REJECTED_20261030',
 'source-hansoh-social':'SOURCE_ACCESS_REVIEW_REJECTED_20261030',
 'source-merck-china-social':'MAIN_DEPLOYMENT_UNRESOLVED',
 'source-organon-china-social':'BACKUP_TREE_UNKNOWN_NOT_ENABLED',
 'source-sanofi-china-social':'BACKUP_TREE_UNKNOWN_NOT_ENABLED'
});
const browserSources = new Set(['cspc','boehringer-ingelheim','jnj','sanofi','bayer','servier','pfizer']);
const required = [RELAY+'/automatic-relay-functions.js', RELAY+'/reader-before-functions.js',
 RELAY+'/review-original-publication.mjs', RECOVERY+'/capture-simple-guard.py',
 RECOVERY+'/offline-checkers/original-portable-sql-review.mts', RECOVERY+'/offline-checkers/original-portable-reader-replay.mts',
 RECOVERY+'/offline-checkers/replay-original-json-archive.mts', RECOVERY+'/offline-checkers/project-original-target-api.mts',
 PACKAGE+'/vendor/c60-source/node_modules/tsx/dist/loader.mjs', PACKAGE+'/vendor/c60-source/node_modules/pg/package.json',
 'connector-host-runtime/node', 'migration-state.json'];

/** Read-only; no Docker, DB, process launch, credential loading, or directory creation. */
export async function checkInstallation(root = INSTABOX_APP_ROOT, catalogRoot = localRoot) {
 const routes = (await json(join(catalogRoot, RELAY, 'sources.json'))).rows;
 if (routes.length !== 36 || new Set(routes.map(r=>r.sourceId)).size !== 36 || routes.some(r=>!folderFor(r.sourceId))) throw Error('MIGRATION_36_SOURCE_CATALOG_REQUIRED');
 const blockers = [];
 for (const relative of required) {
  try {
   await access(join(root, relative));
   if (/\.(?:mjs|mts|py|js)$/.test(relative) && (await readFile(join(root, relative), 'utf8')).includes('/workspace/scratch/5e9614251709')) {
    blockers.push({code:'MIGRATION_PATH_PORT_REQUIRED', file:relative});
   }
  } catch (error) { if (error.code==='ENOENT') blockers.push({code:'MIGRATION_DEPENDENCY_MISSING',file:relative}); else throw error; }
 }
 for(const row of routes) {
  if(FIXED_HOLDS[row.sourceId]||browserSources.has(folderFor(row.sourceId)))continue;
  const directory=join(root,RECOVERY,folderFor(row.sourceId));
  try {
   const [control,config,selector]=await Promise.all(['control-base.json','host-config.json','binding-selector.json'].map(name=>json(join(directory,name))));
   if(!control.candidate?.id?.startsWith('instabox-')||config.sourceId!==row.sourceId||config.sourceConfigSha256!==row.sourceConfigSha256||config.route!==row.route||!/^[a-f0-9]{64}$/.test(selector.sha256??''))blockers.push({code:'MIGRATION_NEW_SOURCE_BINDING_REQUIRED',sourceId:row.sourceId});
  } catch(error) {if(error.code==='ENOENT')blockers.push({code:'MIGRATION_SOURCE_BINDING_MISSING',sourceId:row.sourceId});else throw error;}
 }
 return {mode:'CHECK_ONLY', target:INSTABOX_APP_ROOT, sourceCount:routes.length,
  sources:routes.map(row=>({sourceId:row.sourceId,route:row.route,hold:FIXED_HOLDS[row.sourceId]??null,
   browserAdapterRequired:browserSources.has(folderFor(row.sourceId))})),blockers};
}

export async function pendingRequests(root) {
 const dirs = [join(root,'connector-host-task/relay')];
 try { for (const name of await readdir(join(root,'rounds'))) if (/^round-[a-f0-9]{32}$/.test(name)) dirs.push(join(root,'rounds',name,'connector-host-task/relay')); }
 catch (error) { if(error.code!=='ENOENT') throw error; }
 for(const dir of dirs) {
  let names; try {names=await readdir(dir);} catch(error) {if(error.code==='ENOENT')continue;throw error;}
  if(names.some(name=>name.endsWith('.request.ready')&&!names.includes(name.replace('.request.ready','.response.json')))) throw Error('PRIOR_ROUND_RECONCILE_ONLY');
  for(const name of names.filter(name=>name.endsWith('.response.json'))) {
   const response=await json(join(dir,name));
   if(response.kind==='PUBLISH'&&response.result?.outcome==='UNKNOWN')throw Error('PRIOR_ROUND_RECONCILE_ONLY');
  }
 }
}

function nativeHost({root, sourceId, bindingSha256, mode, roundId}) {
 const repo=join(root,PACKAGE,'vendor/c60-source'), hostRoot=join(repo,'ops/cloud-pilot-host');
 const env={...process.env, JOBFINDER_CONNECTOR_HOST_SHA256:bindingSha256, JOBFINDER_CLOUD_SOURCE_ID:sourceId, JOBFINDER_CONNECTOR_ROUND_ID:roundId};
 delete env.JOBFINDER_POSTGRES_PASSWORD;
 const cfg={project:'yiopvxysxrtrnvqxwgbx',sourceId,root:hostRoot,repo,mode};
 const command=async(script,args)=>JSON.parse((await exec('python3',['-I',join(hostRoot,'connector-host-launch.py'),script,...args],{env,cwd:repo,maxBuffer:32*1024*1024,timeout:60_000})).stdout);
 const relay=join(root,'rounds',roundId,'connector-host-task/relay');
 return {cfg,q:quote,binding:()=>command('host-files.mts',['connector-validate']),
  cmd:async text=>{
   const prefix='node '+quote(join(hostRoot,'host-files.mts'))+' ';
   if(!text.startsWith(prefix))throw Error('HOST_COMMAND_SCOPE');
   return (await exec('/bin/sh',['-c','python3 -I '+quote(join(hostRoot,'connector-host-launch.py'))+' host-files.mts '+text.slice(prefix.length)],{env,cwd:repo,maxBuffer:32*1024*1024,timeout:60_000})).stdout;
  },
  next:async directory=>{if(directory!==relay)throw Error('MIGRATION_SCOPE_MISMATCH');const rows=await command('relay-files.mjs',['next-meta',directory]);if(rows.length>1)throw Error('HOST_MULTIPLE_PENDING_REQUESTS');if(!rows.length)return;return {...await json(join(directory,rows[0].requestId+'.request.json')),...rows[0]};},
  pendingMetadata:directory=>command('relay-files.mjs',['next-meta',directory]),
  mark:(r,directory)=>command('relay-files.mjs',['mark-dispatch',directory,r.requestId,r.requestSha256]),
  respond:async(r,directory,result)=>{const file=join(directory,r.requestId+'.host-result.json');await writeFile(file,JSON.stringify({requestId:r.requestId,requestSha256:r.requestSha256,result}),{flag:'wx',mode:0o600});await command('relay-files.mjs',['respond',directory,file]);}
 };
}

export function sessionWindow(deadline, now=Date.now()) {
 if(typeof deadline!=='string'||!/(Z|[+]00:00)$/.test(deadline))throw Error('MIGRATION_SESSION_DEADLINE_REQUIRED');
 const end=Date.parse(deadline);
 if(!Number.isFinite(end)||end<=now||end>now+8*60*60*1000)throw Error('MIGRATION_SESSION_DEADLINE_INVALID');
 return end;
}
const SOURCE_RESERVE_MS=(30+20)*60*1000;

export async function runRound({passwordProvider,sessionDeadline}) {
 const roundStartedAt=Date.now(),sessionEnd=sessionWindow(sessionDeadline,roundStartedAt);
 const B=INSTABOX_APP_ROOT, D=join(B,RELAY), R=join(B,RECOVERY), P=join(B,PACKAGE), V=join(P,'vendor/c60-source'), N=join(B,'connector-host-runtime/node');
 const check=await checkInstallation(B,B);
 const globalBlockers=check.blockers.filter(row=>!['MIGRATION_SOURCE_BINDING_MISSING','MIGRATION_NEW_SOURCE_BINDING_REQUIRED'].includes(row.code));
 if(globalBlockers.length)throw Error('MIGRATION_INSTALLATION_BLOCKED:'+JSON.stringify(globalBlockers));
 const imported=await json(join(B,'migration-state.json'));
 if(!imported.holds||typeof imported.holds!=='object'||Array.isArray(imported.holds)||!Array.isArray(imported.unresolvedRequests))throw Error('MIGRATION_HOLD_STATE_IMPORT_REQUIRED');
 if(imported.unresolvedRequests.length)throw Error('LEGACY_UNKNOWN_RECONCILE_ONLY');
 await pendingRequests(B);
 for(const pid of await readdir('/proc')) {
  if(!/^\d+$/.test(pid))continue;
  let command;try{command=await readFile('/proc/'+pid+'/cmdline','utf8');}catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
  if(command.split('\0').some(arg=>['/run-with-http-diagnostics.mjs','/p0-cloud-portable-source-pilot.ts','/p0-cloud-source-pilot.ts'].some(suffix=>arg.endsWith(suffix))))throw Error('EXISTING_CLOUD_PRODUCER_RECONCILE_ONLY');
 }
 const [{default:pg},{PrismaClient}]=await Promise.all([import(pathToFileURL(join(V,'node_modules/pg/lib/index.js'))),import(pathToFileURL(join(V,'node_modules/@prisma/client/default.js')))]);
 const database=createInstaboxDatabase({Client:pg.Client,PrismaClient,passwordProvider});
 if(typeof database.createReaderDatabase!=='function')throw Error('MIGRATION_READER_DATABASE_ADAPTER_REQUIRED');
 const sql=async query=>{const result=await database.executeSql(query);if(result.status!=='SUCCEEDED')throw Error(result.code);return result.rows;};
 const routes=(await json(join(D,'sources.json'))).rows;
 const states=await sql(`SELECT requested.id AS "sourceId",clock_timestamp() AS "checkedAt",(SELECT o."crawledAt" FROM public."CrawlObservation" o JOIN public."CrawlBatchSourceResult" r ON r.id=o."sourceResultId" JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE o."sourceId"=requested.id AND o.successful AND r."atomicCommitState"='COMMITTED' AND b.status::text='SUCCESS' ORDER BY o."crawledAt" DESC LIMIT 1) AS "crawledAt",(SELECT CASE WHEN "heartbeatAt">clock_timestamp()-interval '300 seconds' THEN "holderId" ELSE '' END FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS holder,(SELECT count(*) FROM public."CrawlBatch" WHERE status::text='RUNNING' AND "heartbeatAt">clock_timestamp()-interval '300 seconds') AS running,(SELECT count(*) FROM public."ManualCrawlRequest" WHERE status::text='RUNNING' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt">clock_timestamp())) AS manual FROM unnest(ARRAY[${routes.map(r=>literal(r.sourceId)).join(',')}]::text[]) requested(id)`);
 const stateById=new Map(states.map(row=>[row.sourceId,row]));
 if(stateById.size!==36)throw Error('MIGRATION_SOURCE_STATE_INCOMPLETE');
 const slotStartMs=Math.floor(new Date(states[0].checkedAt).getTime()/43200000)*43200000;
 const slotStart=new Date(slotStartMs).toISOString(),slotEnd=new Date(slotStartMs+43200000).toISOString();
 const roundId='round-'+randomUUID().replaceAll('-',''),relay=join(B,'rounds',roundId,'connector-host-task/relay');
 await mkdir(relay,{recursive:true,mode:0o700});
 await save(join(B,'rounds',roundId,'round.json'),{startedAt:new Date(roundStartedAt).toISOString(),sessionDeadline});
 const {runOriginalSerial}=await new AsyncFunction(await readFile(join(D,'automatic-relay-functions.js'),'utf8'))();
 const readers=await new AsyncFunction(await readFile(join(D,'reader-before-functions.js'),'utf8'))();
 await mkdir(join(B,'snapshots'),{recursive:true,mode:0o700});
 const readerDb=await database.createReaderDatabase();
 try { const results=await runOriginalSerial(routes.map(r=>r.sourceId),async sourceId=>{
  const row=routes.find(r=>r.sourceId===sourceId),state=stateById.get(sourceId),folder=folderFor(sourceId),S=join(R,folder);
  if(Date.now()>=slotStartMs+43200000)throw Error('SCHEDULE_SLOT_ENDED');
  const hold=FIXED_HOLDS[sourceId]??imported.holds[sourceId];if(hold)throw Error('PENDING_USER_DECISION:'+hold);
  if(state.holder||Number(state.running)||Number(state.manual))throw Error('EXISTING_WRITER_RECONCILE_ONLY');
  if(state.crawledAt&&new Date(state.crawledAt).getTime()>=slotStartMs)return {skip:'REAL_OBSERVATION_IN_SCHEDULE_SLOT:'+slotStart};
  if(browserSources.has(folder))throw Error('MIGRATION_BROWSER_ADAPTER_REQUIRED');
  if(Date.now()+SOURCE_RESERVE_MS>=sessionEnd)return {skip:'SESSION_WINDOW_ENDING_NO_NEW_SOURCE'};
  const [config,control,selector]=await Promise.all(['host-config.json','control-base.json','binding-selector.json'].map(name=>json(join(S,name))));
  if(!control.candidate.id.startsWith('instabox-')||config.sourceId!==sourceId||config.sourceConfigSha256!==row.sourceConfigSha256||config.route!==row.route)throw Error('MIGRATION_NEW_SOURCE_BINDING_REQUIRED');
  const host=nativeHost({root:B,sourceId,bindingSha256:selector.sha256,mode:config.mode,roundId});
  const stage=createPostgresStage({host,database,scope:{roundId,candidateId:control.candidate.id,buildContentSha256:control.build.contentSha256}});
  await host.binding();if(await host.next(relay))throw Error('EXISTING_RELAY_RECONCILE_ONLY');
  const template=await readFile(join(R,'transport/viatris-reader-before-original.sql'),'utf8');
  const query=template.replaceAll('__ORIGINAL_COMPACT_CERTIFICATE_SCHEMA__','').replaceAll('__ORIGINAL_COMPACT_LEGACY_GUARD__','false AND ').replaceAll('__ORIGINAL_CERTIFICATE_SCHEMA__',row.route==='PORTABLE'?'plan-bound-source-quality-v1':row.route==='TRUE_A'?'a-grade-official-total-v2':'b-grade-independent-traversal-v2').replaceAll('__ORIGINAL_REQUIRES_PORTABLE_POLICY__',String(row.route==='PORTABLE')).replaceAll('source-viatris-social',sourceId).replaceAll('company-viatris',row.companyId).replaceAll('5eab6bd8ba6973176376f492b9ce2105d81d8cae5afd4d3518daa6ad3dfcdad9',config.sourceConfigSha256).replaceAll('dot-cloud-native-c2b39d9-20261016',control.candidate.id).replaceAll('viatris-reader-before-v1',folder+'-reader-before-v1');
  let readAttempted=false;
  const readPreCaptureContext=async request=>{if(readAttempted)throw Error('PRE_CAPTURE_READ_ALREADY_ATTEMPTED');readAttempted=true;const before=await readers.readOriginalReaderBeforeSingle(query,q=>{if(Date.now()>=Date.parse(request.expiresAt))throw Error('PRE_CAPTURE_READ_EXPIRED');return sql(q);});await save(join(S,'READER_BEFORE.json'),before);await save(join(S,'expected-candidate.json'),before.publicationContext.candidateRow);return before.publicationContext;};
  const batchId='dot-auto-'+folder+'-'+randomUUID(),run=join(S,batchId);await mkdir(join(run,'artifacts'),{recursive:true,mode:0o700});
  const [fresh]=await sql(`SELECT clock_timestamp() AS "checkedAt",to_jsonb(r) AS candidate FROM public."ReleaseCandidate" r WHERE id=${literal(control.candidate.id)}`);if(!fresh?.candidate)throw Error('CANDIDATE_MISSING');
  const bootstrap=JSON.stringify({schemaVersion:1,checkedAt:new Date(fresh.checkedAt).toISOString(),candidateRows:[fresh.candidate],batchId});await writeFile(join(run,'bootstrap.json'),bootstrap,{flag:'wx',mode:0o600});
  const env={...process.env,PYTHONDONTWRITEBYTECODE:'1',TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1',JOBFINDER_CLOUD_SOURCE_ID:sourceId,JOBFINDER_CONNECTOR_ROUND_ID:roundId};
  delete env.JOBFINDER_POSTGRES_PASSWORD;
  if(Date.now()+SOURCE_RESERVE_MS>=sessionEnd)return {skip:'SESSION_WINDOW_ENDING_NO_NEW_SOURCE'};
  const outerDeadline=Date.now()+1800000;
  const child=spawn('python3',[join(R,'capture-simple-guard.py'),'--',N,join(V,'scripts/run-with-http-diagnostics.mjs'),join(run,'diagnostics'),'1800000','--',N,'--import',join(V,'node_modules/tsx/dist/loader.mjs'),join(V,'scripts',row.route==='PORTABLE'?'p0-cloud-portable-source-pilot.ts':'p0-cloud-source-pilot.ts'),join(run,'bootstrap.json'),digest(bootstrap),join(run,'artifacts'),relay,'--db-started-control',join(S,'control-base.json')],{env,cwd:V,stdio:['ignore','pipe','pipe']});
  let terminal=false,exitCode=null,output='';const capture=data=>{output=(output+data.toString()).slice(-64000);};child.stdout.on('data',capture);child.stderr.on('data',capture);
  child.once('error',()=>{terminal=true;exitCode=1;});child.once('close',(code)=>{terminal=true;exitCode=code??1;});
  return {sourceId,stage,runDirectory:run,relayDirectory:relay,deadline:outerDeadline,readPreCaptureContext,
   checkpoint:requestIds=>save(join(run,'relay-checkpoint.json'),{sourceId,batchId,requestIds,relayDirectory:relay}),
   pollProducer:async()=>{let outcome;if(terminal&&exitCode===0)outcome=await json(join(run,'artifacts',batchId+'.outcome.json'));return {exitCode:terminal?exitCode:null,outcomeState:outcome?.state,diagnostic:output};},
   reviewPublication:async(request,prepared,contextId)=>{const {stdout}=await exec(N,['--import',join(V,'node_modules/tsx/dist/loader.mjs'),join(D,'review-original-publication.mjs'),run,request.requestId,relay,contextId??''],{env,cwd:V,maxBuffer:16*1024*1024,timeout:Math.max(1,Math.min(outerDeadline,Date.parse(request.payload.dispatchBefore))-Date.now())});const reviewed=JSON.parse(stdout.trim().split('\n').at(-1));const [recent]=await sql(`SELECT clock_timestamp()<${literal(slotEnd)}::timestamptz AS "sameSlot",EXISTS(SELECT 1 FROM public."CrawlObservation" o JOIN public."CrawlBatchSourceResult" r ON r.id=o."sourceResultId" JOIN public."CrawlBatch" b ON b.id=r."batchId" WHERE o."sourceId"=${literal(sourceId)} AND o.successful AND r."atomicCommitState"='COMMITTED' AND b.status::text='SUCCESS' AND o."crawledAt">=${literal(slotStart)}::timestamptz AND o."crawledAt"<${literal(slotEnd)}::timestamptz) AS fresh`);if(!recent.sameSlot||recent.fresh)throw Error('SCHEDULE_SLOT_OR_NEW_SUCCESS');return reviewed;},
   readback:async()=>{await save(join(run,'EVIDENCE_BACKUP_PENDING.json'),{status:'PENDING_DOT_UPLOAD',sourceId,batchId});const result=await exportVerifiedSnapshot({readerRoot:join(P,'vendor/reader-main'),db:readerDb,expectedFile:join(run,'review/EXPECTED_TARGET_API.json'),destination:join(B,'snapshots/public-snapshot.json')});await save(join(run,'LOCAL_SNAPSHOT_VERIFIED.json'),result);return {...result,status:'LOCAL_SNAPSHOT_VERIFIED',evidenceBackup:{status:'PENDING_DOT_UPLOAD'}};}
  };
 });
 await save(join(B,'rounds',roundId,'results.json'),{roundId,startedAt:new Date(roundStartedAt).toISOString(),finishedAt:new Date().toISOString(),sessionDeadline,results});
 return {roundId,results};
 } finally {await readerDb.$disconnect();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const mode=process.argv.slice(2);
 if(mode.length!==1||!['--check','--run'].includes(mode[0])){console.error('Usage: native-round.mjs --check | --run');process.exitCode=2;}
 else try {
  if(mode[0]==='--check')console.log(JSON.stringify(await checkInstallation(),null,2));
  else {if(!process.env.JOBFINDER_POSTGRES_PASSWORD)throw Error('MIGRATION_MACHINE_PASSWORD_REQUIRED');console.log(JSON.stringify(await runRound({passwordProvider:()=>process.env.JOBFINDER_POSTGRES_PASSWORD,sessionDeadline:process.env.JOBFINDER_SESSION_DEADLINE}),null,2));}
 } catch(error){console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message)||error.message.startsWith('MIGRATION_INSTALLATION_BLOCKED:')?error.message:'MIGRATION_RUN_FAILED');process.exitCode=1;}
}
