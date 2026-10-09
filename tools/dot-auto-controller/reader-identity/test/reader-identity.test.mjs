import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash, randomUUID} from 'node:crypto';
import {mkdir, readFile, rename, rm, symlink, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {READER_IDENTITY_FILES, READER_IDENTITY_PATH} from '../web-module/src/server/readerIdentity.mjs';
import {fixture, request, pair, mockFallback, responseFor} from './helpers.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('fresh own-process proof exactly matches observed 19 files, build and runtime; no extra metadata', async t => {
  const f = await fixture(t); await f.seal();
  const started = Date.now();
  const first = await request(f.session.handle), second = await request(f.session.handle);
  assert.equal(first.statusCode, 200); assert.equal(first.handled, true);
  assert.deepEqual(first.body.reader, f.expected.reader);
  assert.equal(Object.keys(first.body.reader.readerFileHashes).length, 19);
  assert.equal(first.body.nonce, first.nonce); assert.notEqual(first.body.nonce, second.body.nonce);
  assert.ok(Date.parse(first.body.checkedAt) >= started);
  assert.equal(first.headers['cache-control'], 'no-store, max-age=0');
  assert.deepEqual(Object.keys(first.body.process).sort(), ['instanceId', 'startedAt']);
  assert.equal(first.body.process.instanceId, second.body.process.instanceId);
  assert.ok(!first.text.includes(f.root)); assert.ok(!first.text.includes('authorization'));
  assert.deepEqual(Object.keys(first.body).sort(), ['checkedAt', 'nonce', 'process', 'projectId', 'reader', 'schemaVersion']);
});

test('unsealed session never claims its code has been imported', async t => {
  const f = await fixture(t);
  assert.equal((await request(f.session.handle)).statusCode, 503);
  await f.seal(); assert.equal((await request(f.session.handle)).statusCode, 200);
  await assert.rejects(f.seal, /^Error: READER_IDENTITY_UNAVAILABLE$/);
});

test('mutation while the application loads prevents sealing', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, READER_IDENTITY_FILES[0]), 'changed while loading');
  await assert.rejects(f.seal, /^Error: READER_IDENTITY_UNAVAILABLE$/);
  assert.equal((await request(f.session.handle)).statusCode, 503);
});

test('mutation then byte restoration during import is detected by retained file metadata', async t => {
  const f = await fixture(t);
  const path = join(f.root, 'src/server/publicApi.ts'), original = await readFile(path);
  await writeFile(path, 'export const unexpectedLoadedValue = true;');
  // A loader could consume the changed bytes in this window. Restoring equal
  // content must not make the pre/post import comparison pass.
  await writeFile(path, original);
  await assert.rejects(f.seal, /^Error: READER_IDENTITY_UNAVAILABLE$/);
  assert.equal((await request(f.session.handle)).statusCode, 503);
});

test('directory swap during import cannot hide restored original file inodes', async t => {
  const f = await fixture(t);
  const directory = join(f.root, 'src/domain'), originalDirectory = join(f.root, 'src/original-domain');
  await rename(directory, originalDirectory);
  await mkdir(directory);
  await writeFile(join(directory, 'jobLocation.ts'), 'export const unreviewed = true;');
  await rm(directory, {recursive: true});
  await rename(originalDirectory, directory);
  await assert.rejects(f.seal, /^Error: READER_IDENTITY_UNAVAILABLE$/);
  assert.equal((await request(f.session.handle)).statusCode, 503);
});

test('post-start replacement with identical bytes is detected without exposing stat metadata', async t => {
  const f = await fixture(t); await f.seal();
  const path = join(f.root, 'src/server/publicApi.ts'), original = await readFile(path);
  await rm(path); await writeFile(path, original);
  const result = await request(f.session.handle);
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body, {error: 'READER_IDENTITY_UNAVAILABLE'});
});

test('post-start file drift fails closed permanently, even when restored', async t => {
  const f = await fixture(t); await f.seal();
  const path = join(f.root, READER_IDENTITY_FILES[0]), original = await readFile(path);
  await writeFile(path, 'drift');
  assert.equal((await request(f.session.handle)).statusCode, 503);
  await writeFile(path, original);
  assert.equal((await request(f.session.handle)).statusCode, 503);
});

test('mutating disk and expected pins cannot fabricate a new loaded identity', async t => {
  const f = await fixture(t); await f.seal();
  const path = READER_IDENTITY_FILES[0];
  await writeFile(join(f.root, path), 'new code');
  f.expected.reader.readerFileHashes[path] = hash('new code');
  await writeFile(f.expectedPath, JSON.stringify(f.expected));
  assert.equal((await request(f.session.handle)).statusCode, 503);
});

test('missing expected manifest and missing allowed file fail startup without leaking paths', async t => {
  const f = await fixture(t);
  await rm(f.expectedPath);
  await assert.rejects(f.module.createReaderIdentitySession, /^Error: READER_IDENTITY_UNAVAILABLE$/);
  await writeFile(f.expectedPath, JSON.stringify(f.expected));
  await rm(join(f.root, READER_IDENTITY_FILES[0]));
  await assert.rejects(f.module.createReaderIdentitySession, /^Error: READER_IDENTITY_UNAVAILABLE$/);
});

test('manifest cannot add a path, remove a required hash, or change the project', async t => {
  const f = await fixture(t);
  for (const mutate of [x => {x.reader.readerFileHashes['.env'] = 'a'.repeat(64);},
    x => {delete x.reader.readerFileHashes[READER_IDENTITY_FILES[0]];},
    x => {x.projectId = 'other-project';}, x => {x.reader.build = {manifestSha256: 'a'.repeat(64)};},
    x => {x.reader.runtime.nodeVersion = 'v0.0.0';}]) {
    const invalid = structuredClone(f.expected); mutate(invalid);
    await writeFile(f.expectedPath, JSON.stringify(invalid));
    await assert.rejects(f.module.createReaderIdentitySession, /^Error: READER_IDENTITY_UNAVAILABLE$/);
  }
});

test('symlinks and directory substitutions cannot redirect allowlisted reads', async t => {
  const f = await fixture(t); await f.seal();
  const path = join(f.root, READER_IDENTITY_FILES[0]);
  const original = await readFile(path);
  await writeFile(join(f.root, 'secret'), original);
  await rm(path); await symlink(join(f.root, 'secret'), path);
  assert.equal((await request(f.session.handle)).statusCode, 503);
});

test('method, nonce, duplicate, arbitrary path and query inputs are bounded and rejected', async t => {
  const f = await fixture(t); await f.seal();
  assert.equal((await request(f.session.handle, {method: 'POST'})).statusCode, 405);
  for (const query of ['', '?nonce=static', '?nonce=' + randomUUID() + '&nonce=' + randomUUID(),
    '?nonce=' + randomUUID() + '&path=.env', '?nonce=' + 'a'.repeat(4000)]) {
    const result = await request(f.session.handle, {url: READER_IDENTITY_PATH + query});
    assert.equal(result.statusCode, 400); assert.equal(result.headers['cache-control'], 'no-store, max-age=0');
  }
  assert.equal((await request(f.session.handle, {url: '/api/search'})).handled, false);
});

test('build and proof implementation drift are independently checked', async t => {
  for (const path of ['build-identity.json', 'src/server/httpServer.ts', 'src/server/readerIdentity.mjs']) {
    const f = await fixture(t); await f.seal();
    await writeFile(join(f.root, path), 'changed');
    assert.equal((await request(f.session.handle)).statusCode, 503);
  }
});

test('aggregate performs fixed loopback nonce probe and preserves two independent observations', async t => {
  const {main, fallback, aggregate} = await pair(t);
  const mock = mockFallback(t, fallback);
  const result = await request(aggregate);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.readers, {main: main.expected.reader, fallback: fallback.expected.reader});
  assert.equal(result.body.nonce, result.nonce);
  assert.equal(new URL(mock.mock.calls[0].arguments[0]).searchParams.get('nonce'), result.nonce);
  assert.ok(Date.parse(result.body.observedAt.main) <= Date.parse(result.body.checkedAt));
  assert.ok(Date.parse(result.body.observedAt.fallback) <= Date.parse(result.body.checkedAt));
  assert.notEqual(result.body.processes.main.instanceId, result.body.processes.fallback.instanceId);
});

test('aggregate never returns partial main success when fallback is absent', async t => {
  const {aggregate} = await pair(t);
  t.mock.method(globalThis, 'fetch', async () => {throw Error('ECONNREFUSED: private path or host details');});
  const result = await request(aggregate);
  assert.equal(result.statusCode, 503); assert.deepEqual(result.body, {error: 'READER_IDENTITY_UNAVAILABLE'});
});

test('aggregate rejects static, stale, wrong-role and wrong-project fallback proofs', async t => {
  const {fallback, aggregate} = await pair(t);
  for (const mutate of [body => ({...body, nonce: randomUUID()}),
    body => ({...body, checkedAt: '2020-01-01T00:00:00.000Z'}),
    body => ({...body, projectId: 'other'}),
    body => ({...body, reader: {...body.reader, role: 'main'}}),
    body => ({...body, process: {...body.process, instanceId: 'static'}}),
    body => ({...body, unexpected: 'must reject extra shape'})]) {
    const mock = mockFallback(t, fallback, mutate);
    assert.equal((await request(aggregate)).statusCode, 503);
    mock.mock.restore();
  }
});

test('aggregate rejects redirects, cached and non-JSON fallback responses', async t => {
  const {fallback, aggregate} = await pair(t);
  for (const headers of [{'cache-control': 'public,max-age=300', 'content-type': 'application/json'},
    {'cache-control': 'no-store', 'content-type': 'text/html'}]) {
    const mock = mockFallback(t, fallback, x => x, headers);
    assert.equal((await request(aggregate)).statusCode, 503); mock.mock.restore();
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(null, {status: 302, headers: {location: 'http://evil.invalid'}}));
  assert.equal((await request(aggregate)).statusCode, 503);
});

test('aggregate limits remote response bytes and aborts a stalled fetch', async t => {
  const {aggregate} = await pair(t);
  const large = t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(32769), {
    headers: {'cache-control': 'no-store', 'content-type': 'application/json'}}));
  assert.equal((await request(aggregate)).statusCode, 503); large.mock.restore();
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, options) => {signal = options.signal; return new Promise(() => {});});
  const started = Date.now();
  assert.equal((await request(aggregate)).statusCode, 503);
  assert.ok(Date.now() - started < 2000); assert.ok(signal.aborted);
});

test('aggregate rejects overlapping probes instead of opening an unbounded queue', async t => {
  const {fallback, aggregate} = await pair(t);
  let release;
  const pending = new Promise(resolve => {release = resolve;});
  t.mock.method(globalThis, 'fetch', async url => {await pending; return responseFor(await request(fallback.session.handle, {url}));});
  const first = request(aggregate);
  // First invocation sets its bounded-busy flag before its initial filesystem read.
  const second = await request(aggregate);
  assert.equal(second.statusCode, 503); assert.deepEqual(second.body, {error: 'READER_IDENTITY_BUSY'});
  release(); assert.equal((await first).statusCode, 200);
});
