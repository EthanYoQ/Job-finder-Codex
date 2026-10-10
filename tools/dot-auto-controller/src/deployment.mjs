/** Builtin-only data input. A byte pin is not authority or activation approval. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const PACKAGE_ROOT=path.resolve(import.meta.dirname,'..');
const REPOSITORY_ROOT=path.resolve(PACKAGE_ROOT,'../..');
export const DEPLOYMENT_BINDINGS_ROOT=path.join(path.dirname(REPOSITORY_ROOT),'deployment-bindings');
const PATH_ENV='JOBFINDER_DEPLOYMENT_PATH',SHA_ENV='JOBFINDER_DEPLOYMENT_SHA256';
const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const CANDIDATE_KEYS=['id','goalId','version'];
const BUILD_KEYS=['schemaVersion','commitSha','sourceTreeSha256','runtimeTreeSha256','contentSha256'];
const DATABASE_KEYS=['migrationVersion','schemaHash','dbSnapshotHash'];
export const REGISTRATION_FIELDS=Object.freeze(['id','goalId','status','version','commitSha','rosterHash','schemaHash','oracleVersion','dbSnapshotHash','sourcePlanHash','sourceTreeHash','runtimeTreeHash','migrationVersion','sourceConfigHash','adapterBundleHash','minimumStableCompanyCount']);
const DEPLOYMENT_KEYS=['schemaVersion','activated','reason','authorityDirectory','authorityIdentitySha256','deployedReaderIdentity','pg','originalPublisherStateFile'];
const TAKEDA_KEYS=['enabled','configured','candidate','build','databaseIdentity','registration','pins'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,expected)=>record(x)&&Object.keys(x).sort().join(',')===[...expected].sort().join(',');
const frozen=x=>{if(x&&typeof x==='object'){for(const v of Object.values(x))frozen(v);Object.freeze(x);}return x;};
let captured,snapshot,identity,defaultSha256;

// Validate JSON syntax and reject ambiguous duplicate/prototype keys before parsing.
function json(bytes){
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let i=0;
  const ws=()=>{while(/[\x20\t\r\n]/.test(text[i]??'!'))i++;};
  const string=()=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='"')return JSON.parse(text.slice(start,i));if(c==='\\')i++;}throw Error();};
  const value=(depth=0)=>{if(depth>32)throw Error();ws();const c=text[i];
   if(c==='"'){string();return;}
   if(c==='{'){i++;ws();const seen=new Set();if(text[i]==='}'){i++;return;}while(true){ws();if(text[i]!=='"')throw Error();const k=string();if(seen.has(k)||['__proto__','constructor','prototype'].includes(k))throw Error();seen.add(k);ws();if(text[i++]!==':')throw Error();value(depth+1);ws();const end=text[i++];if(end==='}')return;if(end!==',')throw Error();}}
   if(c==='['){i++;ws();if(text[i]===']'){i++;return;}while(true){value(depth+1);ws();const end=text[i++];if(end===']')return;if(end!==',')throw Error();}}
   const m=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!m)throw Error();i+=m[0].length;
  };value();ws();if(i!==text.length)throw Error();return JSON.parse(text);
 }catch{fail('DEPLOYMENT_JSON_REJECTED');}
}
function fsIdentity(s){return [s.dev,s.ino,s.uid,s.gid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');}
function ancestors(file,uid){
 const result=[];let cursor=path.dirname(file);
 while(true){const s=fs.lstatSync(cursor,{bigint:true}),privateRoot=cursor===DEPLOYMENT_BINDINGS_ROOT;
  if(!s.isDirectory()||s.isSymbolicLink()||Number(s.mode&0o022n)!==0||
      (Number(s.uid)!==uid&&(privateRoot||Number(s.uid)!==0))||
      privateRoot&&(Number(s.mode&0o7777n)!==0o700||Number(s.uid)!==uid))fail('DEPLOYMENT_DIRECTORY_REJECTED');
  result.push([cursor,[s.dev,s.ino,s.uid,s.gid,s.mode].map(String).join(':')]);
  const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;
 }return result;
}
function readExternal(selection){
 let fd;
 try{
  if(process.platform!=='linux'||typeof process.getuid!=='function'||process.getuid()<=0||!fs.constants.O_NOFOLLOW)fail('DEPLOYMENT_PLATFORM_REJECTED');
  const uid=process.getuid(),beforeAncestors=ancestors(selection.path,uid);
  const before=fs.lstatSync(selection.path,{bigint:true});
  const valid=s=>s.isFile()&&!s.isSymbolicLink()&&Number(s.uid)===uid&&Number(s.mode&0o7777n)===0o400&&s.nlink===1n&&s.size>0n&&s.size<=1048576n;
  if(!valid(before))fail('DEPLOYMENT_FILE_REJECTED');
  fd=fs.openSync(selection.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const opened=fs.fstatSync(fd,{bigint:true});if(!valid(opened)||fsIdentity(before)!==fsIdentity(opened))fail('DEPLOYMENT_FILE_CHANGED');
  // Bounded read on the already-opened FD. Never parse or hash a second pathname read.
  const bytes=Buffer.alloc(Number(opened.size)+1);let count=0,n;
  do{n=fs.readSync(fd,bytes,count,bytes.length-count,null);count+=n;}while(n>0&&count<bytes.length);
  const after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(selection.path,{bigint:true});
  if(count!==Number(opened.size)||!valid(after)||!valid(named)||fsIdentity(opened)!==fsIdentity(after)||fsIdentity(after)!==fsIdentity(named)||
     JSON.stringify(beforeAncestors)!==JSON.stringify(ancestors(selection.path,uid)))fail('DEPLOYMENT_FILE_CHANGED');
  const body=bytes.subarray(0,count);if(digest(body)!==selection.sha256)fail('DEPLOYMENT_SHA256_MISMATCH');
  return {bytes:body,identity:JSON.stringify([fsIdentity(after),beforeAncestors])};
 }catch(error){if(typeof error?.code==='string'&&error.code.startsWith('DEPLOYMENT_'))throw error;fail('DEPLOYMENT_FILE_UNAVAILABLE');}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
function select(){
 const p=process.env[PATH_ENV],s=process.env[SHA_ENV];
 if(captured){if(p!==captured.path||s!==captured.sha256)fail('DEPLOYMENT_SELECTOR_CHANGED');return captured;}
 if(p===undefined&&s===undefined)return captured=Object.freeze({path:p,sha256:s,external:false});
 if(typeof p!=='string'||!p||typeof s!=='string'||!HASH.test(s))fail('DEPLOYMENT_SELECTOR_PAIR_REQUIRED');
 // Fixed directory and content-addressed filename, not an arbitrary-path reader.
 if(!path.isAbsolute(p)||p!==path.join(DEPLOYMENT_BINDINGS_ROOT,s+'.json'))fail('DEPLOYMENT_PATH_REJECTED');
 return captured=Object.freeze({path:p,sha256:s,external:true});
}
function validate(e){
 if(!keys(e,['schemaVersion','kind','deployment','takeda'])||e.schemaVersion!==1||e.kind!=='JOBFINDER_TAKEDA_DEPLOYMENT_V1')fail('DEPLOYMENT_ENVELOPE_REJECTED');
 const d=e.deployment,t=e.takeda;
 if(!keys(d,DEPLOYMENT_KEYS)||d.schemaVersion!==1||typeof d.activated!=='boolean'||typeof d.reason!=='string'||d.reason.length>1024||
    !keys(t,TAKEDA_KEYS)||typeof t.configured!=='boolean'||typeof t.enabled!=='boolean'||t.enabled&&!t.configured||d.activated&&!t.enabled)fail('DEPLOYMENT_SCOPE_REJECTED');
 const b=t.build,c=t.candidate,r=t.registration,db=t.databaseIdentity;
 if(!keys(b,BUILD_KEYS)||b.schemaVersion!==2||!COMMIT.test(b.commitSha)||['sourceTreeSha256','runtimeTreeSha256','contentSha256'].some(k=>typeof b[k]!=='string'||!HASH.test(b[k]))||
    b.contentSha256!==digest(JSON.stringify({schemaVersion:2,commitSha:b.commitSha,sourceTreeSha256:b.sourceTreeSha256,runtimeTreeSha256:b.runtimeTreeSha256})))fail('DEPLOYMENT_BUILD_REJECTED');
 if(!keys(c,CANDIDATE_KEYS)||typeof c.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(c.id)||c.goalId!=='jobfinder-portable-required-40'||!Number.isSafeInteger(c.version)||c.version<=49||c.version>2147483647)fail('DEPLOYMENT_CANDIDATE_REJECTED');
 if(!keys(db,DATABASE_KEYS)||db.migrationVersion!=='20261006172300_job_projection_delta_contract'||!HASH.test(db.schemaHash??'')||!HASH.test(db.dbSnapshotHash??''))fail('DEPLOYMENT_DATABASE_IDENTITY_REJECTED');
 if(!keys(r,REGISTRATION_FIELDS)||r.status!=='BUILDING'||r.oracleVersion!=='staged-official-source-v1'||r.minimumStableCompanyCount!==41||
    ['rosterHash','sourcePlanHash','sourceConfigHash','adapterBundleHash'].some(k=>typeof r[k]!=='string'||!HASH.test(r[k])))fail('DEPLOYMENT_REGISTRATION_REJECTED');
 const exact={...c,...db,commitSha:b.commitSha,sourceTreeHash:b.sourceTreeSha256,runtimeTreeHash:b.runtimeTreeSha256};
 if(Object.entries(exact).some(([k,v])=>r[k]!==v))fail('DEPLOYMENT_REGISTRATION_MISMATCH');
 if(!Array.isArray(t.pins)||t.pins.length>512||t.configured&&t.pins.length===0)fail('DEPLOYMENT_PINS_REJECTED');
 const seen=new Set();for(const pin of t.pins){if(!keys(pin,['path','bytes','sha256'])||typeof pin.path!=='string'||!pin.path||path.isAbsolute(pin.path)||pin.path.split('/').some(p=>!p||p==='.'||p==='..')||pin.path.includes('\\')||path.relative(PACKAGE_ROOT,path.resolve(PACKAGE_ROOT,pin.path)).startsWith('..')||seen.has(pin.path)||!Number.isSafeInteger(pin.bytes)||pin.bytes<0||!HASH.test(pin.sha256??''))fail('DEPLOYMENT_PINS_REJECTED');seen.add(pin.path);
  let parent=PACKAGE_ROOT;for(const part of pin.path.split('/')){parent=path.join(parent,part);let stat;try{stat=fs.lstatSync(parent);}catch{fail('DEPLOYMENT_PINS_REJECTED');}if(stat.isSymbolicLink()||parent!==path.join(PACKAGE_ROOT,pin.path)&&!stat.isDirectory()||parent===path.join(PACKAGE_ROOT,pin.path)&&!stat.isFile())fail('DEPLOYMENT_PINS_REJECTED');}
 }
 const absolute=p=>typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p;
 if(d.authorityDirectory!==null&&!absolute(d.authorityDirectory)||d.authorityIdentitySha256!==null&&!HASH.test(d.authorityIdentitySha256??'')||d.originalPublisherStateFile!==null&&!absolute(d.originalPublisherStateFile))fail('DEPLOYMENT_AUTHORITY_REJECTED');
 if(d.activated&&(!absolute(d.authorityDirectory)||!HASH.test(d.authorityIdentitySha256??'')||!absolute(d.originalPublisherStateFile)||!record(d.deployedReaderIdentity)||!record(d.pg)))fail('DEPLOYMENT_ACTIVATION_INCOMPLETE');
 // Connection and reader proof retain their original independent validators.
 if(d.pg!==null){const pg=d.pg;if(!keys(pg,['ca','database','host','mode','port','projectId','user','verifiedHost'])||pg.projectId!=='yiopvxysxrtrnvqxwgbx'||pg.database!=='postgres'||pg.port!==5432||pg.host!==pg.verifiedHost||typeof pg.ca!=='string'||!pg.ca.includes('-----BEGIN CERTIFICATE-----')||!(pg.mode==='direct'&&pg.host==='db.yiopvxysxrtrnvqxwgbx.supabase.co'&&pg.user==='dot_jobfinder_writer'||pg.mode==='session'&&/^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(pg.host)&&pg.user==='dot_jobfinder_writer.yiopvxysxrtrnvqxwgbx'))fail('DEPLOYMENT_PG_REJECTED');}
 return e;
}
export function loadDeploymentBinding(){
 const selection=select();
 if(!selection.external){
  let bytes;try{bytes=fs.readFileSync(path.join(PACKAGE_ROOT,'config/deployment.json'));}catch{fail('DEPLOYMENT_DEFAULT_UNAVAILABLE');}
  const currentSha256=digest(bytes);if(snapshot&&currentSha256!==defaultSha256)fail('DEPLOYMENT_DEFAULT_CHANGED');
  if(!snapshot){defaultSha256=currentSha256;snapshot=frozen({external:false,sha256:null,deployment:json(bytes),takeda:null});}
  return snapshot;
 }
 const current=readExternal(selection);
 if(snapshot){if(current.identity!==identity)fail('DEPLOYMENT_FILE_CHANGED');return snapshot;}
 const e=validate(json(current.bytes));identity=current.identity;
 return snapshot=frozen({external:true,sha256:selection.sha256,deployment:e.deployment,takeda:e.takeda});
}
export function loadDeployment(){return loadDeploymentBinding().deployment;}
export function assertDeploymentBinding(){loadDeploymentBinding();return true;}
export function deploymentBindingEnv(){loadDeploymentBinding();return {[PATH_ENV]:captured.path,[SHA_ENV]:captured.sha256};}
export function deploymentBindingSha256(){return loadDeploymentBinding().sha256;}
