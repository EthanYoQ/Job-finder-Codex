/** Uses real own-process hashing modules against actual native client source.
 * All transport is intercepted in-process. No sockets, database or live fetch.
 */
import assert from 'node:assert/strict';
import {mock} from 'node:test';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pair, request, mockFallback, responseFor} from '../test/helpers.mjs';
const controller = process.argv[2];
if (!controller) throw Error('Usage: verify-client-contract.mjs <controller-root>');
const clientPath = resolve(controller, 'src/control-plane.mjs');
const {createControlPlane} = await import(pathToFileURL(clientPath));
const cleanups = [];
const t = {after: cleanup => cleanups.push(cleanup), mock};
try {
  const {main, fallback, aggregate} = await pair(t);
  mockFallback(t, fallback);
  const expected = {schemaVersion: 1, readers: {main: main.expected.reader, fallback: fallback.expected.reader}};
  const readerFilePins = {main: main.expected.reader.readerFileHashes, fallback: fallback.expected.reader.readerFileHashes};
  const openConnection = () => {throw Error('TEST_MUST_NOT_OPEN_DATABASE');};
  let recorded;
  const liveClient = createControlPlane({openConnection, readerFilePins, fetchImpl: async url => {
    assert.equal(new URL(url).origin, 'https://job.orz.md');
    recorded = await request(aggregate, {url});
    return responseFor(recorded);
  }});
  const current = await liveClient.readerIdentity(expected);
  assert.deepEqual(current.readers, expected.readers);
  assert.equal(current.checkedAt, new Date(Math.min(Date.parse(recorded.body.checkedAt),
    ...Object.values(recorded.body.observedAt).map(Date.parse))).toISOString());
  const staticClient = createControlPlane({openConnection, readerFilePins, fetchImpl: async () => responseFor(recorded)});
  await assert.rejects(() => staticClient.readerIdentity(expected), /CURRENT_READER_IDENTITY_MISMATCH/);
  const staleClient = createControlPlane({openConnection, readerFilePins, fetchImpl: async url => {
    const copy = structuredClone(recorded.body);
    copy.nonce = new URL(url).searchParams.get('nonce');
    copy.checkedAt = new Date().toISOString();
    copy.observedAt.fallback = '2020-01-01T00:00:00.000Z';
    return new Response(JSON.stringify(copy), {status: 200, headers: recorded.headers});
  }});
  await assert.rejects(() => staleClient.readerIdentity(expected), /CURRENT_CONTROL_PROOF_REQUIRED/);
  const wrongPins = structuredClone(readerFilePins);
  wrongPins.main['src/domain/jobLocation.ts'] = 'a'.repeat(64);
  await assert.rejects(() => createControlPlane({openConnection, readerFilePins: wrongPins,
    fetchImpl: () => {throw Error('SHOULD_REJECT_BEFORE_FETCH');}}).readerIdentity(expected), /REPLAY_READER_PIN_BINDING_REQUIRED/);
  console.log(JSON.stringify({status: 'PASS', tests: ['real measured aggregate accepted by actual native client',
    'static response replay rejected', 'refreshed envelope cannot hide stale fallback observation',
    'native replay file mismatch rejected before fetch'],
    clientSha256: createHash('sha256').update(await readFile(clientPath)).digest('hex'),
    nodeVersion: process.version, networkCalls: 0, databaseCalls: 0}, null, 2));
} finally {mock.restoreAll(); for (const cleanup of cleanups.reverse()) await cleanup();}
