import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkInstallation, pendingRequests, FIXED_HOLDS, sessionWindow} from './native-round.mjs';
const exec=promisify(execFile);

test('read-only check enumerates the actual 36 routes and does not create missing installation files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'instabox-check-'));
 try{
  const result=await checkInstallation(root);
  assert.equal(result.sourceCount,36);
  assert.equal(result.sources.filter(row=>row.hold).length,18);
  assert.equal(result.sources.filter(row=>row.browserAdapterRequired).length,7);
  assert(result.blockers.some(row=>row.file==='migration-state.json'));
  assert.deepEqual(await readdir(root),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('the current exact 18 HOLD reasons are unchanged; old absolute reviewer paths are reported',async()=>{
 const original=await readFile(new URL('../original-relay-automation-20261017T0609Z/run-original-functions.js',import.meta.url),'utf8');
 const block=original.slice(original.indexOf(' const hold={'),original.indexOf(' }[sourceId]??readIsolation.holds'));
 const expected=Object.fromEntries([...block.matchAll(/'([^']+)':'([^']+)'/g)].map(match=>[match[1],match[2]]));
 assert.deepEqual(FIXED_HOLDS,expected);
 const check=await checkInstallation(resolve('.'));
 assert(check.blockers.some(row=>row.code==='MIGRATION_PATH_PORT_REQUIRED'&&row.file.endsWith('review-original-publication.mjs')));
});

test('a pending previous round blocks, without expiring, replying to, or rewriting its request',async()=>{
 const root=await mkdtemp(join(tmpdir(),'instabox-pending-'));
 try{
  const relay=join(root,'rounds/round-'+'a'.repeat(32),'connector-host-task/relay');
  await mkdir(relay,{recursive:true});
  await writeFile(join(relay,'original.request.ready'),'unchanged');
  await assert.rejects(pendingRequests(root),/PRIOR_ROUND_RECONCILE_ONLY/);
  assert.equal(await readFile(join(relay,'original.request.ready'),'utf8'),'unchanged');
  assert.deepEqual(await readdir(relay),['original.request.ready']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('--run without explicitly supplied machine password stops before Docker or source execution',async()=>{
 const env={...process.env};delete env.JOBFINDER_POSTGRES_PASSWORD;
 await assert.rejects(exec(process.execPath,[new URL('./native-round.mjs',import.meta.url).pathname,'--run'],{env}),error=>{
  assert.match(error.stderr,/MIGRATION_MACHINE_PASSWORD_REQUIRED/);return true;
 });
});

 test('requires an external session deadline instead of granting eight fresh hours from process start',()=>{
 const now=Date.parse('2026-10-31T00:00:00Z');
 assert.throws(()=>sessionWindow(undefined,now),/DEADLINE_REQUIRED/);
 assert.throws(()=>sessionWindow('2026-10-31T09:00:00Z',now),/DEADLINE_INVALID/);
 assert.throws(()=>sessionWindow('2026-10-30T23:00:00Z',now),/DEADLINE_INVALID/);
 assert.equal(sessionWindow('2026-10-31T03:00:00Z',now),now+3*60*60*1000);
 });

 test('a responded UNKNOWN publication still blocks after producer exit, without rewriting it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'instabox-unknown-'));
 try{
  const relay=join(root,'rounds/round-'+'b'.repeat(32),'connector-host-task/relay');await mkdir(relay,{recursive:true});
  const response=JSON.stringify({schemaVersion:1,kind:'PUBLISH',result:{status:'FAILED',outcome:'UNKNOWN',code:'PG_QUERY_OUTCOME_UNKNOWN'}});
  await writeFile(join(relay,'original.request.ready'),'unchanged');
  await writeFile(join(relay,'original.response.json'),response);
  await assert.rejects(pendingRequests(root),/PRIOR_ROUND_RECONCILE_ONLY/);
  assert.equal(await readFile(join(relay,'original.response.json'),'utf8'),response);
 }finally{await rm(root,{recursive:true,force:true});}
 });
