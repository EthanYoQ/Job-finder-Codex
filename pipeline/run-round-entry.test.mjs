import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('invalid round identity emits bounded ROUND_FAILED before any collector command',()=>{
  const privateValue='INVALID_PRIVATE_ROUND_ID';
  const child=spawnSync(process.execPath,[
    '--import',new URL('../runner-candidate/scripts/local-check-loader.mjs',import.meta.url).href,
    fileURLToPath(new URL('./run-round.ts',import.meta.url))
  ],{encoding:'utf8',env:{...process.env,JOBFINDER_ROUND_ID:privateValue,
    JOBFINDER_CANDIDATE_ID:'instabox-entry-test',POSTGRES_PASSWORD:'SYNTHETIC_PASSWORD'}});
  assert.equal(child.signal,null);
  assert.equal(child.status,1,child.stderr);
  assert.equal(child.stdout,'');
  const records=child.stderr.trim().split(/\r?\n/u).map(line=>JSON.parse(line));
  assert.equal(records.length,1);
  assert.equal(records[0].status,'ROUND_FAILED');
  assert.equal(child.stderr.includes(privateValue),false);
  assert.equal(child.stderr.includes('SYNTHETIC_PASSWORD'),false);
});
