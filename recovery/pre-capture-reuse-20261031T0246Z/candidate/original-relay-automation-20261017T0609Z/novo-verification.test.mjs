import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const A=Object.getPrototypeOf(async function(){}).constructor;
const {verifyNovoPublishedJobs}=await new A(readFileSync(new URL('./novo-job-verification-functions.js',import.meta.url),'utf8'))();
for(const mode of ['committed','transport-committed','transport-empty','no-closed','web-failed']){
 let commits=0,reads=0;const saved=new Map();const result={outcome:mode==='no-closed'?'NO_CLOSED_EVIDENCE':'CLOSURE_SQL_READY',verifiedClosedCount:4};
 const deps={q:s=>JSON.stringify(s),N:'/node',V:'/source',P:'/controller',D:'/module',R:'/runtime',save:async(p,x)=>saved.set(p,x),rows:x=>x,
 read:async p=>p.endsWith('/result.json')?JSON.stringify(result):p.endsWith('/read-input.sql')?'INPUT':p.endsWith('/commit.sql')?'COMMIT':'READBACK',
 official:async query=>{if(query==='INPUT')return [{verification_input:{sourceId:'source-novo'}}];if(query==='COMMIT'){commits++;if(mode.startsWith('transport'))throw Error('transport lost');return [{ok:true}];}reads++;return [{verification:{batches:mode==='transport-empty'?[]:[{}]}}];},
 command:async cmd=>{if(cmd.includes(' reconcile'))return JSON.stringify({outcome:mode==='transport-empty'?'UNKNOWN':'COMMITTED_EXACT',verifiedClosedCount:mode==='transport-empty'?0:4});if(cmd.includes('verify-novo-closure-web.py')){if(mode==='web-failed')throw Error('web stale');return JSON.stringify({status:'WEB_VERIFIED'});}return '';}};
 const actual=await verifyNovoPublishedJobs(deps);
 assert.equal(commits,mode==='no-closed'?0:1);assert.equal(reads,mode==='no-closed'?0:1);
 assert.equal(actual.outcome,mode==='no-closed'?'NO_CLOSED_EVIDENCE':mode==='transport-empty'?'UNKNOWN':'COMMITTED_EXACT');
 if(mode==='web-failed')assert.equal(actual.web.status,'FAILED');
 if(mode==='transport-committed')assert.equal(actual.web.status,'WEB_VERIFIED');
}
console.log('PASS: one official commit, uncertain read-only reconciliation, empty UNKNOWN, no-closed no-write, DB commit retained on web failure');
