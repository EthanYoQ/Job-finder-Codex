/** Offline binding preparation. Requires owner-supplied actual registration data.
 * Never registers a candidate, runs SQL, activates a host, or starts acquisition. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from '../../../../producer/node_modules/zod/index.js';
import {createBuildIdentity} from '../../../../producer/src/readiness/buildIdentity.ts';
import {deriveCurrentStagedScheduleExpectation} from '../../../../producer/src/crawler/stagedScheduleAuthority.ts';
import {verifyNodeRuntimeProfile} from '../../../../producer/scripts/verify-node-runtime-profile.ts';
import {compileCloudPilotPublicationContextSql,CLOUD_PILOT_SOURCE} from '../../../../producer/src/db/cloudPilotSqlControl.ts';
import { REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES } from '../../../../producer/src/crawler/completenessCertificate.ts';
import { requiresBGradeTraversalCertificate } from '../../../../producer/src/crawler/traversalCertificate.ts';
const host=resolve(dirname(fileURLToPath(import.meta.url)),'..'),base=resolve(host,'..');
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
const template=JSON.parse(readFileSync(join(host,'control-base.template.json'),'utf8'));
const [ownerPath,readbackPath,outputPath,...extra]=process.argv.slice(2);
if(!ownerPath||!readbackPath||!outputPath||extra.length)throw Error('Usage: JOBFINDER_CLOUD_SOURCE_ID=source-gsk-china-social <pinned-node> --import <new-loader> prepare-owner-binding.mts <owner-binding-input.json> <registration-readback.json> <new-prepared-directory>');
const sha=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const SHA=z.string().regex(/^[0-9a-f]{64}$/);
const candidateSchema=z.object({id:z.string().regex(/^[-A-Za-z0-9._]{1,100}$/).refine(id=>id!=='dot-cloud-delta-proxy-28402a29-20261007'),goalId:z.literal('jobfinder-portable-required-40'),version:z.number().int().min(52)}).strict();
const databaseSchema=z.object({migrationVersion:z.literal('20261006172300_job_projection_delta_contract'),schemaHash:SHA,dbSnapshotHash:SHA}).strict();
const ownerSchema=z.object({schemaVersion:z.literal(1),build:z.object({schemaVersion:z.literal(2),commitSha:z.literal('58aa0e413eec27813483996f5dea6c708a7757c4'),sourceTreeSha256:SHA,runtimeTreeSha256:SHA,contentSha256:SHA}).strict(),candidate:candidateSchema,databaseIdentity:databaseSchema,minimumCandidateVersion:z.literal(52),sourceId:z.literal('source-gsk-china-social'),sourceConfigSha256:z.literal('aa9bf82308c3b818a8c33b80561712b932389186c160ae83583a8c869eb54d74')}).strict();
const ownerBytes=readFileSync(ownerPath),owner=ownerSchema.parse(JSON.parse(ownerBytes.toString('utf8')));
assert.deepEqual(owner.build,template.build,'OWNER_BUILD_MISMATCH');
if(cfg.root!==host||process.cwd()!==cfg.repo||process.execPath!==cfg.node||realpathSync(process.execPath)!==cfg.node)throw Error('HOST_PATH_OR_NODE_BINDING');
const nodeRuntime=await verifyNodeRuntimeProfile();
if(CLOUD_PILOT_SOURCE.id!==owner.sourceId||CLOUD_PILOT_SOURCE.sourceConfigSha256!==owner.sourceConfigSha256)throw Error('HOST_SOURCE_BINDING');
const git=(args:string[])=>execFileSync('git',args,{cwd:cfg.repo,encoding:'utf8'}).trim();
if(git(['rev-parse','HEAD'])!==owner.build.commitSha||git(['status','--porcelain']))throw Error('HOST_FROZEN_PRODUCER_REQUIRED');
assert.deepEqual(createBuildIdentity(cfg.repo,owner.build.commitSha),owner.build,'HOST_BUILD_IDENTITY_MISMATCH');
const bytes=readFileSync(readbackPath),readback=JSON.parse(bytes.toString('utf8'));
const row=readback.candidateRow??readback.row;
if(!row||typeof row!=='object'||Array.isArray(row))throw Error('REGISTERED_CANDIDATE_READBACK_REQUIRED');
const e=deriveCurrentStagedScheduleExpectation(owner.build);
const expected={...owner.candidate,...owner.databaseIdentity,commitSha:e.commitSha,rosterHash:e.rosterSha256,sourcePlanHash:e.sourcePlanSha256,sourceConfigHash:e.sourceConfigSha256,adapterBundleHash:e.adapterBundleSha256,sourceTreeHash:e.sourceTreeSha256,runtimeTreeHash:e.runtimeTreeSha256,minimumStableCompanyCount:e.minimumStableCompanyCount,oracleVersion:'staged-official-source-v1',status:'BUILDING'};
for(const [key,value] of Object.entries(expected))if(row[key]!==value)throw Error('REGISTERED_CANDIDATE_FIELD:'+key);
const control={projectId:cfg.project,build:template.build,candidate:owner.candidate,databaseIdentity:owner.databaseIdentity};
const sourcePlan=e.plans.find(plan=>plan.source.id===cfg.sourceId);
if(!sourcePlan||REQUIRED_A_GRADE_COMPLETENESS_CERTIFICATES[cfg.sourceId]!==sourcePlan.company.id||requiresBGradeTraversalCertificate(sourcePlan))throw Error('HOST_ORIGINAL_TRUE_A_ROUTE_REQUIRED');
const context=compileCloudPilotPublicationContextSql(control);
if(!context.includes('j."visibleInFrontend",j."isNew"')||!context.includes("'legacyCertificate'")||!context.includes('AS observations'))throw Error('HOST_INCREMENTAL_CONTEXT_REQUIRED');
const output=resolve(outputPath);
if(output===host||output.startsWith(host+'/')||output===cfg.repo||output.startsWith(cfg.repo+'/')||existsSync(output))throw Error('PREPARATION_OUTPUT_SCOPE');
const markerCandidate='const expectedCandidate=null; // OWNER_CANDIDATE_BINDING';
const markerDatabase='const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING';
function render(source:string,includeDatabase=false){
 if(source.split(markerCandidate).length!==2)throw Error('HOST_CANDIDATE_MARKER');
 let out=source.replace(markerCandidate,'const expectedCandidate='+JSON.stringify(owner.candidate)+'; // OWNER_CANDIDATE_BINDING');
 if(includeDatabase){if(out.split(markerDatabase).length!==2)throw Error('HOST_DATABASE_MARKER');out=out.replace(markerDatabase,'const expectedDatabaseIdentity='+JSON.stringify(owner.databaseIdentity)+'; // OWNER_DATABASE_BINDING');}
 return out;
}
const loader=render(readFileSync(join(host,'runtime/load-host-state.unbound.template.js'),'utf8'),true);
const starter=render(readFileSync(join(base,'supervision/start-monitor-gsk-next-combined.unbound.template.js'),'utf8'));
const A=Object.getPrototypeOf(async function(){}).constructor;
new A('root','sourceId','candidateId','commit','tools','load','store','notify',loader);new A('tools','load','store','notify',starter);
const contextReadSha256=sha(context);
const activation={status:'PREPARED_NOT_ACTIVATED',starterSha256:sha(starter),loaderSha256:sha(loader),contextReadSha256,registrationReadbackPath:resolve(readbackPath),registrationReadbackSha256:sha(bytes),ownerInputSha256:sha(ownerBytes),candidate:owner.candidate,build:control.build,databaseIdentity:control.databaseIdentity};
const files:Record<string,string>={
 'host/control-base.json':JSON.stringify(control,null,2)+'\n',
 'host/context-read.sql':context+'\n',
 'host/runtime/load-host-state.js':loader,
 'supervision/start-monitor-gsk-next-combined.js':starter,
 'host/activation.prepared.json':JSON.stringify(activation,null,2)+'\n',
 'owner-binding-input.json':JSON.stringify(owner,null,2)+'\n'
};
// context must remain byte-identical to the frozen compiler, including its terminal byte.
files['host/context-read.sql']=context;
mkdirSync(output,{recursive:false,mode:0o700});
const manifest=[];
for(const [relative,text]of Object.entries(files)){const path=join(output,relative);mkdirSync(dirname(path),{recursive:true,mode:0o700});writeFileSync(path,text,{flag:'wx',mode:0o600});manifest.push({path:relative,sha256:sha(text),bytes:Buffer.byteLength(text)});}
const result={classification:'OWNER_BINDING_PREPARED_NOT_ACTIVATED',output,host,candidate:owner.candidate,build:control.build,databaseIdentity:control.databaseIdentity,nodeRuntime,contextReadSha256,registrationReadbackSha256:sha(bytes),ownerInputSha256:sha(ownerBytes),sourceId:owner.sourceId,files:manifest,registrationPerformed:false,sqlExecuted:false,activationWritten:false};
writeFileSync(join(output,'PREPARED_BINDING_MANIFEST.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify(result));
