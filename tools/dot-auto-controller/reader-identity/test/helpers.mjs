import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {READER_IDENTITY_FILES, READER_IDENTITY_PATH, READER_IDENTITY_PROJECT} from '../web-module/src/server/readerIdentity.mjs';
const SOURCE = fileURLToPath(new URL('../web-module/src/server/readerIdentity.mjs', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtime = {nodeVersion: process.version, platform: process.platform, arch: process.arch};

export async function fixture(t, role = 'main') {
  const root = await mkdtemp(join(tmpdir(), 'reader-identity-offline-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const path of [...READER_IDENTITY_FILES, 'build-identity.json', 'src/server/httpServer.ts']) {
    await mkdir(dirname(join(root, path)), {recursive: true});
    await writeFile(join(root, path), path === 'package.json' ? '{"type":"module"}' : 'synthetic offline fixture: ' + path + '\n');
  }
  await copyFile(SOURCE, join(root, 'src/server/readerIdentity.mjs'));
  const readerFileHashes = {};
  for (const path of READER_IDENTITY_FILES) readerFileHashes[path] = hash(await readFile(join(root, path)));
  const expected = {schemaVersion: 1, projectId: READER_IDENTITY_PROJECT, reader: {
    role, readerFileHashes, build: {
      manifestSha256: hash(await readFile(join(root, 'build-identity.json'))),
      entrypointSha256: hash(await readFile(join(root, 'src/server/httpServer.ts'))),
      proofModuleSha256: hash(await readFile(join(root, 'src/server/readerIdentity.mjs')))
    }, runtime
  }};
  const expectedPath = join(root, 'reader-identity-expected.json');
  await writeFile(expectedPath, JSON.stringify(expected));
  const module = await import(pathToFileURL(join(root, 'src/server/readerIdentity.mjs')));
  const session = await module.createReaderIdentitySession();
  return {root, expected, expectedPath, module, session, seal: () => session.sealAfterApplicationLoad()};
}
export async function request(handler, options = {}) {
  const nonce = options.nonce ?? randomUUID();
  const response = {statusCode: 0, headers: {}, text: undefined,
    setHeader(name, value) {this.headers[name.toLowerCase()] = value;},
    end(value) {this.text = value; this.body = JSON.parse(value);}};
  const handled = await handler({method: options.method ?? 'GET',
    url: options.url ?? READER_IDENTITY_PATH + '?nonce=' + nonce,
    headers: {host: 'untrusted.example', authorization: 'must-not-echo'}}, response);
  return {handled, nonce, ...response};
}
export const responseFor = result => new Response(result.text, {status: result.statusCode, headers: result.headers});
export async function pair(t) {
  const main = await fixture(t, 'main'), fallback = await fixture(t, 'fallback');
  await main.seal(); await fallback.seal();
  const aggregate = main.module.createReaderIdentityAggregator(main.session);
  return {main, fallback, aggregate};
}
export function mockFallback(t, fallback, mutate = body => body, headers) {
  return t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).origin, 'http://127.0.0.1:3031');
    assert.equal(new URL(url).pathname, READER_IDENTITY_PATH);
    assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
    const result = await request(fallback.session.handle, {url});
    return new Response(JSON.stringify(mutate(result.body)), {status: result.statusCode, headers: headers ?? result.headers});
  });
}

