/** TEST_ONLY real-reader fixture. Never a production reader qualification.
 * Copies the fixed vendor 19-file allowlists, then uses the unchanged original
 * identity module and control-plane client with in-process transport only.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {copyFile, lstat, mkdir, readFile, realpath, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {combinedReaderPins} from '../../src/reader-pin-binding.mjs';
import {READER_IDENTITY_FILES, READER_IDENTITY_PROJECT} from '../../reader-identity/web-module/src/server/readerIdentity.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPOSITORY_ROOT = resolve(PACKAGE_ROOT, '../..');
const CASES_ROOT = join(REPOSITORY_ROOT, 'evidence/install/reader-cases');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function requireSafeAncestors(path) {
  for (let current = resolve(path);; current = dirname(current)) {
    const stat = await lstat(current);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'TEST_READER_DIRECTORY_REQUIRED');
    if (dirname(current) === current) break;
  }
}

/** Prepare under this candidate's evidence tree only. Use the same Node binary
 * here and in the later helper subprocess: runtime pins are deliberately exact.
 * Existing case roots are refused; no source, fixture, or manifest is replaced.
 */
export async function prepareReaderFixture({packageRoot, caseRoot}) {
  assert.equal(resolve(packageRoot), PACKAGE_ROOT, 'TEST_READER_PACKAGE_SCOPE');
  assert.equal(await realpath(packageRoot), PACKAGE_ROOT, 'TEST_READER_PACKAGE_REALPATH');
  caseRoot = resolve(caseRoot);
  const child = relative(CASES_ROOT, caseRoot);
  assert(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(child), 'TEST_READER_CASE_SCOPE');
  await mkdir(CASES_ROOT, {recursive: true, mode: 0o700});
  await requireSafeAncestors(CASES_ROOT);
  await mkdir(caseRoot, {mode: 0o700});

  const nativePins = JSON.parse(await readFile(join(PACKAGE_ROOT, 'config/reader-pins.json'), 'utf8'));
  const apiPins = JSON.parse(await readFile(join(PACKAGE_ROOT, 'config/reader-api-pins.json'), 'utf8'));
  const readerFilePins = combinedReaderPins(nativePins, apiPins);
  const originalModule = join(PACKAGE_ROOT, 'reader-identity/web-module/src/server/readerIdentity.mjs');
  const runtime = {nodeVersion: process.version, platform: process.platform, arch: process.arch};
  const readerRoots = {}, readers = {};
  for (const role of ['main', 'fallback']) {
    assert.deepEqual(Object.keys(readerFilePins[role]).sort(), [...READER_IDENTITY_FILES].sort());
    const root = readerRoots[role] = join(caseRoot, role);
    await mkdir(root, {mode: 0o700});
    const sourceRoot = join(PACKAGE_ROOT, 'vendor/reader-' + role);
    for (const name of READER_IDENTITY_FILES) {
      const source = join(sourceRoot, name), target = join(root, name);
      const st = await lstat(source);
      assert(st.isFile() && !st.isSymbolicLink(), 'TEST_READER_VENDOR_FILE');
      assert.equal(sha(await readFile(source)), readerFilePins[role][name], 'TEST_READER_VENDOR_PIN');
      await mkdir(dirname(target), {recursive: true, mode: 0o700});
      await copyFile(source, target, constants.COPYFILE_EXCL);
      assert.equal(sha(await readFile(target)), readerFilePins[role][name], 'TEST_READER_COPY_PIN');
    }
    // This is an explicitly synthetic build manifest, not deployment evidence.
    await writeFile(join(root, 'build-identity.json'), JSON.stringify({
      schemaVersion: 1, kind: 'TEST_ONLY_OFFLINE_READER_BUILD', role,
      deploymentQualified: false, readerFilePins: readerFilePins[role]
    }) + '\n', {flag: 'wx', mode: 0o600});
    await copyFile(join(sourceRoot, 'src/server/httpServer.ts'), join(root, 'src/server/httpServer.ts'), constants.COPYFILE_EXCL);
    await copyFile(originalModule, join(root, 'src/server/readerIdentity.mjs'), constants.COPYFILE_EXCL);
    const reader = readers[role] = {role, readerFileHashes: readerFilePins[role], build: {
      manifestSha256: sha(await readFile(join(root, 'build-identity.json'))),
      entrypointSha256: sha(await readFile(join(root, 'src/server/httpServer.ts'))),
      proofModuleSha256: sha(await readFile(join(root, 'src/server/readerIdentity.mjs')))
    }, runtime};
    await writeFile(join(root, 'reader-identity-expected.json'), JSON.stringify({
      schemaVersion: 1, projectId: READER_IDENTITY_PROJECT, reader
    }) + '\n', {flag: 'wx', mode: 0o600});
  }
  const readerExpected = {schemaVersion: 1, readers};
  const helperSource = `/** TEST_ONLY: fixed offline reader roots; never production authority. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {mock} from 'node:test';
const require = createRequire(${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, 'package.json')).href)});
require(${JSON.stringify(join(PACKAGE_ROOT, 'test/no-network.cjs'))});
const {createControlPlane} = await import(${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, 'src/control-plane.mjs')).href)});
const {combinedReaderPins} = await import(${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, 'src/reader-pin-binding.mjs')).href)});
const {request, mockFallback, responseFor} = await import(${JSON.stringify(pathToFileURL(join(PACKAGE_ROOT, 'reader-identity/test/helpers.mjs')).href)});
const nativePins = JSON.parse(await readFile(${JSON.stringify(join(PACKAGE_ROOT, 'config/reader-pins.json'))}, 'utf8'));
const apiPins = JSON.parse(await readFile(${JSON.stringify(join(PACKAGE_ROOT, 'config/reader-api-pins.json'))}, 'utf8'));
const readerFilePins = combinedReaderPins(nativePins, apiPins);
const readerExpected = ${JSON.stringify(readerExpected)};
const mainModule = await import(${JSON.stringify(pathToFileURL(join(readerRoots.main, 'src/server/readerIdentity.mjs')).href)});
const fallbackModule = await import(${JSON.stringify(pathToFileURL(join(readerRoots.fallback, 'src/server/readerIdentity.mjs')).href)});
let databaseCalls = 0, mainCalls = 0, fallbackCalls = 0;
const main = {session: await mainModule.createReaderIdentitySession()};
const fallback = {session: await fallbackModule.createReaderIdentitySession()};
// No application or listener is started: this tests the real identity sessions.
await main.session.sealAfterApplicationLoad();
await fallback.session.sealAfterApplicationLoad();
const aggregate = mainModule.createReaderIdentityAggregator(main.session);
mockFallback({mock}, fallback, body => {fallbackCalls++; return body;});
let observed;
try {
  const client = createControlPlane({
    openConnection() {databaseCalls++; throw Error('TEST_READER_DATABASE_FORBIDDEN');},
    readerFilePins,
    fetchImpl: async (url, options) => {
      mainCalls++;
      const target = new URL(url);
      assert.equal(target.origin, 'https://job.orz.md');
      assert.equal(target.pathname, mainModule.READER_IDENTITY_PATH);
      assert.equal(options.cache, 'no-store');
      assert.equal(options.redirect, 'error');
      observed = await request(aggregate, {url});
      return responseFor(observed);
    }
  });
  const identity = await client.readerIdentity(readerExpected);
  assert.deepEqual(identity.readers, readerExpected.readers);
  assert.equal(identity.checkedAt, new Date(Math.min(Date.parse(observed.body.checkedAt),
    ...Object.values(observed.body.observedAt).map(Date.parse))).toISOString());
  assert.equal(mainCalls, 1); assert.equal(fallbackCalls, 1); assert.equal(databaseCalls, 0);
  process.stdout.write(JSON.stringify(identity) + '\\n');
} finally {mock.restoreAll();}
`;
  const helperPath = join(caseRoot, 'reader-helper.mjs');
  const expectedPath = join(caseRoot, 'reader-expected.json');
  await writeFile(helperPath, helperSource, {flag: 'wx', mode: 0o600});
  await writeFile(expectedPath, JSON.stringify(readerExpected) + '\n', {flag: 'wx', mode: 0o600});
  return {kind: 'TEST_ONLY_OFFLINE_READER_FIXTURE', readerExpected, helperSource, helperPath,
    expectedPath, readerRoots, nodeVersion: process.version, networkCalls: 0, databaseCalls: 0};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'USAGE: node test-reader-fixture.mjs <new-case-root>');
  process.stdout.write(JSON.stringify(await prepareReaderFixture({
    packageRoot: PACKAGE_ROOT, caseRoot: process.argv[2]
  })) + '\n');
}
