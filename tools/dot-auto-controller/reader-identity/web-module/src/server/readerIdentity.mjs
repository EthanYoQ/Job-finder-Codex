/** Source-only integration. Run this entrypoint before importing httpServer.ts.
 * This reports pinned, observed files for this process only, not remote fallback
 * identity or a hardware attestation. Deploy on an immutable, reviewed release.
 */
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, open, realpath} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const READER_IDENTITY_PATH = '/.well-known/jobfinder-reader-identity.json';
export const READER_IDENTITY_PROJECT = 'yiopvxysxrtrnvqxwgbx';
export const READER_IDENTITY_FILES = Object.freeze([
  'src/domain/portablePublicSnapshot.ts',
  'src/domain/jobProjectionDeltaReceipt.ts',
  'src/db/portablePublicSnapshotRepository.ts',
  'src/crawler/sourceQualityAdmission.ts',
  'src/crawler/sourcePlan.ts',
  'src/data/companyRegistry.ts',
  'src/crawler/runSourceCrawl.ts',
  'src/crawler/completenessCertificate.ts',
  'src/crawler/traversalCertificate.ts',
  'src/crawler/runtimeBatchIdentity.ts',
  'src/db/prismaMappers.ts',
  'src/domain/publicationEligibility.ts',
  'src/release/portableCoveragePolicy.ts',
  'src/release/portableSourceCoverageHolds.ts',
  'package.json',
  'package-lock.json',
  'src/server/portablePublicationApi.ts',
  'src/server/publicApi.ts',
  'src/domain/jobLocation.ts'
]);
const BUILD_FILES = Object.freeze({
  manifestSha256: 'build-identity.json',
  entrypointSha256: 'src/server/httpServer.ts',
  proofModuleSha256: 'src/server/readerIdentity.mjs'
});
const EXPECTED_FILE = 'reader-identity-expected.json';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EXPECTED_BYTES = 32 * 1024;
const CHECK_LIMIT_MS = 5000;
const PROCESS_IDENTITY = Object.freeze({instanceId: randomUUID(),
  startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString()});
const NONCE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store, max-age=0',
  'pragma': 'no-cache',
  'expires': '0',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow'
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, JSON.parse(canonical(value[key]))])) : value);
const same = (a, b) => canonical(a) === canonical(b);
const exactKeys = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort());
const runtimeIdentity = () => ({nodeVersion: process.version, platform: process.platform, arch: process.arch});
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
function rememberStamp(stamps, key, value) {
  if (stamps[key] !== undefined && stamps[key] !== value) throw Error('READER_IDENTITY_UNAVAILABLE');
  stamps[key] = value;
}
async function directoryStamps(name) {
  const stamps = {};
  // Release directories are immutable: retain identity and change stamps so
  // rename/import/restore cannot hide a replaced ancestor of an allowed file.
  let path = ROOT;
  for (const part of ['.', ...name.split('/').slice(0, -1)]) {
    path = join(path, part);
    const stat = await lstat(path, {bigint: true});
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('READER_IDENTITY_UNAVAILABLE');
    stamps['directory:' + path] = stamp(stat);
  }
  // Outer deployment ancestry is a trusted boundary. Its identity is retained
  // without treating unrelated sibling creation as a release-file mutation.
  path = dirname(ROOT);
  for (;;) {
    const stat = await lstat(path, {bigint: true});
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('READER_IDENTITY_UNAVAILABLE');
    stamps['ancestor:' + path] = [stat.dev, stat.ino].join(':');
    if (dirname(path) === path) break;
    path = dirname(path);
  }
  return stamps;
}

// Paths only come from the source allowlist above. Neither requests nor the
// pin manifest can select files, directories, URLs, commands, or code to load.
async function readFixedFile(name, limit = MAX_FILE_BYTES, observedStamps) {
  const path = join(ROOT, name);
  if (await realpath(ROOT) !== ROOT) throw Error('READER_IDENTITY_UNAVAILABLE');
  const beforeDirectories = await directoryStamps(name);
  const before = await lstat(path, {bigint: true});
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > BigInt(limit)) {
    throw Error('READER_IDENTITY_UNAVAILABLE');
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await file.stat({bigint: true});
    if (stamp(before) !== stamp(opened)) throw Error('READER_IDENTITY_UNAVAILABLE');
    const bytes = Buffer.alloc(Number(opened.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await file.read(bytes, length, bytes.length - length, length);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat({bigint: true});
    const current = await lstat(path, {bigint: true});
    if (length !== Number(opened.size) || stamp(opened) !== stamp(after) || stamp(after) !== stamp(current)
      || await realpath(path) !== path) throw Error('READER_IDENTITY_UNAVAILABLE');
    const afterDirectories = await directoryStamps(name);
    if (!same(beforeDirectories, afterDirectories)) throw Error('READER_IDENTITY_UNAVAILABLE');
    if (observedStamps) {
      rememberStamp(observedStamps, name, stamp(after));
      for (const [key, value] of Object.entries(afterDirectories)) rememberStamp(observedStamps, key, value);
    }
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
function validateExpected(value) {
  if (!exactKeys(value, ['schemaVersion', 'projectId', 'reader']) || value.schemaVersion !== 1
    || value.projectId !== READER_IDENTITY_PROJECT) throw Error('READER_IDENTITY_UNAVAILABLE');
  const reader = value.reader;
  if (!exactKeys(reader, ['role', 'readerFileHashes', 'build', 'runtime'])
    || !['main', 'fallback'].includes(reader.role)
    || !exactKeys(reader.readerFileHashes, READER_IDENTITY_FILES)
    || !Object.values(reader.readerFileHashes).every(value => typeof value === 'string' && SHA.test(value))
    || !exactKeys(reader.build, Object.keys(BUILD_FILES))
    || !Object.values(reader.build).every(value => typeof value === 'string' && SHA.test(value))
    || !exactKeys(reader.runtime, ['nodeVersion', 'platform', 'arch'])
    || !same(reader.runtime, runtimeIdentity())) {
    throw Error('READER_IDENTITY_UNAVAILABLE');
  }
  return reader;
}
async function observe(role) {
  const started = performance.now();
  const readerFileHashes = {}, fileStamps = {};
  for (const name of READER_IDENTITY_FILES) {
    readerFileHashes[name] = hash(await readFixedFile(name, MAX_FILE_BYTES, fileStamps));
    if (performance.now() - started > CHECK_LIMIT_MS) throw Error('READER_IDENTITY_UNAVAILABLE');
  }
  const build = {};
  for (const [key, name] of Object.entries(BUILD_FILES)) build[key] = hash(await readFixedFile(name, MAX_FILE_BYTES, fileStamps));
  if (performance.now() - started > CHECK_LIMIT_MS) throw Error('READER_IDENTITY_UNAVAILABLE');
  return {reader: {role, readerFileHashes, build, runtime: runtimeIdentity()}, fileStamps};
}
function send(response, status, body, extraHeaders = {}) {
  response.statusCode = status;
  for (const [name, value] of Object.entries({...HEADERS, ...extraHeaders})) response.setHeader(name, value);
  response.end(JSON.stringify(body));
}

/** Call before importing application code; sealAfterApplicationLoad must run
 * after that import, before the server starts accepting requests. The exact
 * bootstrap at the bottom of this module enforces that sequence.
 */
export async function createReaderIdentitySession() {
  let expectedBytes, expected, baseline;
  const expectedStamps = {};
  try {
    expectedBytes = await readFixedFile(EXPECTED_FILE, MAX_EXPECTED_BYTES, expectedStamps);
    expected = validateExpected(JSON.parse(expectedBytes.toString('utf8')));
    baseline = await observe(expected.role);
    if (!same(expected, baseline.reader)) throw Error('READER_IDENTITY_UNAVAILABLE');
  } catch { throw Error('READER_IDENTITY_UNAVAILABLE'); }
  const expectedHash = hash(expectedBytes);
  const processIdentity = PROCESS_IDENTITY;
  let sealed = false, failed = false, busy = false;
  async function verify() {
    try {
      const currentExpectedStamps = {};
      if (failed || hash(await readFixedFile(EXPECTED_FILE, MAX_EXPECTED_BYTES, currentExpectedStamps)) !== expectedHash
        || !same(currentExpectedStamps, expectedStamps) || !same(await observe(expected.role), baseline)) throw Error('READER_IDENTITY_UNAVAILABLE');
    } catch { failed = true; throw Error('READER_IDENTITY_UNAVAILABLE'); }
  }
  async function sealAfterApplicationLoad() {
    if (sealed || failed) throw Error('READER_IDENTITY_UNAVAILABLE');
    await verify();
    sealed = true;
  }
  async function handle(request, response) {
    let url;
    try { url = new URL(request.url ?? '/', 'http://reader.invalid'); }
    catch { return false; }
    if (url.pathname !== READER_IDENTITY_PATH) return false;
    // Nothing from request headers/Host affects file access, role, or authority.
    if (request.method !== 'GET') {
      send(response, 405, {error: 'READER_IDENTITY_GET_REQUIRED'}, {allow: 'GET'}); return true;
    }
    const entries = [...url.searchParams];
    if (entries.length !== 1 || entries[0][0] !== 'nonce' || !NONCE.test(entries[0][1])) {
      send(response, 400, {error: 'READER_IDENTITY_NONCE_REQUIRED'}); return true;
    }
    if (!sealed || failed) {
      send(response, 503, {error: 'READER_IDENTITY_UNAVAILABLE'}); return true;
    }
    // One bounded observation at a time; no unbounded request queue or cached
    // identity fallback. Each accepted request performs its own fresh reads.
    if (busy) { send(response, 503, {error: 'READER_IDENTITY_BUSY'}); return true; }
    busy = true;
    try {
      await verify();
      send(response, 200, {schemaVersion: 1, projectId: READER_IDENTITY_PROJECT,
        nonce: entries[0][1], checkedAt: new Date().toISOString(),
        reader: structuredClone(baseline.reader), process: processIdentity});
    } catch { send(response, 503, {error: 'READER_IDENTITY_UNAVAILABLE'}); }
    finally { busy = false; }
    return true;
  }
  return Object.freeze({role: expected.role, sealAfterApplicationLoad, handle});
}

const FALLBACK_URL = 'http://127.0.0.1:3031' + READER_IDENTITY_PATH;
const MAX_PROOF_BYTES = 32 * 1024;
const FALLBACK_TIMEOUT_MS = 1000;
const exactIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
function validateOwnProof(body, role, nonce, startedAt, endedAt) {
  if (!exactKeys(body, ['schemaVersion', 'projectId', 'nonce', 'checkedAt', 'reader', 'process'])
    || body.schemaVersion !== 1 || body.projectId !== READER_IDENTITY_PROJECT || body.nonce !== nonce
    || !exactIso(body.checkedAt) || Date.parse(body.checkedAt) < startedAt - 1000
    || Date.parse(body.checkedAt) > endedAt + 1000
    || !exactKeys(body.process, ['instanceId', 'startedAt']) || !NONCE.test(body.process.instanceId)
    || !exactIso(body.process.startedAt) || Date.parse(body.process.startedAt) > Date.parse(body.checkedAt) + 1000) {
    throw Error('READER_IDENTITY_UNAVAILABLE');
  }
  // Fallback may have a different reviewed OS/architecture or Node patch. Its
  // values must be concrete, and the controller binds them to deployment pins.
  const reader = body.reader;
  if (!exactKeys(reader, ['role', 'readerFileHashes', 'build', 'runtime']) || reader.role !== role
    || !exactKeys(reader.readerFileHashes, READER_IDENTITY_FILES)
    || !Object.values(reader.readerFileHashes).every(value => typeof value === 'string' && SHA.test(value))
    || !exactKeys(reader.build, Object.keys(BUILD_FILES))
    || !Object.values(reader.build).every(value => typeof value === 'string' && SHA.test(value))
    || !exactKeys(reader.runtime, ['nodeVersion', 'platform', 'arch'])
    || typeof reader.runtime.nodeVersion !== 'string' || !/^v\d+\.\d+\.\d+$/.test(reader.runtime.nodeVersion)
    || !['linux', 'darwin', 'win32'].includes(reader.runtime.platform)
    || !['x64', 'arm64'].includes(reader.runtime.arch)) throw Error('READER_IDENTITY_UNAVAILABLE');
}
async function readFallbackProof(nonce) {
  const controller = new AbortController();
  let timer, reader;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(Error('READER_IDENTITY_UNAVAILABLE'));
  }, FALLBACK_TIMEOUT_MS); });
  try {
    return await Promise.race([timeout, (async () => {
      const url = FALLBACK_URL + '?nonce=' + nonce;
      const response = await fetch(url, {method: 'GET', cache: 'no-store', redirect: 'error', signal: controller.signal});
      if (response.status !== 200 || response.redirected || (response.url && response.url !== url)
        || !/(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers.get('cache-control') ?? '')
        || !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '')
        || Number(response.headers.get('content-length') ?? 0) > MAX_PROOF_BYTES || !response.body) {
        throw Error('READER_IDENTITY_UNAVAILABLE');
      }
      reader = response.body.getReader();
      let size = 0;
      const chunks = [];
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > MAX_PROOF_BYTES) throw Error('READER_IDENTITY_UNAVAILABLE');
        chunks.push(part.value);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

/** Optional aggregator for the existing original-domain topology. No listener,
 * proxy, or port is created here. Only this literal loopback destination is used.
 * Its absence, static response, invalid role, or timeout fails the whole proof.
 */
export function createReaderIdentityAggregator(mainSession) {
  if (mainSession?.role !== 'main') throw Error('READER_IDENTITY_UNAVAILABLE');
  let busy = false;
  return async function handleAggregate(request, response) {
    let url;
    try { url = new URL(request.url ?? '/', 'http://reader.invalid'); } catch { return false; }
    if (url.pathname !== READER_IDENTITY_PATH) return false;
    if (busy) { send(response, 503, {error: 'READER_IDENTITY_BUSY'}); return true; }
    busy = true;
    const started = Date.now();
    try {
      let status, ownBody;
      const ownHeaders = {};
      await mainSession.handle(request, {
        set statusCode(value) {status = value;},
        setHeader(name, value) {ownHeaders[name] = value;},
        end(value) {ownBody = JSON.parse(value);}
      });
      if (status !== 200) { send(response, status ?? 503, ownBody ?? {error: 'READER_IDENTITY_UNAVAILABLE'}, ownHeaders); return true; }
      validateOwnProof(ownBody, 'main', ownBody.nonce, started, Date.now());
      const fallback = await readFallbackProof(ownBody.nonce);
      validateOwnProof(fallback, 'fallback', ownBody.nonce, started, Date.now());
      // The per-role timestamps preserve their actual observations. A later
      // aggregate timestamp cannot refresh an old role observation.
      send(response, 200, {schemaVersion: 1, projectId: READER_IDENTITY_PROJECT,
        nonce: ownBody.nonce, checkedAt: new Date().toISOString(),
        observedAt: {main: ownBody.checkedAt, fallback: fallback.checkedAt},
        readers: {main: ownBody.reader, fallback: fallback.reader},
        processes: {main: ownBody.process, fallback: fallback.process}});
    } catch { send(response, 503, {error: 'READER_IDENTITY_UNAVAILABLE'}); }
    finally { busy = false; }
    return true;
  };
}

// Reviewed replacement start command: node --import tsx src/server/readerIdentity.mjs
// No automatic enablement in old entrypoints and no environment-derived pins.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (await realpath(process.cwd()) !== ROOT) throw Error('READER_IDENTITY_UNAVAILABLE');
    const identity = await createReaderIdentitySession();
    const {startServer} = await import('./httpServer.ts');
    await identity.sealAfterApplicationLoad();
    await startServer({readerIdentity: identity.role === 'main'
      ? createReaderIdentityAggregator(identity) : identity.handle});
  } catch {
    console.error('READER_IDENTITY_STARTUP_FAILED');
    process.exitCode = 1;
  }
}
