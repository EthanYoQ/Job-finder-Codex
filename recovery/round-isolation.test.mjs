import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=path.dirname(new URL(import.meta.url).pathname),A=Object.getPrototypeOf(async function(){}).constructor;
const entry=fs.readFileSync(root+'/original-relay-automation-20261017T0609Z/run-original-functions.js','utf8');
const helper=fs.readFileSync(root+'/takeda-original-recovery-20261017T0417Z/transport/adapted-host-helper-functions.js','utf8');
const tail=fs.readFileSync(root+'/original-relay-automation-20261017T0609Z/committed-tail-functions.js','utf8');
const B='/workspace/scratch/5e9614251709',R=B+'/takeda-original-recovery-20261017T0417Z',D=B+'/original-relay-automation-20261017T0609Z';
const round='round-'+ 'a'.repeat(32),defaultRelay=B+'/connector-host-task/relay',roundRelay=B+'/rounds/'+round+'/connector-host-task/relay';
const prefix=entry.slice(0,entry.indexOf('const q='));
for(const [value,expected] of [[undefined,defaultRelay],[round,roundRelay]]){
 const actual=await new A('load',prefix+'return relay;')(()=>value);assert.equal(actual,expected);
}
for(const invalid of ['',null,'round-../other','round-'+ 'a'.repeat(31)])await assert.rejects(new A('load',prefix+'return relay;')(()=>invalid),/HOST_ROUND_SELECTOR/);
for(const value of [undefined,round]){
 const commands=[],cfg={mode:'NATIVE_PORTABLE_CONNECTOR_V1',sourceId:'source-abbvie-china-social',bindingSha256:'b'.repeat(64),root:'/fixture/ops',repo:'/fixture',roundId:value};
 const tools={exec_command:async args=>{commands.push(args.cmd);return {output:'{}',exit_code:0};}};
 const h=await new A('load','tools',helper)(()=>cfg,tools);
 await h.cmd("node '/fixture/ops/host-files.mts' connector-validate");
 assert.equal(commands.length,1);assert.equal(commands[0].includes('JOBFINDER_CONNECTOR_ROUND_ID='),value!==undefined);
 if(value)assert(commands[0].includes("JOBFINDER_CONNECTOR_ROUND_ID='"+round+"'"));
 assert(commands[0].includes("JOBFINDER_CLOUD_SOURCE_ID='source-abbvie-china-social'"));
}
const resume=entry.slice(entry.indexOf('async function resumeTail('),entry.indexOf('// Explicit completed-tail recovery'));
const source='source-abbvie-china-social',run=R+'/abbvie/dot-auto-round-fixture',q=s=>"'"+s.replaceAll("'","'\\''")+"'";
for(const [storedRelay,expected] of [[undefined,defaultRelay],[roundRelay,roundRelay]]){
 let actualCommand;
 const checkpoint={sourceId:source,batchId:'dot-auto-round-fixture',requestIds:['fixture-id'],...(storedRelay?{relayDirectory:storedRelay}:{})};
 const read=async p=>p===D+'/committed-tail-functions.js'?tail:JSON.stringify(checkpoint);
 const command=async c=>{actualCommand=c;return JSON.stringify({state:'COMMITTED_EXACT',webVerified:true,backupVerified:true});};
 const fn=new A('A','D','R','B','defaultRelay','sourceFolders','read','command','q',resume+'return await resumeTail('+JSON.stringify(source)+','+JSON.stringify(run)+');');
 const result=await fn(A,D,R,B,defaultRelay,{[source]:'abbvie'},read,command,q);
 assert.equal(result.status,'PREVIOUS_TAIL_VERIFIED');assert(actualCommand.includes('--relay '+q(expected)));
}
assert(entry.includes('requestIds,relayDirectory:relay'));
assert(entry.includes("JOBFINDER_CONNECTOR_ROUND_ID='+q(roundId)"));
console.log('PASS: default/round paths, invalid selectors, helper environment, old/new tail checkpoint selection, producer round environment');
