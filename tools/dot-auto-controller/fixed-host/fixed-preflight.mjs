/** Trusted builtins-only bridge: every package byte is verified before import. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const BASE='/workspace/scratch/5e9614251709/job-finder-fixed-live-controller-v1';
const TASK=BASE,PACKAGE=BASE+'/runtime-checkout/tools/dot-auto-controller',VENDOR=PACKAGE+'/vendor/c60-source';
const NODE=BASE+'/connector-host-runtime/node';
const selector=process.env.JOBFINDER_FIXED_DEPLOYMENT_SHA256;
if(!/^[a-f0-9]{64}$/.test(selector??''))throw Error('FIXED_DEPLOYMENT_SELECTOR');
const CONFIG=BASE+'/deployments/'+selector+'.json';
const hash=x=>createHash('sha256').update(x).digest('hex'),check=(ok,code)=>{if(!ok)throw Error(code);};
const configBytes=fs.readFileSync(CONFIG);check(hash(configBytes)===selector,'FIXED_DEPLOYMENT_HASH');const config=JSON.parse(configBytes.toString('utf8'));
check(['TEST_ONLY','LIVE'].includes(process.env.JOBFINDER_FIXED_LOCAL_MODE??'')&&process.env.JOBFINDER_CLOUD_SOURCE_ID==='source-takeda-china-social','FIXED_MODE');
check(!process.env.NODE_OPTIONS&&!process.env.NODE_PATH,'FIXED_INJECTION');
check(fs.realpathSync('/proc/self/exe')===NODE&&hash(fs.readFileSync(NODE))==='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48','FIXED_NODE_PIN');
const verifier=PACKAGE+'/connector-gate/package-preimport-pin.mjs';
check(hash(fs.readFileSync(verifier))==='50a71b76ccaa44b514a2255f13c4fbe7c0cd259861a2a34548c58c0079582fb8','FIXED_VERIFIER_PIN');
const {verifyPackageSourcePreimport}=await import(pathToFileURL(verifier));
const pin=verifyPackageSourcePreimport({packageRoot:PACKAGE,manifestPath:BASE+'/deployments/'+config.packageManifestSha256+'.manifest.json',expectedManifestSha256:config.packageManifestSha256});
for(const excluded of pin.excludedPaths)check(excluded==='node_modules'||excluded==='vendor/c60-source/dist'||excluded==='vendor/c60-source/node_modules'||['dist','src','scripts','prisma','ops','node_modules'].some(part=>excluded.startsWith('vendor/c60-source/'+part+'/')&&excluded.endsWith('/node_modules')),'FIXED_SHADOW_DEPENDENCY');
check(fs.realpathSync(PACKAGE+'/node_modules')===VENDOR+'/node_modules','FIXED_DEPENDENCY_ALIAS');
const {verifyRuntimeBeforeImport}=await import(pathToFileURL(PACKAGE+'/transport/runtime-integrity.mjs'));
verifyRuntimeBeforeImport(VENDOR,config.build,config.lockSha256);
check(execFileSync('/usr/bin/git',['status','--porcelain'],{cwd:VENDOR,encoding:'utf8'}).trim()==='','FIXED_GIT_DIRTY');
const [op]=process.argv.slice(2);check(process.argv.length===3&&['derive','check'].includes(op),'FIXED_PREFLIGHT_OPERATION');
if(op==='check'){console.log(JSON.stringify({kind:'FIXED_RUNTIME_PINNED',build:config.build,sourceFileCount:pin.sourceFileCount}));}
else {
 const {register}=await import(pathToFileURL(VENDOR+'/node_modules/tsx/dist/esm/api/index.mjs'));register({tsconfig:VENDOR+'/tsconfig.json'});
 const {deriveCurrentStagedScheduleExpectation,STAGED_SCHEDULE_ORACLE_VERSION}=await import(pathToFileURL(VENDOR+'/src/crawler/stagedScheduleAuthority.ts'));
 const {listCurrentPrismaMigrations,prismaMigrationManifestSha256}=await import(pathToFileURL(VENDOR+'/src/db/prismaMigrationManifest.ts'));
 const migrations=listCurrentPrismaMigrations(VENDOR),schemaHash=prismaMigrationManifestSha256(migrations);
 check(migrations.length===50&&schemaHash==='6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7'&&schemaHash===config.databaseIdentity.schemaHash,'FIXED_50_MIGRATIONS');
 const e=deriveCurrentStagedScheduleExpectation(config.build);
 check(e.minimumStableCompanyCount===41&&e.plans.length===41,'FIXED_ROSTER_SCOPE');
 const expectedRow={...config.candidate,commitSha:e.commitSha,...config.databaseIdentity,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,oracleVersion:STAGED_SCHEDULE_ORACLE_VERSION,minimumStableCompanyCount:e.minimumStableCompanyCount,status:'BUILDING'};
 check(Object.keys(expectedRow).length===16,'FIXED_16_FIELDS');
 const entrypoints={producer:'scripts/p0-cloud-portable-source-pilot.ts',wrapper:'scripts/run-with-http-diagnostics.mjs',controlCompiler:'src/db/cloudPilotSqlControl.ts',publicationCompiler:'src/db/ingestionRepository.ts',dbStarted:'src/crawler/cloudDbStartedPilot.ts'};
 const control={projectId:config.projectId,build:config.build,candidate:config.candidate,databaseIdentity:config.databaseIdentity};
 const binding={schemaVersion:1,kind:'NATIVE_PORTABLE_CONNECTOR_V1',enabled:true,projectId:config.projectId,sourceId:config.sourceId,sourceConfigSha256:config.sourceConfigSha256,route:'PORTABLE',publicationMode:'DB_STARTED_JOB_PROJECTION_DELTA_V1',ownerId:'dot-cloud-takeda-china-social-pilot',control,lockSha256:config.lockSha256,entrypointHashes:Object.fromEntries(Object.entries(entrypoints).map(([k,p])=>[k,hash(fs.readFileSync(path.join(VENDOR,p)))]))};
 const plan=e.plans.find(p=>p.source.id===config.sourceId);check(!!plan,'FIXED_SOURCE_PLAN');
 const sourceRow=Object.fromEntries(['id','companyId','kind','atsKind','status','officialEntryUrl','officialChainEvidenceUrl'].map(k=>[k,plan.source[k]]));
 const fixtureContext={sourceId:config.sourceId,sourceConfigSha256:config.sourceConfigSha256,jobs:[],latestAccepted:null,firstAccepted:null,candidateRow:expectedRow,sourceRow,companyRow:{id:plan.company.id,officialChineseName:plan.company.officialChineseName}};
 check(Object.keys(config.expectedRow).length===16&&Object.entries(expectedRow).every(([k,v])=>config.expectedRow[k]===v),'FIXED_EXPECTED_ROW_DEPLOYMENT');
 console.log(JSON.stringify({kind:'FIXED_DERIVED_BINDING',expectedRow,control,binding,...process.env.JOBFINDER_FIXED_LOCAL_MODE==='TEST_ONLY'?{fixtureContext}:{},sourceFileCount:pin.sourceFileCount}));
}
