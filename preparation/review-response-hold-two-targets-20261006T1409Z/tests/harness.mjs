import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,readdir,access,rm} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

export const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
export const r3=resolve(root,'../..');
export const producer=join(r3,'workspaces/producer-fb0-exact');
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const unknown={status:'FAILED',outcome:'UNKNOWN',code:'UNKNOWN'};
export const successful=(rows=[])=>({content:[{type:'text',text:JSON.stringify({result:'\n<untrusted-data-synthetic>\n'+JSON.stringify(rows)+'\n</untrusted-data-synthetic>'})}]});
export const databaseError=(code='P0001')=>({isError:true,structuredContent:{error_code:'INVALID_ARGUMENT'},content:[{type:'text',text:JSON.stringify({error:{name:'HttpException',message:code==='P0001'?'Failed to run sql query: ERROR:  P0001: CRAWL_LEASE_LOST\nCONTEXT:  PL/pgSQL function inline_code_block line 11 at RAISE\n':`Failed to run sql query: ERROR:  ${code}: synthetic timeout\n`}})}]});
const delimiter='$atomic_'+'a'.repeat(32)+'$';
export const atomicSql=`SET LOCAL statement_timeout = '120000ms';\nDO ${delimiter}\nDECLARE affected bigint; job_data jsonb; current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;\nBEGIN\nRAISE EXCEPTION 'CRAWL_LEASE_LOST';\nEND;\n${delimiter};`;
export function request({kind='PUBLISH',sql=atomicSql,duration=60000,dispatchDuration=duration-1000}={}){
 const now=Date.now(),body={schemaVersion:1,requestId:randomUUID(),kind,expiresAt:new Date(now+duration).toISOString(),payload:{projectId:'synthetic_project',sql,dispatchBefore:new Date(now+dispatchDuration).toISOString()}};
 return {...body,requestSha256:sha(JSON.stringify(body))};
}
export async function exists(path){try{await access(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function fixture(t,version='revised'){
 await mkdir(join(root,'verification'),{recursive:true});
 const directory=await mkdtemp(join(root,'verification/synthetic-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const host=join(directory,'host');await mkdir(host);
 let relay=await readFile(join(root,version,'relay-files.mjs'),'utf8').catch(error=>{if(version==='revised'&&error.code==='ENOENT')return readFile(join(root,'baseline/relay-files.mjs'),'utf8');throw error;});
 relay=relay.replace("const PROJECT='yiopvxysxrtrnvqxwgbx';","const PROJECT='synthetic_project';");
 relay=relay.replace(/\/workspace\/scratch\/5e9614251709\/jb-workspace-recovery-20261006T1136Z\/hosts-next\/(?:grifols|biogen)\/host\//,host+'/');
 await writeFile(join(host,'relay-files.mjs'),relay,{flag:'wx'});
 const dir=join(host,'relay');await mkdir(dir);
 const calls=[],saved=[],commands=[],memory=new Map(),rawQueue=[];
 const run=(command,...args)=>JSON.parse(execFileSync(process.execPath,[join(host,'relay-files.mjs'),command,dir,...args],{encoding:'utf8',stdio:'pipe'}));
 const tools={
  exec_command:async({cmd})=>{
   commands.push(cmd);
   if(cmd.includes('/host-files.mts')){
    const match=cmd.match(/ read '([^']+)' (\d+)$/);assert.ok(match,'only the exact file reader is mocked');
    assert.ok(match[1].startsWith(dir+'/'),'synthetic files only');assert.equal(Number(match[2]),0);
    const text=await readFile(match[1],'utf8');
    return {exit_code:0,output:JSON.stringify({text,sha256:sha(text),charCount:text.length,next:null})};
   }
   assert.ok(cmd.includes("'"+join(host,'relay-files.mjs')+"'"),'only the synthetic real relay CLI can execute');
   return {exit_code:0,output:execFileSync('bash',['-c',cmd],{encoding:'utf8',stdio:'pipe'})};
  },
  apply_patch:async patch=>{
   const lines=patch.split('\n');assert.equal(lines[0],'*** Begin Patch');assert.ok(lines[1].startsWith('*** Add File: '));
   const path=lines[1].slice('*** Add File: '.length);assert.ok(path.startsWith(dir+'/'),'no writes outside synthetic relay');
   const value=lines.slice(2,lines.indexOf('*** End Patch')).map(line=>{assert.ok(line.startsWith('+'));return line.slice(1);}).join('\n');
   saved.push({path,value});await writeFile(path,value,{flag:'wx',mode:0o600});return {};
  },
  mcp__codex_apps__supabase_execute_sql:async args=>{
   calls.push(args);assert.equal(args.project_id,'synthetic_project');
   assert.ok(rawQueue.length,'unrequested mock SQL call');const value=rawQueue.shift();if(value instanceof Error)throw value;return value;
  }
 };
 const cfg={root:host,repo:directory,project:'synthetic_project'};
 const source=await readFile(join(root,version,'host-helper-functions.js'),'utf8');
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const h=await new AsyncFunction('tools','load','store','notify',source)(tools,key=>key.endsWith('cloudPilotHostConfig')?cfg:memory.get(key),(key,value)=>memory.set(key,value),()=>{});
 const path=(r,suffix)=>join(dir,r.requestId+'.'+suffix);
 const put=r=>writeFile(path(r,'request.json'),JSON.stringify(r),{flag:'wx'});
 const json=(r,suffix)=>readFile(path(r,suffix),'utf8').then(JSON.parse);
 return {h,dir,host,calls,saved,commands,memory,rawQueue,run,path,put,json,tools};
}
export async function waitFor(predicate,milliseconds=5000){const end=Date.now()+milliseconds;while(Date.now()<end){const value=await predicate();if(value)return value;await delay(10);}throw Error('SYNTHETIC_WAIT_TIMEOUT');}
export async function child(t,f,duration=1600){
 const child=spawn(process.execPath,['--import',join(producer,'node_modules/tsx/dist/loader.mjs'),join(root,'tests/relay-child.mjs'),join(producer,'src/crawler/cloudSourcePilotRelay.ts'),f.dir,String(duration)],{stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
 let text='',stderr='';const events=[];child.stdout.on('data',b=>{text+=b;for(;;){const end=text.indexOf('\n');if(end<0)break;events.push(JSON.parse(text.slice(0,end)));text=text.slice(end+1);}});child.stderr.on('data',b=>stderr+=b);
 const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal,stderr}));});
 t.after(async()=>{if(child.exitCode===null&&!child.killed)child.kill('SIGTERM');await finished;});
 await waitFor(()=>events.find(e=>e.event==='START'));
 const r=await waitFor(async()=>{const names=await readdir(f.dir);const name=names.find(n=>n.endsWith('.request.json'));if(!name)return undefined;return JSON.parse(await readFile(join(f.dir,name),'utf8'));});
 return {child,events,r,finished};
}
