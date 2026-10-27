import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {execSync} from 'node:child_process';
const A=Object.getPrototypeOf(async function(){}).constructor;
const entry=fs.readFileSync(new URL('./run-original-functions.js',import.meta.url),'utf8');
const fn=entry.slice(entry.indexOf('async function resumeTail('),entry.indexOf('// Explicit completed-tail'));
const helper=fs.readFileSync(new URL('./committed-tail-functions.js',import.meta.url),'utf8');
const calls=[];const R='/original',D='/code',relay='/relay',sourceFolders={'source-test':'test'},run=R+'/test/dot-auto-test-20000101';const q=s=>"'"+s.replaceAll("'","'\\''")+"'";
let checkpoint={sourceId:'source-test',batchId:path.basename(run),requestIds:['id']};
const read=async p=>{if(p===D+'/committed-tail-functions.js')return helper;if(p.endsWith('relay-checkpoint.json'))return JSON.stringify(checkpoint);if(p.endsWith('UPLOADED.json'))return JSON.stringify({fileId:'verified-id',sha256:'hash'});if(p.endsWith('LOCAL_PACKAGE.json'))return JSON.stringify({sha256:'hash',members:20,sources:[{source:'test',batch:path.basename(run)}]});throw Error('unexpected read:'+p);};
const command=async cmd=>{calls.push(cmd);if(cmd.includes('--verify-committed'))return JSON.stringify({state:'COMMITTED_EXACT',backupUploaded:true});if(cmd.includes('readback-original-web.py'))return JSON.stringify({status:'WEB_VERIFIED'});if(cmd.includes('urllib.request.urlopen')&&cmd.includes('--verify'))return JSON.stringify({sha256:'hash',verifiedMembers:20});throw Error('unexpected command:'+cmd);};
const tools={mcp__codex_apps__google_drive_fetch:async()=>({structuredContent:{file_uri:{file_id:'file_000_fixture',download_url:'https://example.invalid/authenticated-download'}}})};let saved;
const resume=await new A('A','D','R','relay','sourceFolders','read','command','q','tools','save',fn+'return resumeTail;')(A,D,R,relay,sourceFolders,read,command,q,tools,async(p,v)=>{saved={p,v};});
assert.equal((await resume('source-test',run)).evidenceBackup.status,'REMOTE_RESTORE_VERIFIED');assert.equal(saved.v.members,20);assert(calls.some(c=>c.includes('urllib.request.urlopen')));
checkpoint.batchId='wrong';calls.length=0;assert.equal((await resume('source-test',run)).reason,'COMMITTED_TAIL_PROOF_INCOMPLETE');assert.equal(calls.length,0);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'job-tail-selection-'));try{
 for(const batch of ['dot-auto-success-A','dot-auto-newer-failed-B']){const d=path.join(tmp,'test',batch);fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(d,'relay-checkpoint.json'),'{}');}
 const line=entry.split('\n').find(l=>l.trim().startsWith('const pending='));
 const select=await new A('command','q','R','sourceFolders','sourceId','state',line+'return pending;')(async c=>execSync(c,{encoding:'utf8'}),q,tmp,sourceFolders,'source-test',{successfulBatchId:'dot-auto-success-A'});
 assert.equal(select,path.join(tmp,'test','dot-auto-success-A'));
}finally{fs.rmSync(tmp,{recursive:true});}
console.log('PASS adapter: current Drive download_url shape, checkpoint wrong-batch rejection before effects, official successful batch A selected over newer failed B.');
