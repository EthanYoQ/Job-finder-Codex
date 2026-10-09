import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname.replace(/\/$/, '');
const source = await readFile(root + '/host-helper-functions.js', 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sha = text => createHash('sha256').update(text).digest('hex');
const delimiter = '$atomic_' + 'a'.repeat(32) + '$';
const atomicSql = `SET LOCAL statement_timeout = '120000ms';\nDO ${delimiter}\nDECLARE affected bigint; job_data jsonb;\nBEGIN\nRAISE EXCEPTION 'CRAWL_LEASE_LOST';\nEND;\n${delimiter};`;
const databaseError = {
  content: [{ type: 'text', text: JSON.stringify({ error: { name: 'HttpException', message: 'Failed to run sql query: ERROR:  P0001: CRAWL_LEASE_LOST\nCONTEXT:  PL/pgSQL function inline_code_block line 11 at RAISE\n' } }) }],
  structuredContent: { error_code: 'INVALID_ARGUMENT' }, isError: true
};
const failure = outcome => ({ status: 'FAILED', outcome, code: outcome === 'ROLLED_BACK' ? 'P0001' : 'UNKNOWN' });
function request(kind = 'PUBLISH', sql = atomicSql, expired = false) {
  const deadline = Date.now() + (expired ? -1000 : 60000);
  const body = { schemaVersion: 1, requestId: randomUUID(), kind, expiresAt: new Date(deadline).toISOString(), payload: { projectId: 'yiopvxysxrtrnvqxwgbx', sql, dispatchBefore: new Date(deadline - 1000).toISOString() } };
  return { ...body, requestSha256: sha(JSON.stringify(body)) };
}
async function dispatch(r, returned, thrown) {
  const bytes = JSON.stringify(r), saved = [], calls = [];
  const tools = {
    exec_command: async () => ({ exit_code: 0, output: JSON.stringify({ text: bytes, sha256: sha(bytes), charCount: bytes.length, next: null }) }),
    apply_patch: async patch => { saved.push(JSON.parse(patch.split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n'))); return {}; },
    mcp__codex_apps__supabase_execute_sql: async args => { calls.push(args); if (thrown) throw thrown; return returned; }
  };
  const h = await new AsyncFunction('tools', 'load', 'store', source)(tools, () => ({ root, repo: root, project: r.payload.projectId }), () => {});
  return { result: await h.sqlDispatch(r, root, r.payload.sql), saved, calls };
}

test('records the exact database lease exception as rollback with its late tool envelope, once', async () => {
  const r = request('PUBLISH', atomicSql, true), out = await dispatch(r, databaseError);
  assert.deepEqual(out.result, failure('ROLLED_BACK'));
  assert.equal(out.calls.length, 1);
  assert.deepEqual(out.saved[0].diagnostic.toolResult, databaseError);
  assert.equal(out.saved[0].diagnostic.responseExpired, true);
  assert.equal(out.saved[0].requestSha256, r.requestSha256);
});
test('keeps transport errors, lookalike text, malformed envelopes and multi-statement publications unknown', async () => {
  for (const [r, raw, thrown] of [
    [request(), undefined, new Error(JSON.stringify({ code: 'P0001', message: 'CRAWL_LEASE_LOST' }))],
    [request(), undefined, new Error('Connection lost after statement completion')],
    [request(), { ...databaseError, isError: false }],
    [request(), { ...databaseError, structuredContent: { error_code: 'INTERNAL_SERVER_ERROR' } }],
    [request(), { ...databaseError, content: [{ type: 'text', text: 'ERROR: P0001: CRAWL_LEASE_LOST' }] }],
    [request(), { ...databaseError, content: [{ type: 'text', text: databaseError.content[0].text.replace('P0001', '40003') }] }],
    [request('LEASE_RENEW'), databaseError],
    [request('PUBLISH', atomicSql + '\nCOMMIT;'), databaseError],
    [request('PUBLISH', atomicSql.replace("RAISE EXCEPTION", `${delimiter}; SELECT 1; DO ${delimiter}\nRAISE EXCEPTION`)), databaseError]
  ]) assert.deepEqual((await dispatch(r, raw, thrown)).result, failure('UNKNOWN'));
});
test('preserves ordinary success even when returned data contains an error-looking string', async () => {
  const rows = [{ text: 'ERROR: P0001: CRAWL_LEASE_LOST' }];
  const raw = { content: [{ type: 'text', text: JSON.stringify({ result: '\n<untrusted-data-test>\n' + JSON.stringify(rows) + '\n</untrusted-data-test>' }) }] };
  const out = await dispatch(request(), raw);
  assert.deepEqual(out.result, { status: 'SUCCEEDED', rows });
  assert.equal(Object.hasOwn(out.saved[0], 'diagnostic'), false);
});
for (const code of ['55P03', '57014']) test('records an authoritative DB-started ' + code + ' timeout as rollback without replay', async () => {
  const sql = atomicSql.replace('job_data jsonb;', 'job_data jsonb; current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;');
  const raw = { ...databaseError, content: [{ type: 'text', text: JSON.stringify({ error: { name: 'HttpException', message: 'Failed to run sql query: ERROR:  ' + code + ': canceling statement due to timeout\n' } }) }] };
  const out = await dispatch(request('PUBLISH', sql), raw);
  assert.deepEqual(out.result, { status: 'FAILED', outcome: 'ROLLED_BACK', code });
  assert.equal(out.calls.length, 1);
  assert.deepEqual((await dispatch(request('PUBLISH', sql), undefined, new Error(raw.content[0].text))).result, failure('UNKNOWN'));
});
test('records a DB-started context refusal as rollback without generalizing transport errors', async () => {
  const sql = atomicSql.replace('job_data jsonb;', 'job_data jsonb; current_context jsonb; current_count bigint; current_hash text; aggregate_hash text;');
  const raw = { ...databaseError, content: [{ type: 'text', text: databaseError.content[0].text.replace('CRAWL_LEASE_LOST', 'PILOT_CONTEXT_CHANGED') }] };
  assert.deepEqual((await dispatch(request('PUBLISH', sql), raw)).result, failure('ROLLED_BACK'));
});

async function directory(t) {
  const parent = '/workspace/shared/job-finder-recovery';
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(parent + '/publication-cleanup-test-');
  t.after(() => rm(dir, { recursive: true, force: false }));
  return dir;
}
const run = (dir, command, r, hash = r?.requestSha256) => JSON.parse(execFileSync('node', [root + '/relay-files.mjs', command, dir, ...(r ? [r.requestId, hash] : [])], { encoding: 'utf8', stdio: 'pipe' }));
const put = (dir, r) => writeFile(join(dir, r.requestId + '.request.json'), JSON.stringify(r), { flag: 'wx' });
const response = (dir, r) => readFile(join(dir, r.requestId + '.response.json'), 'utf8').then(JSON.parse);
const marker = (r, state) => ({ schemaVersion: 1, requestId: r.requestId, requestSha256: r.requestSha256, kind: r.kind, state, markedAt: new Date().toISOString() });

test('settles expired unsent controls locally and never implies that a lease was released', async t => {
  const dir = await directory(t), r = request('LEASE_RELEASE', 'synthetic SQL', true);
  await put(dir, r);
  assert.equal(run(dir, 'expire-undispatched', r).settled, true);
  assert.deepEqual((await response(dir, r)).result, { status: 'FAILED', outcome: 'NOT_DISPATCHED', code: 'REQUEST_EXPIRED' });
  assert.equal(JSON.parse(await readFile(join(dir, r.requestId + '.dispatch.json'), 'utf8')).state, 'NOT_DISPATCHED');
  assert.equal(run(dir, 'expire-undispatched', r).settled, true);
  assert.throws(() => run(dir, 'mark-dispatch', r), /REQUEST_EXPIRED/);
});
test('retains MAY_HAVE_BEEN_SENT unchanged, without a fabricated response', async t => {
  const dir = await directory(t), r = request('PUBLISH', atomicSql, true);
  await put(dir, r);
  const bytes = JSON.stringify(marker(r, 'MAY_HAVE_BEEN_SENT'));
  await writeFile(join(dir, r.requestId + '.dispatch.json'), bytes, { flag: 'wx' });
  assert.deepEqual(run(dir, 'expire-undispatched', r), { settled: false, reason: 'DISPATCH_UNCERTAIN', requestId: r.requestId });
  assert.equal(await readFile(join(dir, r.requestId + '.dispatch.json'), 'utf8'), bytes);
  await assert.rejects(access(join(dir, r.requestId + '.response.json')), { code: 'ENOENT' });
});
test('checks expiry and request SHA before claiming, and resumes only its own NOT_DISPATCHED marker', async t => {
  const dir = await directory(t), live = request(), expired = request('READ_OUTCOME', 'SELECT 1', true);
  await put(dir, live); await put(dir, expired);
  assert.throws(() => run(dir, 'expire-undispatched', live), /REQUEST_NOT_EXPIRED/);
  assert.throws(() => run(dir, 'expire-undispatched', expired, 'f'.repeat(64)), /REQUEST_REVIEW_HASH/);
  await assert.rejects(access(join(dir, expired.requestId + '.dispatch.json')), { code: 'ENOENT' });
  await writeFile(join(dir, expired.requestId + '.dispatch.json'), JSON.stringify(marker(expired, 'NOT_DISPATCHED')), { flag: 'wx' });
  assert.equal(run(dir, 'expire-undispatched', expired).settled, true);
  assert.equal((await response(dir, expired)).requestSha256, expired.requestSha256);
});
test('next drains only expired unsent controls before selecting a live request, without SQL calls', async t => {
  const dir = await directory(t), expired = [request('READ_OUTCOME', 'SELECT 1', true), request('LEASE_RELEASE', 'synthetic SQL', true)], live = request('READ_CONTEXT', 'SELECT 2');
  for (const r of [...expired, live]) await put(dir, r);
  const tools = {
    exec_command: async ({ cmd }) => {
      // Host-file scope is exercised by its existing binding suite. This local
      // harness uses the real relay CLI plus a bounded read of its fixture.
      if (cmd.includes('host-files.mts')) {
        assert.ok(cmd.includes(live.requestId + '.request.json'));
        const bytes = await readFile(join(dir, live.requestId + '.request.json'), 'utf8');
        return { exit_code: 0, output: JSON.stringify({ text: bytes, sha256: sha(bytes), charCount: bytes.length, next: null }) };
      }
      return { exit_code: 0, output: execFileSync('bash', ['-c', cmd], { encoding: 'utf8', stdio: 'pipe' }) };
    },
    mcp__codex_apps__supabase_execute_sql: async () => { throw Error('SQL_MUST_NOT_RUN'); }
  };
  const h = await new AsyncFunction('tools', 'load', 'store', source)(tools, () => ({ root, repo: root, project: live.payload.projectId }), () => {});
  assert.deepEqual(await h.next(dir), { ...live, expired: false, dispatchRecorded: false });
  for (const r of expired) assert.equal((await response(dir, r)).result.outcome, 'NOT_DISPATCHED');
});
