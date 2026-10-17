/** Closed native PORTABLE connector modes. Data only; no credentials or network provider. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyRuntimeBeforeImport} from '../../../../transport/runtime-integrity.mjs';
export const HOST_ROOT=path.resolve(import.meta.dirname);
export const PRODUCER_ROOT=path.resolve(HOST_ROOT,'../..');
export const REPOSITORY_ROOT=path.resolve(PRODUCER_ROOT,'../../../..');
const releaseRoot=path.dirname(REPOSITORY_ROOT);
const sequenceLayout=process.env.JOBFINDER_FIXED_SEQUENCE_LAYOUT;
const closedStateNames=Object.freeze({'source-takeda-china-social':'takeda','source-biogen-china-social':'biogen','source-hengrui-social':'hengrui','source-ucb-china-social':'ucb','source-viatris-social':'viatris'});
if(sequenceLayout!==undefined&&(sequenceLayout!=='TAKEDA_BIOGEN_HENGRUI_UCB_VIATRIS_V1'||!Object.hasOwn(closedStateNames,process.env.JOBFINDER_CLOUD_SOURCE_ID)))throw Error('HOST_SEQUENCE_LAYOUT');
export const STATE_ROOT=sequenceLayout===undefined?releaseRoot:path.join(releaseRoot,'sources',closedStateNames[process.env.JOBFINDER_CLOUD_SOURCE_ID]);
export const BINDING_ROOT=path.join(STATE_ROOT,'connector-host-bindings');
const roundId=process.env.JOBFINDER_CONNECTOR_ROUND_ID;
if(roundId!==undefined&&!/^round-[a-f0-9]{32}$/.test(roundId))throw Error('HOST_ROUND_SELECTOR');
export const TASK_ROOT=roundId===undefined?path.join(STATE_ROOT,'connector-host-task'):path.join(STATE_ROOT,'rounds',roundId,'connector-host-task');
export const RELAY_ROOT=path.join(TASK_ROOT,'relay');
export const SELECTOR='JOBFINDER_CONNECTOR_HOST_SHA256';
export const MODE='TAKEDA_PORTABLE_CONNECTOR_V1';
export const NATIVE_MODE='NATIVE_PORTABLE_CONNECTOR_V1';
export const AB_MODE='NATIVE_AB_CONNECTOR_V1';
export const entrypointsFor=c=>c.kind===AB_MODE?{...ENTRYPOINTS,producer:'scripts/p0-cloud-source-pilot.ts'}:ENTRYPOINTS;
export const CATALOG_FILE=path.resolve(PRODUCER_ROOT,'../../config/native-catalog.json');
export const CATALOG_SHA256='adb1005c61597e75261462595cb2c74e7bc46cda2c03e16134b46a1d048df61a';
export const SOURCE='source-takeda-china-social';
export const SOURCE_HASH='048f616f00b5ed016f075f4204a2ad749457d68a3f078a9e7bde0fae2186b61f';
export const PROJECT='yiopvxysxrtrnvqxwgbx';
export const ENTRYPOINTS=Object.freeze({producer:'scripts/p0-cloud-portable-source-pilot.ts',wrapper:'scripts/run-with-http-diagnostics.mjs',controlCompiler:'src/db/cloudPilotSqlControl.ts',publicationCompiler:'src/db/ingestionRepository.ts',dbStarted:'src/crawler/cloudDbStartedPilot.ts'});
const hash=x=>createHash('sha256').update(x).digest('hex'),sha=/^[a-f0-9]{64}$/;
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===[...k].sort().join(',');
const fail=c=>{throw Error(c);};
const ident=s=>[s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');
function directories(file){
 if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()<=0||!fs.constants.O_NOFOLLOW)fail('HOST_PLATFORM');
 const uid=process.getuid(),out=[];let p=path.dirname(file);
 while(true){const s=fs.lstatSync(p,{bigint:true}),privateDir=[BINDING_ROOT,TASK_ROOT,RELAY_ROOT,...(sequenceLayout?[STATE_ROOT,path.dirname(STATE_ROOT)]:[]),...(roundId?[path.join(STATE_ROOT,'rounds'),path.dirname(TASK_ROOT)]:[])].includes(p);
  if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o022n)!==0n||(Number(s.uid)!==uid&&(privateDir||Number(s.uid)!==0))||privateDir&&(Number(s.uid)!==uid||(s.mode&0o7777n)!==0o700n))fail('HOST_DIRECTORY');
  out.push([p,[s.dev,s.ino,s.uid,s.gid,s.mode].map(String).join(':')]);const parent=path.dirname(p);if(parent===p)break;p=parent;
 }return out;
}
export function readChecked(file,{mode=0o600,max=16*1024*1024}={}){
 const beforeDirs=directories(file),uid=process.getuid();let fd;
 const valid=s=>s.isFile()&&!s.isSymbolicLink()&&Number(s.uid)===uid&&Number(s.mode&0o7777n)===mode&&s.nlink===1n&&s.size>=0n&&s.size<=BigInt(max);
 try{const before=fs.lstatSync(file,{bigint:true});if(!valid(before))fail('HOST_FILE');
  fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const opened=fs.fstatSync(fd,{bigint:true});if(!valid(opened)||ident(before)!==ident(opened))fail('HOST_FILE_CHANGED');
  const bytes=Buffer.alloc(Number(opened.size)+1);let count=0,n;do{n=fs.readSync(fd,bytes,count,bytes.length-count,null);count+=n;}while(n>0&&count<bytes.length);
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});if(count!==Number(opened.size)||!valid(after)||!valid(named)||ident(opened)!==ident(after)||ident(after)!==ident(named)||!same(beforeDirs,directories(file)))fail('HOST_FILE_CHANGED');
  return {bytes:bytes.subarray(0,count),identity:JSON.stringify([ident(after),beforeDirs])};
 }finally{if(fd!==undefined)fs.closeSync(fd);}
}
// Reject duplicate/prototype keys before parsing; config is not executable code.
function json(bytes){
 try{const t=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let i=0;const ws=()=>{while(/[\x20\t\r\n]/.test(t[i]??'!'))i++;};
  const str=()=>{const start=i++;while(i<t.length){const c=t[i++];if(c==='"')return JSON.parse(t.slice(start,i));if(c==='\\')i++;}throw Error();};
  const val=(d=0)=>{if(d>32)throw Error();ws();const c=t[i];if(c==='"'){str();return;}
   if(c==='{'){i++;ws();const seen=new Set();if(t[i]==='}'){i++;return;}while(true){ws();if(t[i]!=='"')throw Error();const k=str();if(seen.has(k)||['__proto__','constructor','prototype'].includes(k))throw Error();seen.add(k);ws();if(t[i++]!==':')throw Error();val(d+1);ws();const e=t[i++];if(e==='}')return;if(e!==',')throw Error();}}
   if(c==='['){i++;ws();if(t[i]===']'){i++;return;}while(true){val(d+1);ws();const e=t[i++];if(e===']')return;if(e!==',')throw Error();}}
   const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(t.slice(i));if(!m)throw Error();i+=m[0].length;
  };val();ws();if(i!==t.length)throw Error();return JSON.parse(t);
 }catch{fail('HOST_CONFIG_JSON');}
}
const freeze=o=>{if(o&&typeof o==='object'){Object.values(o).forEach(freeze);Object.freeze(o);}return o;};
// The producer build hashes this reviewed constant; the outer catalogue must match
// these exact bytes. A mutable outer catalogue cannot widen the source allowlist.
export function nativeCatalogue(){
 const r=readChecked(CATALOG_FILE,{mode:0o644,max:12311});
 if(r.bytes.length!==12311||hash(r.bytes)!==CATALOG_SHA256)fail('HOST_CATALOG_DRIFT');
 const rows=json(r.bytes).routingCatalogue;
 if(!Array.isArray(rows)||rows.length!==36||new Set(rows.map(r=>r.sourceId)).size!==36||rows.filter(r=>r.route==='PORTABLE').length!==20||rows.filter(r=>r.route==='TRUE_A').length!==12||rows.filter(r=>r.route==='TRUE_B').length!==4)fail('HOST_CATALOG_SCOPE');
 return freeze(rows);
}
export function portableCatalogue(){return nativeCatalogue().filter(r=>r.route==='PORTABLE');}
export const isSupportedABRoute=r=>r.route==='TRUE_A'||r.route==='TRUE_B'&&['source-pfizer-china-social','source-bayer-healthcare-social','source-servier-china-social','source-sanofi-china-social'].includes(r.sourceId);
export function abCatalogue(){return nativeCatalogue().filter(isSupportedABRoute);
}
let captured,snapshot,fileIdentity;
export function loadBinding(){
 const selector=process.env[SELECTOR];if(!sha.test(selector??''))fail('HOST_CONFIG_REQUIRED');
 if(captured&&captured!==selector)fail('HOST_CONFIG_CHANGED');captured=selector;
 const r=readChecked(path.join(BINDING_ROOT,selector+'.json'),{mode:0o400,max:1024*1024});if(hash(r.bytes)!==selector)fail('HOST_CONFIG_HASH');
 const portable=portableCatalogue();
 if(snapshot){if(r.identity!==fileIdentity)fail('HOST_CONFIG_CHANGED');if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==snapshot.sourceId)fail('HOST_SOURCE_ENV');return snapshot;}
 const c=json(r.bytes),ab=c.kind===AB_MODE,allowed=ab?abCatalogue():portable;
 if(!keys(c,['schemaVersion','kind','enabled','projectId','sourceId','sourceConfigSha256','route','publicationMode','ownerId','control','lockSha256','entrypointHashes'])||c.schemaVersion!==1||![MODE,NATIVE_MODE,AB_MODE].includes(c.kind)||c.enabled!==true||c.projectId!==PROJECT||!allowed.some(r=>r.sourceId===c.sourceId&&r.sourceConfigSha256===c.sourceConfigSha256&&r.route===c.route)||c.kind===MODE&&(c.sourceId!==SOURCE||c.sourceConfigSha256!==SOURCE_HASH)||!ab&&c.route!=='PORTABLE'||c.publicationMode!=='DB_STARTED_JOB_PROJECTION_DELTA_V1'||c.ownerId!==(c.sourceId==='source-csl-china-social'?'dot-cloud-csl-pilot':c.sourceId==='source-lilly-china-social'?'dot-cloud-lilly-pilot':`dot-cloud-${c.sourceId.slice(7)}-pilot`))fail('HOST_CONFIG_SCOPE');
 const control=c.control,b=control?.build,ca=control?.candidate,db=control?.databaseIdentity;
 if(!keys(control,['projectId','build','candidate','databaseIdentity'])||control.projectId!==PROJECT||!keys(b,['schemaVersion','commitSha','sourceTreeSha256','runtimeTreeSha256','contentSha256'])||b.schemaVersion!==2||!/^[a-f0-9]{40}$/.test(b.commitSha??'')||['sourceTreeSha256','runtimeTreeSha256','contentSha256'].some(k=>!sha.test(b[k]??''))||b.contentSha256!==hash(JSON.stringify({schemaVersion:2,commitSha:b.commitSha,sourceTreeSha256:b.sourceTreeSha256,runtimeTreeSha256:b.runtimeTreeSha256})))fail('HOST_CONFIG_BUILD');
 if(!keys(ca,['id','goalId','version'])||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(ca.id??'')||ca.goalId!=='jobfinder-portable-required-40'||!Number.isSafeInteger(ca.version)||ca.version<=49||ca.version>2147483647)fail('HOST_CONFIG_CANDIDATE');
 if(!keys(db,['migrationVersion','schemaHash','dbSnapshotHash'])||db.migrationVersion!=='20261014141000_v75_retired_candidate_fence'||db.schemaHash!=='6709fcde7b1953fd1d817d61d3239023fb29ec0ae4fc481efc69ffddbfa13af7'||!sha.test(db.dbSnapshotHash??''))fail('HOST_CONFIG_DATABASE');
 if(!sha.test(c.lockSha256??'')||!keys(c.entrypointHashes,Object.keys(ENTRYPOINTS))||Object.values(c.entrypointHashes).some(x=>!sha.test(x??'')))fail('HOST_CONFIG_ENTRYPOINTS');
 if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==c.sourceId)fail('HOST_SOURCE_ENV');
 snapshot=freeze(c);fileIdentity=r.identity;return snapshot;
}
export function taskFile(file){
 if(typeof file!=='string'||file!==path.resolve(file)||path.dirname(file)!==RELAY_ROOT||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(?:request\.(?:json(?:\.sql)?|ready)|host-result(?:\.ready|\.part-[0-9]{6})?\.json|response\.json|dispatch\.json)$/.test(path.basename(file)))fail('HOST_PATH_SCOPE');
 directories(file);return file;
}
export function relayDirectory(dir){if(dir!==RELAY_ROOT)fail('RELAY_DIRECTORY_OUTSIDE_TASK');directories(path.join(dir,'scope-check'));return dir;}
export async function verifyBinding(){
 const c=loadBinding();
 // Catalogue routing support does not waive known missing source-specific fixes.
 const row=nativeCatalogue().find(r=>r.sourceId===c.sourceId);
 if(c.kind!==AB_MODE&&!['NO_POST_C51_PRODUCER_DELTA_IDENTIFIED_IN_AUDITED_EVIDENCE','KNOWN_SOURCE_FIX_RESTORED_OFFLINE_VERIFIED'].includes(row?.c60Use))fail('HOST_SOURCE_FIX_REQUIRED');
 if(process.env.JOBFINDER_CLOUD_SOURCE_ID!==c.sourceId)fail('HOST_SOURCE_ENV');
 if(execFileSync('git',['status','--porcelain'],{cwd:PRODUCER_ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim())fail('HOST_RUNTIME_DIRTY');
 verifyRuntimeBeforeImport(PRODUCER_ROOT,c.control.build,c.lockSha256);
 for(const [name,p] of Object.entries(entrypointsFor(c))){const file=path.join(PRODUCER_ROOT,p);directories(file);const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||hash(fs.readFileSync(file))!==c.entrypointHashes[name])fail('HOST_ENTRYPOINT_DRIFT');}
 // Load original modules only after exact Node, clean Git, dependency and byte checks.
 const module=p=>import(pathToFileURL(path.join(PRODUCER_ROOT,p)).href);
 const {register}=await module('node_modules/tsx/dist/esm/api/index.mjs');register({tsconfig:PRODUCER_ROOT+'/tsconfig.json'});
 const {CLOUD_PILOT_SOURCE}=await module('src/db/cloudPilotSqlControl.ts');
 const producer=await module(entrypointsFor(c).producer);
 const {deriveCurrentStagedScheduleExpectation}=await module('src/crawler/stagedScheduleAuthority.ts');
 const {sourcePlanConfigSha256}=await module('src/crawler/sourcePlan.ts');
 const rows=portableCatalogue(),ids=rows.map(r=>r.sourceId).sort();
 if(c.kind!==AB_MODE&&!same([...producer.PORTABLE_REFRESH_SOURCE_IDS].sort(),ids))fail('HOST_PRODUCER_ALLOWLIST_DRIFT');
 const plans=deriveCurrentStagedScheduleExpectation(c.control.build).plans,plan=plans.find(p=>p.source.id===c.sourceId);
 if(plans.length!==41||!plan||sourcePlanConfigSha256(plan)!==c.sourceConfigSha256||CLOUD_PILOT_SOURCE.id!==c.sourceId||CLOUD_PILOT_SOURCE.sourceConfigSha256!==c.sourceConfigSha256||CLOUD_PILOT_SOURCE.ownerId!==c.ownerId)fail('HOST_SOURCE_MODULE_DRIFT');
 if(c.kind===AB_MODE){
  const {isJnjDomPlan}=await module('src/crawler/jnjCareersDomEvidence.ts');
  const currentFix=isJnjDomPlan(plan)||(c.sourceId==='source-amgen-china-social'&&plan.profileBoundSource?.kind==='amgen-manual-workday-lookup')||(c.sourceId==='source-gsk-china-social'&&plan.moka?.requisitionStatusPolicy==='GSK_NATIVE_OPEN_REQUISITIONS_V1');
  if(!['NO_POST_C51_PRODUCER_DELTA_IDENTIFIED_IN_AUDITED_EVIDENCE','KNOWN_SOURCE_FIX_RESTORED_OFFLINE_VERIFIED'].includes(row?.c60Use)&&!currentFix)fail('HOST_SOURCE_FIX_REQUIRED');
  const {requiresBGradeTraversalCertificate}=await module('src/crawler/traversalCertificate.ts');
  if(requiresBGradeTraversalCertificate(plan)!==(c.route==='TRUE_B'))fail('HOST_SOURCE_GRADE');
 }else producer.assertPortableRefreshPlan(plan);
 return c;
}
