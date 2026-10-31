import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRefreshStatusReader } from '../web-candidate/src/server/savedRefreshStatus.ts';
import { createServer } from '../web-candidate/src/server/httpServer.ts';

const receipt = {
  kind: 'live', slot: '1793419260000', trigger: 'timer', complete: false, webReadback: true,
  capturedSourceIds: ['source-merck-china-social'], sha256: 'a'.repeat(64), verifiedAt: '2026-10-31T04:04:00.000Z'
};
const unavailable = { status: 'UNAVAILABLE' };

test('refresh projection bounds receipts and strips private fields; invalid data never retains success', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jobfinder-health-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'custom-schedule.json');
  const read = createRefreshStatusReader(join(dir, 'unused-snapshot.json'), file);
  assert.deepEqual(await read(), unavailable);
  const records = Array.from({ length: 19 }, (_, i) => ({ ...receipt, slot: String(Number(receipt.slot) + i),
    trigger: i === 18 ? 'manual' : 'timer', secret: 'PRIVATE_MARKER', snapshotFile: '/private/PRIVATE_MARKER' }));
  await writeFile(file, JSON.stringify({ records, env: { key: 'PRIVATE_MARKER' }, timerSlots: records.map(row => row.slot),
    dailySince: receipt.verifiedAt, qualifyingDays: ['2026-10-28', '2026-10-29', '2026-10-30'] }));
  const projected = await read();
  assert.equal(projected.status, 'AVAILABLE');
  assert.equal(projected.records.length, 16);
  assert.deepEqual(projected.timerSlots, records.slice(-16).map(row => row.slot));
  assert.equal(projected.records[0].slot, records[3].slot);
  assert.equal(projected.records.at(-1).trigger, 'manual');
  assert.equal(projected.records.at(-1).complete, false);
  assert.equal(projected.dailySince, receipt.verifiedAt);
  assert.deepEqual(projected.qualifyingDays, ['2026-10-28', '2026-10-29', '2026-10-30']);
  assert.deepEqual(Object.keys(projected.records[0]).sort(),
    ['slot', 'trigger', 'complete', 'webReadback', 'capturedSourceIds', 'sha256', 'verifiedAt'].sort());
  assert.ok(!JSON.stringify(projected).includes('PRIVATE_MARKER'));
  for (const change of [{ capturedSourceIds: ['source-PRIVATE_MARKER'] }, { trigger: 'PRIVATE_MARKER' },
    { kind: 'synthetic' }, { complete: 'true' }, { sha256: 'PRIVATE_MARKER' }, { verifiedAt: 'PRIVATE_MARKER' }]) {
    await writeFile(file, JSON.stringify({ timerSlots: [], records: [{ ...receipt, ...change }] }));
    assert.deepEqual(await read(), unavailable);
  }
  await writeFile(file, JSON.stringify({ timerSlots: ['PRIVATE_MARKER'], records: [receipt] }));
  assert.deepEqual(await read(), unavailable);
  await writeFile(file, '{truncated PRIVATE_MARKER');
  assert.deepEqual(await read(), unavailable);
  await rm(file);
  assert.deepEqual(await read(), unavailable);
});

test('public health GET exposes current schedule projection without consent, database or snapshot reads', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'jobfinder-health-route-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const snapshotFile = join(dir, 'public.json');
  const file = snapshotFile + '.schedule.json';
  const server = createServer({ readPortableSnapshot: async () => { throw Error('UNEXPECTED_SNAPSHOT_READ'); },
    readRefreshStatus: createRefreshStatusReader(snapshotFile) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/readyz', '/healthz']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual(await response.json(), { ok: true, mode: 'SAVED_PUBLIC_SNAPSHOT',
      writeBackendConfigured: false, refresh: unavailable });
  }
  await writeFile(file, JSON.stringify({ timerSlots: [receipt.slot], records: [receipt] }));
  const body = await (await fetch(base + '/readyz')).json();
  assert.equal(body.refresh.status, 'AVAILABLE');
  assert.equal(body.refresh.records[0].complete, false);
  assert.equal(body.refresh.records[0].webReadback, true);
  assert.deepEqual(await (await fetch(base + '/livez')).json(), { ok: true });
});
