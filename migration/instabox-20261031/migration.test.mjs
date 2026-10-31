import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPostgresExecutor} from './postgres-executor.mjs';
import {savePublicSnapshot, readPublicSnapshot} from './public-snapshot-file.mjs';

function fakeClient({connectError, queryError, closeError, result} = {}) {
  const calls = [];
  return {calls, on() {}, async connect() { calls.push('connect'); if (connectError) throw connectError; },
    async query(sql) { calls.push(sql); if (queryError) throw queryError; return result; },
    async end() { calls.push('end'); if (closeError) throw closeError; }};
}

test('sends the native multi-statement query once without changing its transaction', async () => {
  const sql = 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT 7; ROLLBACK;';
  const client = fakeClient({result: [{rows: []}, {rows: [{value: 7}]}, {rows: []}]});
  assert.deepEqual(await createPostgresExecutor(() => client)(sql), {status: 'SUCCEEDED', rows: [{value: 7}]});
  assert.deepEqual(client.calls, ['connect', sql, 'end']);
});

test('connection failure does not submit SQL or expose the credential-bearing error', async () => {
  const client = fakeClient({connectError: Error('postgres://private:secret@host/db')});
  assert.deepEqual(await createPostgresExecutor(() => client)('DO $$ BEGIN END $$;'), {status: 'FAILED', outcome: 'NOT_DISPATCHED'});
  assert.deepEqual(client.calls, ['connect', 'end']);
});

test('lost publication response remains UNKNOWN without retry; cleanup cannot rewrite success', async () => {
  const client = fakeClient({queryError: Error('socket closed after possible commit'), closeError: Error('closed')});
  assert.deepEqual(await createPostgresExecutor(() => client)('native publication'), {status: 'FAILED', outcome: 'UNKNOWN'});
  assert.equal(client.calls.filter(call => call === 'native publication').length, 1);
  const completed = fakeClient({result: {rows: []}, closeError: Error('closed')});
  assert.deepEqual(await createPostgresExecutor(() => completed)('native publication'), {status: 'SUCCEEDED', rows: []});
});

test('snapshot survives a restart read unchanged; rejected input preserves the last good file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobfinder-snapshot-'));
  try {
    const file = join(dir, 'public-snapshot.json');
    const snapshot = {schemaVersion: 'portable-public-snapshot-v1', generatedAt: '2026-10-30T00:00:00.000Z',
      sources: [{sourceId: 'synthetic-only', lastSuccessAt: '2026-10-29T23:00:00.000Z'}], companies: [], totalJobs: 0};
    await savePublicSnapshot(file, snapshot);
    assert.deepEqual(await readPublicSnapshot(file), snapshot);
    const saved = await readFile(file, 'utf8');
    await assert.rejects(savePublicSnapshot(file, {schemaVersion: 'raw-database'}), /PUBLIC_SNAPSHOT_INVALID/);
    assert.equal(await readFile(file, 'utf8'), saved);
    assert.deepEqual(await readdir(dir), ['public-snapshot.json']);
    await writeFile(file, '{broken');
    await assert.rejects(readPublicSnapshot(file), SyntaxError);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
