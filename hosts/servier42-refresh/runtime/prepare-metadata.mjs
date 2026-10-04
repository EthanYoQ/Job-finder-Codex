import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const host=dirname(dirname(fileURLToPath(import.meta.url))),cfg=JSON.parse(await readFile(join(host,'host-config.json'))),control=JSON.parse(await readFile(join(host,'control-base.json')));
if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==cfg.sourceId||process.env.TSX_DISABLE_CACHE!=='1'||process.env.NODE_DISABLE_COMPILE_CACHE!=='1')throw Error('PREPARATION_ENV');
globalThis.fetch=async()=>{throw Error('PREPARATION_NETWORK_FORBIDDEN');};
const imp=p=>import(pathToFileURL(join(cfg.repo,p)).href),sha=b=>createHash('sha256').update(b).digest('hex');
const {createBuildIdentity}=await imp('src/readiness/buildIdentity.ts');
const {deriveCurrentStagedScheduleExpectation}=await imp('src/crawler/stagedScheduleAuthority.ts');
const {sourcePlanConfigSha256}=await imp('src/crawler/sourcePlan.ts');
const {CLOUD_PILOT_SQL45:history}=await imp('src/db/cloudPilotSql45Manifest.ts');
const {compileCloudPilotPublicationContextSql,CLOUD_PILOT_SOURCE}=await imp('src/db/cloudPilotSqlControl.ts');
const git=a=>execFileSync('git',a,{cwd:cfg.repo,encoding:'utf8',env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}}).trim();
if(git(['rev-parse','HEAD'])!==control.build.commitSha||git(['status','--porcelain']))throw Error('FROZEN_PRODUCER_CHANGED');
const build=createBuildIdentity(cfg.repo,control.build.commitSha);
if(JSON.stringify(build)!==JSON.stringify(control.build))throw Error('FROZEN_BUILD_CHANGED');
const authority=deriveCurrentStagedScheduleExpectation(build),plan=authority.plans.find(p=>p.source.id===cfg.sourceId);
if(!plan||sourcePlanConfigSha256(plan)!==cfg.sourceConfigSha256||CLOUD_PILOT_SOURCE.id!==cfg.sourceId)throw Error('CANONICAL_SOURCE_MISMATCH');
const expectedCandidate={...control.candidate,commitSha:authority.commitSha,...history.databaseIdentity,rosterHash:authority.rosterSha256,sourcePlanHash:authority.sourcePlanSha256,sourceConfigHash:authority.sourceConfigSha256,adapterBundleHash:authority.adapterBundleSha256,sourceTreeHash:authority.sourceTreeSha256,runtimeTreeHash:authority.runtimeTreeSha256,minimumStableCompanyCount:authority.minimumStableCompanyCount,oracleVersion:'staged-official-source-v1',status:'BUILDING'};
const context=compileCloudPilotPublicationContextSql(control);
const template=await readFile(join(dirname(host),'pfizer42/runtime/start-monitor-pfizer42.js'),'utf8');
const query=template.split('const query=`')[1].split('`;')[0].replace('${h.q(h.cfg.sourceId)}',"'"+cfg.sourceId+"'")
 .replace('(SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id=\'formal-crawl\') AS "holderId",',`(SELECT "holderId" FROM public."CrawlCoordinatorLock" WHERE id='formal-crawl') AS "holderId",
 (SELECT coalesce(jsonb_agg(jsonb_build_object('migrationName',migration_name,'checksum',checksum,'finishedAt',finished_at,'rolledBackAt',rolled_back_at) ORDER BY migration_name),'[]'::jsonb) FROM public."_prisma_migrations") AS "migrationRows",
 (SELECT md5(pg_get_functiondef(to_regprocedure('public.enforce_source_result_state_machine()')))) AS "sourceResultGuardMd5",
 (SELECT coalesce(jsonb_agg(jsonb_build_object('sourceResultId',s.id,'sourceId',s."sourceId",'batchId',s."batchId",'candidateId',s."releaseCandidateId",'batchCandidateId',b."releaseCandidateId",'candidateStatus',c.status,'candidateVersion',c.version,'candidateMigrationVersion',c."migrationVersion",'candidateSchemaHash',c."schemaHash",'sourceConfigHash',s."sourceConfigHash",'batchStatus',b.status,'atomicCommitState',s."atomicCommitState",'batchStartedAt',b."startedAt",'sourceStartedAt',s."startedAt",'sourceFinishedAt',s."finishedAt") ORDER BY b."startedAt",s.id),'[]'::jsonb)
  FROM public."CrawlBatchSourceResult" s JOIN public."CrawlBatch" b ON b.id=s."batchId" LEFT JOIN public."ReleaseCandidate" c ON c.id=s."releaseCandidateId" WHERE s."sourceId"='${cfg.sourceId}' AND b.status='RUNNING') AS "sameSourceRunning",`);
const dueGate=template.split('// BEGIN OBSERVATION_DUE_GATE\n')[1].split('// END OBSERVATION_DUE_GATE')[0];
await writeFile(join(host,'context-read.sql'),context,{flag:'wx'});
await writeFile(join(host,'runtime/fresh-readback.sql'),query+'\n',{flag:'wx'});
await writeFile(join(host,'runtime/observation-due-gate.js'),dueGate+'\nreturn requireObservationDue;\n',{flag:'wx'});
await writeFile(join(host,'source-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
await writeFile(join(host,'runtime/expected-database.json'),JSON.stringify({candidate:expectedCandidate,migrations:history.migrations,sourceResultGuardMd5:history.sourceResultGuardMd5},null,2)+'\n',{flag:'wx'});
await writeFile(join(host,'SPEC.json'),JSON.stringify({schemaVersion:1,status:'PREPARED_NOT_LAUNCHED',preparedAt:new Date().toISOString(),root:host,repo:cfg.repo,prefix:'servier42:',sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256,build,candidate:control.candidate,databaseIdentity:history.databaseIdentity,migrationCount:history.migrations.length,route:'B',entrypoint:'scripts/p0-cloud-source-pilot.ts',publicationMode:'DB_STARTED_OWNER_V1',currentCaptureRequired:true,independentValidationRequired:true,mainFreshnessMs:1800000,independentCurrentRunMs:3600000,sourceDueMs:43200000,bootstrapMaxAgeMs:60000,publicationReserveMs:165000,contextCompletionReserveMs:25000,priorNextEligibleAtHint:'2026-10-04T20:45:13.026Z',priorCountsComparisonOnly:{raw:95,china:94,unknownGeography:1},contextSqlSha256:sha(context),automaticPublication:false,sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({sourceId:cfg.sourceId,buildUnchanged:true,canonicalContextSha256:sha(context),migrationCount:history.migrations.length,preparedOnly:true}));
