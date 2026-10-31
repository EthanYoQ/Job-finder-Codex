import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const D=path.dirname(new URL(import.meta.url).pathname),[B,R,folders]=process.argv.slice(2),sourceFolders=JSON.parse(folders);
const entry=fs.readFileSync(D+'/run-original-functions.js','utf8'),A=Object.getPrototypeOf(async function(){}).constructor;
new A(entry); // Parse only: never execute the active/full entry.
const start=entry.indexOf('// Persist the source HOLD before isolating'),end=entry.indexOf('return await runOriginalSerial(',start);
const setup=new A('command','q','B','R','D','states','sourceFolders','let roundId,relay;\n'+entry.slice(start,end)+'\nreturn {roundId,relay,readIsolation};');
const q=s=>"'"+String(s).replaceAll("'","'\\''")+"'",command=async s=>execFileSync('/bin/bash',['-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
const states=[{checkedAt:'2026-10-31T03:10:00Z'}];
const holdStart=entry.indexOf(' const hold={'),holdEnd=entry.indexOf('\n',entry.indexOf("if(hold)throw Error('PENDING_USER_DECISION:'",holdStart));
const check=new A('sourceId','load','readIsolation',entry.slice(holdStart,holdEnd));
const {runOriginalSerial}=await new A(fs.readFileSync(path.resolve(D,'../../original-relay-automation-20261017T0609Z/automatic-relay-functions.js'),'utf8'))();
const rounds=[];
for(let i=0;i<2;i++){
 const {roundId,readIsolation}=await setup(command,q,B,R,D,states,sourceFolders);rounds.push(roundId);
 assert.deepEqual(Object.keys(readIsolation.holds),['source-boehringer-ingelheim-china-social']);
 const results=await runOriginalSerial(['source-boehringer-ingelheim-china-social','source-biogen-china-social'],async sourceId=>{await check(sourceId,()=>undefined,readIsolation);return {skip:'OFFLINE_TEST_NO_PREPARATION'};});
 assert.equal(results[0].status,'HELD');assert.match(results[0].reason,/PRE_CAPTURE_READ_UNKNOWN_PRODUCER_TERMINAL_NO_PUBLISH/);assert.equal(results[1].status,'SKIPPED');
 await assert.rejects(check('source-novo-nordisk-china-social',()=>undefined,readIsolation),/DIRECT_JOB_VERIFICATION_UNKNOWN/);
 await assert.rejects(check('source-biogen-china-social',()=>({'source-biogen-china-social':'EXISTING_USER_HOLD'}),readIsolation),/EXISTING_USER_HOLD/);
}
assert.notEqual(rounds[0],rounds[1]);
const original=path.resolve(D,'../../original-relay-automation-20261017T0609Z');
const transport=path.resolve(D,'../../takeda-original-recovery-20261017T0417Z/transport');
const {readerBeforeQueries}=await new A(fs.readFileSync(original+'/reader-before-functions.js','utf8'))();
for(const template of ['viatris-reader-before-original.sql','sanofi-reader-before-original.sql']){
 const queries=readerBeforeQueries(fs.readFileSync(transport+'/'+template,'utf8'));
 for(const query of [queries.single,queries.header,queries.final,queries.publication('OFFLINE_FIXTURE_ID')]){
  assert.ok(query.startsWith("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='8s';\n"));assert.ok(query.trimEnd().endsWith('ROLLBACK;'));
 }
}
console.log('PASS: actual candidate entry creates fresh queues; original serial loop holds the source across two fresh sessions without store and proceeds to other source; existing holds retained; original reader queries retain READ ONLY/ROLLBACK. No SQL or full entry executed.');
