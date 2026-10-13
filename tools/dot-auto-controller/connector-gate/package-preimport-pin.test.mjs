import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { verifyPackageSourcePreimport } from './package-preimport-pin.mjs';

// All package, dependency, runtime, manifest and evidence bytes below are
// synthetic temporary fixtures. No official connector or real package runs.
const PREFIX = 'tools/dot-auto-controller/';
const digest = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const sha = bytes => digest('sha256', bytes);
function put(root, relative, content, mode = 0o644) {
  const full = path.join(root, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content); fs.chmodSync(full, mode); return full;
}
function manifestFor(root) {
  const entries = [];
  function walk(dir) {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name), relative = path.relative(root, full).split(path.sep).join('/');
      if (item.name === 'node_modules' || relative === 'vendor/c60-source/dist') continue;
      assert.equal(item.isSymbolicLink(), false, 'fixture manifest never follows links');
      if (item.isDirectory()) { walk(full); continue; }
      assert.equal(item.isFile(), true);
      const bytes = fs.readFileSync(full), object = Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes]);
      let encoding = 'utf-8';
      try { if (new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0')) encoding = 'binary'; }
      catch { encoding = 'binary'; }
      entries.push({ path: PREFIX + relative, mode: fs.statSync(full).mode & 0o111 ? '100755' : '100644',
        bytes: bytes.length, sha256: sha(bytes), gitBlobSha1: digest('sha1', object),
        gitBlobSha256: digest('sha256', object), encoding, provenance: { kind: 'TEST_ONLY_SYNTHETIC_SOURCE' } });
    }
  }
  walk(root);
  return { schemaVersion: 1, packagePrefix: PREFIX, files: entries.length,
    totalBytes: entries.reduce((n, e) => n + e.bytes, 0), entries };
}
function fixture(t) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'TEST_ONLY-package-pin-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'package'), manifestPath = path.join(temporary, 'reviewed-source-manifest.json');
  fs.mkdirSync(root);
  for (const relative of ['connector-gate/gate.mjs', 'connector-gate/bridge.mjs',
    'vendor/c60-source/ops/cloud-pilot-host/wrapper.mjs',
    'vendor/c60-source/ops/cloud-pilot-host/host-helper-functions.js',
    'scripts/package-manifest.mjs']) {
    put(root, relative, 'throw new Error("TEST_ONLY_SOURCE_MUST_NOT_BE_IMPORTED");\n');
  }
  put(root, 'vendor/c60-source/src/evidence/fact.ts', 'export const TEST_ONLY = true;\n');
  put(root, 'vendor/c60-source/tests/fixtures/evidence/fact.json', '{"TEST_ONLY":true}\n');
  put(root, 'package.json', '{"name":"TEST_ONLY-package-pin","private":true}\n');
  put(root, 'run.sh', '#!/bin/sh\nexit 99\n', 0o755);
  let manifest = manifestFor(root), expectedManifestSha256;
  function save() {
    const bytes = Buffer.from(JSON.stringify(manifest, null, 2));
    fs.writeFileSync(manifestPath, bytes); expectedManifestSha256 = sha(bytes);
  }
  save();
  return { temporary, root, manifestPath, get manifest() { return manifest; },
    save, rewrite(mutator) { mutator(manifest); save(); },
    repin() { manifest = manifestFor(root); save(); },
    input() { return { packageRoot: root, manifestPath, expectedManifestSha256 }; },
    verify() { return verifyPackageSourcePreimport(this.input()); } };
}

test('complete synthetic package is checked without importing its throwing source modules', t => {
  const f = fixture(t), report = f.verify();
  assert.equal(report.kind, 'PACKAGE_SOURCE_PREIMPORT_REPORT');
  assert.equal(report.sourceFileCount, 9);
  assert.equal(report.totalBytes, f.manifest.totalBytes);
  assert.equal(report.manifestSha256, f.input().expectedManifestSha256);
  assert.equal(report.grantsAuthority, false);
  assert.equal(report.snapshotOnly, true);
  assert.equal(report.runtimeNodeIdentityVerified, false);
  assert.equal(report.dependencyIdentityVerified, false);
  assert.equal(report.vendorRuntimeTreeVerified, false);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.fixedExcludedRules), true);
  assert.equal(Object.isFrozen(report.excludedPaths), true);
  assert.deepEqual(report, f.verify());
});

test('binary, invalid UTF-8, NUL, empty and Unicode source bytes use generator encoding convention', t => {
  const f = fixture(t);
  put(f.root, 'binary.dat', Buffer.from([0xff, 0x01]));
  put(f.root, 'nul.dat', Buffer.from('a\0b'));
  put(f.root, 'empty.txt', ''); put(f.root, 'unicode.txt', '合成来源🌱\n');
  f.repin(); assert.equal(f.verify().sourceFileCount, 13);
});

test('manifest SHA is supplied by trusted caller; altered bytes cannot repin themselves', t => {
  const f = fixture(t), input = f.input();
  fs.appendFileSync(f.manifestPath, '\n');
  assert.throws(() => verifyPackageSourcePreimport(input), /PACKAGE_PIN_MANIFEST_SHA/);
});

for (const supplied of [undefined, null, '', 'not-a-hash', 'a'.repeat(63), 'A'.repeat(64)]) {
  test(`invalid fixed reviewed SHA fails: ${String(supplied)}`, t => {
    const f = fixture(t);
    assert.throws(() => verifyPackageSourcePreimport({ ...f.input(), expectedManifestSha256: supplied }), /PACKAGE_PIN_REVIEWED_SHA_REQUIRED/);
  });
}

for (const target of ['connector-gate/gate.mjs', 'connector-gate/bridge.mjs',
  'vendor/c60-source/ops/cloud-pilot-host/wrapper.mjs', 'vendor/c60-source/ops/cloud-pilot-host/host-helper-functions.js',
  'vendor/c60-source/src/evidence/fact.ts', 'vendor/c60-source/tests/fixtures/evidence/fact.json']) {
  test(`same-size tampering in covered source is rejected: ${target}`, t => {
    const f = fixture(t), full = path.join(f.root, target), bytes = fs.readFileSync(full);
    bytes[0] ^= 1; fs.writeFileSync(full, bytes);
    assert.throws(() => f.verify(), /PACKAGE_PIN_FILE_SHA/);
  });
}

test('changed source byte count fails before content acceptance', t => {
  const f = fixture(t); fs.appendFileSync(path.join(f.root, 'connector-gate/gate.mjs'), 'x');
  assert.throws(() => f.verify(), /PACKAGE_PIN_FILE_SIZE/);
});

for (const mutation of ['hash', 'bytes', 'mode', 'git-sha1', 'git-sha256', 'encoding']) {
  test(`reviewed manifest malformed identity ${mutation} fails against physical source`, t => {
    const f = fixture(t);
    f.rewrite(m => {
      const e = m.entries[0];
      if (mutation === 'hash') e.sha256 = '0'.repeat(64);
      if (mutation === 'bytes') { e.bytes++; m.totalBytes++; }
      if (mutation === 'mode') e.mode = '100755';
      if (mutation === 'git-sha1') e.gitBlobSha1 = '0'.repeat(40);
      if (mutation === 'git-sha256') e.gitBlobSha256 = '0'.repeat(64);
      if (mutation === 'encoding') e.encoding = 'binary';
    });
    assert.throws(() => f.verify(), /PACKAGE_PIN_(FILE_SHA|FILE_SIZE|FILE_MODE|GIT_BLOB|ENCODING)/);
  });
}

test('physical executable-bit changes fail exact Git mode binding', t => {
  const f = fixture(t); fs.chmodSync(path.join(f.root, 'connector-gate/gate.mjs'), 0o755);
  assert.throws(() => f.verify(), /PACKAGE_PIN_FILE_MODE/);
});

test('safe read-only file permissions do not add a writable-0644 requirement', t => {
  const f = fixture(t); fs.chmodSync(path.join(f.root, 'connector-gate/gate.mjs'), 0o444);
  assert.equal(f.verify().sourceFileCount, 9);
});

test('generator mode equivalence uses any original execute bit', t => {
  const f = fixture(t); fs.chmodSync(path.join(f.root, 'run.sh'), 0o744);
  assert.equal(f.verify().sourceFileCount, 9);
});

for (const invalid of [PREFIX + '../escape.mjs', PREFIX + 'a/../../escape', PREFIX + '/absolute',
  PREFIX + 'a//b', PREFIX + 'a/./b', PREFIX + 'a\\b', PREFIX + 'a\0b', PREFIX,
  '/etc/passwd', 'other/package/a.mjs']) {
  test(`manifest path cannot escape exact package prefix: ${JSON.stringify(invalid)}`, t => {
    const f = fixture(t); f.rewrite(m => { m.entries[0].path = invalid; });
    assert.throws(() => f.verify(), /PACKAGE_PIN_ENTRY_PATH/);
  });
}

test('duplicate manifest source entries fail even with adjusted counts and total', t => {
  const f = fixture(t);
  f.rewrite(m => { m.entries.push(structuredClone(m.entries[0])); m.files++; m.totalBytes += m.entries[0].bytes; });
  assert.throws(() => f.verify(), /PACKAGE_PIN_DUPLICATE_ENTRY/);
});

test('omitted existing source cannot hide behind internally consistent manifest counts', t => {
  const f = fixture(t);
  f.rewrite(m => { const e = m.entries.pop(); m.files--; m.totalBytes -= e.bytes; });
  assert.throws(() => f.verify(), /PACKAGE_PIN_SOURCE_SET_MISMATCH/);
});

test('a listed source missing from disk fails complete inventory matching', t => {
  const f = fixture(t); fs.unlinkSync(path.join(f.root, 'connector-gate/gate.mjs'));
  assert.throws(() => f.verify(), /PACKAGE_PIN_SOURCE_SET_MISMATCH/);
});

for (const extra of ['extra.mjs', '.hidden-source', 'other/dist/active.mjs', 'evidence/run.json']) {
  test(`unlisted extra file is never silently ignored: ${extra}`, t => {
    const f = fixture(t); put(f.root, extra, 'TEST_ONLY_EXTRA');
    assert.throws(() => f.verify(), /PACKAGE_PIN_SOURCE_SET_MISMATCH/);
  });
}

test('source evidence and non-exempt dist directories are verified when listed', t => {
  const f = fixture(t); put(f.root, 'other/dist/module.mjs', 'TEST_ONLY_NORMAL_SOURCE');
  f.repin(); assert.equal(f.verify().sourceFileCount, 10);
  fs.appendFileSync(path.join(f.root, 'other/dist/module.mjs'), '!');
  assert.throws(() => f.verify(), /PACKAGE_PIN_FILE_SIZE/);
});

test('only dependencies and the exact c60 runtime dist tree are excluded and reported', t => {
  const f = fixture(t);
  const outside = path.join(f.temporary, 'TEST_ONLY_dependency'); fs.mkdirSync(outside);
  put(outside, 'module.mjs', 'throw new Error("TEST_ONLY_DO_NOT_READ_OR_IMPORT");');
  fs.symlinkSync(outside, path.join(f.root, 'node_modules'), 'dir');
  put(f.root, 'vendor/c60-source/node_modules/fake/index.js', 'TEST_ONLY_DEPENDENCY');
  put(f.root, 'vendor/c60-source/dist/compiled.js', 'TEST_ONLY_RUNTIME_TREE_SEPARATELY_VERIFIED');
  const report = f.verify();
  assert.deepEqual(report.excludedPaths, ['node_modules', 'vendor/c60-source/dist', 'vendor/c60-source/node_modules']);
  assert.equal(report.sourceFileCount, 9);
  assert.equal(report.vendorRuntimeTreeVerified, false);
});

for (const excluded of ['node_modules/fake/index.js', 'vendor/c60-source/dist/compiled.js']) {
  test(`manifest cannot expand source scope into excluded runtime bytes: ${excluded}`, t => {
    const f = fixture(t); f.rewrite(m => { m.entries[0].path = PREFIX + excluded; });
    assert.throws(() => f.verify(), /PACKAGE_PIN_EXCLUDED_ENTRY/);
  });
}

test('generated connector cache is rejected rather than trusted or silently ignored', t => {
  const f = fixture(t); put(f.root, '.connector-gate-cache/evidence.json', 'TEST_ONLY_GENERATED');
  assert.throws(() => f.verify(), /PACKAGE_PIN_GENERATED_CACHE/);
});

test('symlink source file fails before its target is read', t => {
  const f = fixture(t), full = path.join(f.root, 'connector-gate/gate.mjs');
  fs.unlinkSync(full); fs.symlinkSync('/TEST_ONLY_NONEXISTENT_MUST_NOT_BE_OPENED', full);
  assert.throws(() => f.verify(), /PACKAGE_PIN_SYMLINK/);
});

test('symlink source directory fails without traversal', t => {
  const f = fixture(t), dir = path.join(f.root, 'connector-gate'), external = path.join(f.temporary, 'moved');
  fs.renameSync(dir, external); fs.symlinkSync(external, dir, 'dir');
  assert.throws(() => f.verify(), /PACKAGE_PIN_SYMLINK/);
});

test('symlink package root or root ancestor is rejected', t => {
  const f = fixture(t), link = path.join(f.temporary, 'linked-root'); fs.symlinkSync(f.root, link, 'dir');
  assert.throws(() => verifyPackageSourcePreimport({ ...f.input(), packageRoot: link }), /PACKAGE_PIN_SYMLINK/);
  const parentLink = path.join(f.temporary, 'linked-parent'); fs.symlinkSync(f.temporary, parentLink, 'dir');
  assert.throws(() => verifyPackageSourcePreimport({ ...f.input(), packageRoot: path.join(parentLink, 'package') }), /PACKAGE_PIN_SYMLINK/);
});

test('manifest leaf symlink is rejected even when its target has the reviewed bytes', t => {
  const f = fixture(t), link = path.join(f.temporary, 'linked-manifest.json'); fs.symlinkSync(f.manifestPath, link);
  assert.throws(() => verifyPackageSourcePreimport({ ...f.input(), manifestPath: link }), /PACKAGE_PIN_SYMLINK/);
});

test('manifest is external input, never a self-pinning package member', t => {
  const f = fixture(t), inside = path.join(f.root, 'manifest.json'); fs.copyFileSync(f.manifestPath, inside);
  assert.throws(() => verifyPackageSourcePreimport({ ...f.input(), manifestPath: inside }), /PACKAGE_PIN_MANIFEST_MUST_BE_EXTERNAL/);
});

for (const shape of ['schema', 'prefix', 'files', 'total', 'extra-top-key', 'entry-extra-key', 'invalid-mode']) {
  test(`manifest structural mismatch is rejected: ${shape}`, t => {
    const f = fixture(t); f.rewrite(m => {
      if (shape === 'schema') m.schemaVersion = 2;
      if (shape === 'prefix') m.packagePrefix = 'other/';
      if (shape === 'files') m.files++;
      if (shape === 'total') m.totalBytes++;
      if (shape === 'extra-top-key') m.authorized = true;
      if (shape === 'entry-extra-key') m.entries[0].authorized = true;
      if (shape === 'invalid-mode') m.entries[0].mode = '120000';
    });
    assert.throws(() => f.verify(), /PACKAGE_PIN_(MANIFEST_SHAPE|TOTAL_BYTES|ENTRY_SHAPE)/);
  });
}

test('a source changed after its own successful read is rejected by final identity recheck', t => {
  const f = fixture(t), originalRead = fs.readFileSync, firstSource = path.join(f.root, 'connector-gate/bridge.mjs');
  let calls = 0;
  t.mock.method(fs, 'readFileSync', function (...args) {
    const bytes = originalRead.apply(this, args);
    if (++calls === 3) { const changed = originalRead(firstSource); changed[0] ^= 1; fs.writeFileSync(firstSource, changed); }
    return bytes;
  });
  assert.throws(() => f.verify(), /PACKAGE_PIN_FILE_CHANGED/);
});

test('manifest mutation during source verification is rejected', t => {
  const f = fixture(t), originalRead = fs.readFileSync; let calls = 0;
  t.mock.method(fs, 'readFileSync', function (...args) {
    const bytes = originalRead.apply(this, args);
    if (++calls === 3) fs.appendFileSync(f.manifestPath, '\n');
    return bytes;
  });
  assert.throws(() => f.verify(), /PACKAGE_PIN_MANIFEST_CHANGED/);
});

test('preimport verifier source contains only builtin imports and no activation/connector/network path', () => {
  const source = fs.readFileSync(new URL('./package-preimport-pin.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from '([^']+)';$/gm)].map(match => match[1]), ['node:fs', 'node:path', 'node:crypto']);
  assert.doesNotMatch(source, /\bimport\s*\(|\beval\s*\(|process\.env|execute_sql|\bfetch\s*\(|child_process|\bsetInterval\s*\(|\bsetTimeout\s*\(/);
});
