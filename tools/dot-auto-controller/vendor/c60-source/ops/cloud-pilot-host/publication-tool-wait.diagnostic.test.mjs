import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';

// Diagnostic of the existing transport contract, not a simulated DB/approval fix.
// Only the repository helper runs; every tool is replaced with a local fake.
const source = await readFile(new URL('./host-helper-functions.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sha = value => createHash('sha256').update(value).digest('hex');

test('a pending execute_sql promise outlives dispatch, response and overall budgets without a cancellation or renewal seam', async t => {
  const started = Date.parse('2026-10-03T01:51:18.018Z');
  t.mock.timers.enable({ apis: ['Date'], now: started });
  const body = {
    schemaVersion: 1, requestId: randomUUID(), kind: 'PUBLISH',
    expiresAt: '2026-10-03T01:55:04.931Z',
    payload: {
      projectId: 'yiopvxysxrtrnvqxwgbx',
      sql: 'synthetic publication: never sent to any database',
      dispatchBefore: '2026-10-03T01:52:19.931Z'
    }
  };
  const request = { ...body, requestSha256: sha(JSON.stringify(body)) };
  const bytes = JSON.stringify(request), events = [];
  let rejectTool;
  const pendingTool = new Promise((_resolve, reject) => { rejectTool = reject; });
  const tools = {
    exec_command: async ({ cmd }) => {
      if (cmd.includes(' mark-dispatch ')) events.push('marked');
      if (cmd.includes(' respond ')) events.push('responded');
      return { exit_code: 0, output: JSON.stringify({ text: bytes, sha256: sha(bytes), charCount: bytes.length, next: null }) };
    },
    apply_patch: async () => { events.push('saved'); return {}; },
    mcp__codex_apps__supabase_execute_sql: args => {
      assert.deepEqual(args, { project_id: body.payload.projectId, query: body.payload.sql });
      events.push('tool-called');
      return pendingTool;
    }
  };
  const helper = await new AsyncFunction('tools', 'load', 'store', source)(
    tools, () => ({ root: '/synthetic', repo: '/synthetic', project: body.payload.projectId }), () => {}
  );
  let settled = false;
  const dispatched = helper.sqlDispatch(request, '/synthetic', body.payload.sql).then(result => { settled = true; return result; });
  await setImmediate();
  assert.deepEqual(events, ['marked', 'tool-called']);

  // Advance past the recorded response deadline, 300-second owner lease,
  // 550-second whole-run budget and the observed approximately 20-minute wait.
  t.mock.timers.setTime(started + 20 * 60 * 1000);
  await setImmediate();
  assert.equal(settled, false);
  assert.deepEqual(events, ['marked', 'tool-called']);

  // A database error is the first new information exposed by this tool shape.
  rejectTool(new Error('{"code":"P0001","message":"CRAWL_LEASE_LOST"}'));
  assert.deepEqual(await dispatched, { status: 'FAILED', outcome: 'UNKNOWN', code: 'UNKNOWN' });
  assert.deepEqual(events, ['marked', 'tool-called', 'saved', 'responded']);
});
