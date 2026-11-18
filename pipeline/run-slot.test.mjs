import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
const bashAvailable=existsSync(bash);
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const slot='1794950460000',roundId='a'.repeat(32);

async function fixture(t) {
  const cache=resolve('.runtime/.cache');
  await mkdir(cache,{recursive:true});
  const root=(await mkdtemp(join(cache,'run-slot-test-'))).replaceAll('\\','/');
  t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'app/bin'),{recursive:true});
  await mkdir(join(root,'snapshots'));
  await mkdir(join(root,'commands'));
  const script=(await readFile(new URL('./run-slot.sh',import.meta.url),'utf8')).replaceAll('/data/job-finder',root);
  await writeFile(join(root,'entry.sh'),script);
  // This fixture tests receipt/dispatch behavior. Real flock ownership is unchanged.
  await writeFile(join(root,'commands/flock'),'#!/bin/bash\nexit 0\n',{mode:0o755});
  await writeFile(join(root,'app/bin/node'),`#!/bin/bash\nif [[ $1 == -e ]]; then exec ${quote(process.execPath.replaceAll('\\','/'))} "$@"; fi\nprintf '%s\\n' "$JOBFINDER_ROUND_ID" >> ${quote(root+'/launches')}\n`,{mode:0o755});
  const invoke=(...args)=>spawnSync(bash,[root+'/entry.sh',...args],{encoding:'utf8',env:{...process.env,
    PATH:root+'/commands'+(process.platform==='win32'?';':':')+process.env.PATH}});
  const receipt=(name,value)=>writeFile(join(root,'snapshots',name),JSON.stringify(value));
  return {root,invoke,receipt};
}

test('same terminal partial round returns its immutable receipt without launching again',{skip:!bashAvailable},async t=>{
  const f=await fixture(t);
  const expected={slot,roundId,complete:false,status:'SNAPSHOT_SAVED'};
  await f.receipt(`round-${roundId}.json`,expected);
  const result=f.invoke(slot,roundId);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),expected);
  assert.equal(existsSync(join(f.root,'launches')),false);
});

test('old same-slot latest receipt cannot satisfy a new wave',{skip:!bashAvailable},async t=>{
  const f=await fixture(t);
  await f.receipt('latest.json',{slot,complete:true,roundId:'b'.repeat(32)});
  const result=f.invoke(slot,roundId);
  assert.equal(result.status,0,result.stderr);
  assert.equal((await readFile(join(f.root,'launches'),'utf8')).trim(),roundId);
});

test('crash after durable latest promotes the matching receipt without collecting again',{skip:!bashAvailable},async t=>{
  const f=await fixture(t);
  const expected={slot,roundId,complete:false,retrySources:[{sourceId:'source-amgen',retryAt:Date.parse('2026-11-18T05:00:00Z')}]};
  await f.receipt('latest.json',expected);
  const result=f.invoke(slot,roundId);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(f.root,'snapshots',`round-${roundId}.json`),'utf8')),expected);
  assert.deepEqual(JSON.parse(result.stdout),expected);
  assert.equal(existsSync(join(f.root,'launches')),false);
});

test('mismatched or corrupt immutable receipt fails closed',{skip:!bashAvailable},async t=>{
  const f=await fixture(t);
  await f.receipt(`round-${roundId}.json`,{slot,roundId:'b'.repeat(32),complete:false});
  assert.equal(f.invoke(slot,roundId).status,2);
  await writeFile(join(f.root,'snapshots',`round-${roundId}.json`),'{');
  assert.equal(f.invoke(slot,roundId).status,2);
  assert.equal(existsSync(join(f.root,'launches')),false);
});

test('legacy invocation reuses complete latest and invalid wave IDs never launch',{skip:!bashAvailable},async t=>{
  const f=await fixture(t);
  await f.receipt('latest.json',{slot,complete:true});
  assert.equal(f.invoke(slot).status,0);
  assert.equal(f.invoke(slot,'../bad').status,2);
  assert.equal(existsSync(join(f.root,'launches')),false);
});
