// Novartis-only local host preparation/check; no production collection or publication.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const root='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/portable42-novartis';
const A=Object.getPrototypeOf(async function(){}).constructor,sha=x=>createHash('sha256').update(x).digest('hex');
const isolated=new Map(),checks=[],commands=[];
globalThis.store=(k,v)=>isolated.set(k,v);globalThis.load=k=>isolated.get(k);
globalThis.notify=()=>{throw Error('SMOKE_UNEXPECTED_RUNNING');};
globalThis.text=()=>{};globalThis.fetch=async()=>{throw Error('SMOKE_NETWORK_FORBIDDEN');};
globalThis.tools={exec_command:async args=>{
 if(!(args.cmd.startsWith("python3 - '")||/^env JOBFINDER_CLOUD_SOURCE_ID=source-[a-z-]+ node '/.test(args.cmd))||!args.cmd.includes(root))throw Error('SMOKE_COMMAND_SCOPE');
 commands.push(args.cmd);
 try{return {exit_code:0,output:execFileSync('/bin/bash',['-c',args.cmd],{cwd:args.workdir,encoding:'utf8',timeout:15000,maxBuffer:2000000,stdio:'pipe'})};}
 catch(e){return {exit_code:e.status??1,output:String(e.stdout??'')+String(e.stderr??'')};}
 }};
const loader=await readFile(join(root,'runtime/load-portable42-runtime.js'),'utf8');
for(const key of ['novartis']){
 isolated.clear();await new A('sourceKey',loader)(key);
 const h=await new A(isolated.get('cloudPilotHostHelpers'))(),host=join(root,key),dir=join(host,'preparation-check/empty-relay');
 await mkdir(dir,{recursive:true,mode:0o700});
 const relay=await readFile(join(host,'relay-files.mjs'),'utf8');
 if(!relay.includes("if(!dir.startsWith('"+host+"/'))")||relay.includes('/hosts/servier/')||relay.includes('/hosts/portable42-next/'))throw Error('SMOKE_RELAY_LITERAL_SCOPE');
 const raw=await h.cmd('node '+h.q(host+'/relay-files.mjs')+' next-meta '+h.q(dir),2000);
 if(JSON.stringify(JSON.parse(raw))!=='[]')throw Error('SMOKE_EMPTY_RELAY_METADATA');
 checks.push({check:'real next-meta empty relay and exact source root',sourceKey:key,passed:true,output:raw.trim()});
 if(await h.next(dir)!==undefined)throw Error('SMOKE_EMPTY_NEXT');
 checks.push({check:'original h.next against real empty relay',sourceKey:key,passed:true});
 for(const name of ['host-config.json','source-plan.json','novartis-context-read.sql']){
  const got=await h.readFile(join(host,name)),bytes=await readFile(join(host,name));
  if(got.text!==bytes.toString('utf8')||got.hash!==sha(bytes))throw Error('SMOKE_ORIGINAL_READFILE');
  checks.push({check:'original h.readFile actual bytes and hash',sourceKey:key,file:name,passed:true,sha256:got.hash});
 }
 const sibling='/workspace/scratch/5e9614251709/job-finder-runtime-restore-20261004T0834Z/hosts/portable42-following/ucb';
 try{await h.readFile(join(sibling,'host-config.json'));throw Error('SMOKE_EXPECTED_CROSS_SCOPE_READ_REJECTION');}
 catch(e){if(!e.message.includes('HOST_PATH_SCOPE'))throw e;}
 checks.push({check:'original h.readFile rejects another source host',sourceKey:key,passed:true});
 try{await h.next(join(sibling,'preparation-check'));throw Error('SMOKE_EXPECTED_CROSS_SCOPE_RELAY_REJECTION');}
 catch(e){if(!e.message.includes('RELAY_DIRECTORY_OUTSIDE_TASK'))throw e;}
 checks.push({check:'original h.next rejects another source relay',sourceKey:key,passed:true});
 try{await h.next(host+'-prefix-confusion/relay');throw Error('SMOKE_EXPECTED_PREFIX_CONFUSION_REJECTION');}
 catch(e){if(!e.message.includes('RELAY_DIRECTORY_OUTSIDE_TASK'))throw e;}
 checks.push({check:'source root suffix cannot bypass relay slash boundary',sourceKey:key,passed:true});
 try{await h.readFile(host+'-prefix-confusion/host-config.json');throw Error('SMOKE_EXPECTED_PREFIX_READ_REJECTION');}
 catch(e){if(!e.message.includes('HOST_PATH_SCOPE'))throw e;}
 checks.push({check:'source root suffix cannot bypass read slash boundary',sourceKey:key,passed:true});
}
const report={schemaVersion:1,checkedAt:new Date().toISOString(),passed:true,scope:'ACTUAL_EMPTY_RELAY_ORIGINAL_HELPER_LOCAL_SMOKE',checks,commandCount:commands.length,parentSessionStoresAccessed:false,sourceNetworkAccessed:false,databaseAccessed:false,producerLaunched:false};
await writeFile(join(root,'RELAY_SMOKE_RESULTS.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({passed:true,count:checks.length,commandCount:commands.length,reportPath:join(root,'RELAY_SMOKE_RESULTS.json')}));
