/** Complete package SOURCE snapshot check, before importing package code.
 * Trusted caller fixes packageRoot and reviewed manifest SHA out of band.
 * This verifier itself must already belong to the trusted/pinned bootstrap;
 * importing an unchecked candidate verifier and asking it to self-attest is
 * not a pre-import security boundary.
 * This report is not authorization, a capability, runtime attestation, or a
 * replacement for the existing Node/dependency/vendor-runtime identity gates.
 * No package modules, manifests-as-code, dependencies, or environment values
 * are imported/evaluated here. Only Node builtins are used.
 *
 * Fixed inventory contract shared with scripts/package-manifest.mjs:
 * - skip every node_modules entry, without following directories or links;
 * - skip ONLY vendor/c60-source/dist (existing runtimeTree gate owns it);
 * - reject .connector-gate-cache; generated evidence/manifest stay outside.
 * No other dist, evidence, hidden, fixture, or extension-based exemptions.
 *
 * This detects changes during checking where observable via bytes/metadata.
 * It cannot prevent same-UID replacement after return. The trusted launcher
 * must retain its existing immutable-runtime and identity boundaries. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PREFIX = 'tools/dot-auto-controller/';
const DIST = 'vendor/c60-source/dist';
const MANIFEST_KEYS = ['entries', 'files', 'packagePrefix', 'schemaVersion', 'totalBytes'];
const ENTRY_KEYS = ['bytes', 'encoding', 'gitBlobSha1', 'gitBlobSha256', 'mode', 'path', 'provenance', 'sha256'];
const hash = (algorithm, bytes) => createHash(algorithm).update(bytes).digest('hex');
const fail = (code, detail = '') => { throw Error(code + (detail ? ':' + detail : '')); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => plain(value) && Object.keys(value).sort().join(',') === keys.join(',');
const freeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const sameStat = (a, b) => ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const safeAbsolute = (value, code) => {
  if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value) || path.resolve(value) !== value) fail(code);
  return value;
};
function checkedPath(full, finalKind) {
  let current = path.parse(full).root;
  const parts = full.slice(current.length).split(path.sep).filter(Boolean);
  let stat = fs.lstatSync(current, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('PACKAGE_PIN_ANCESTOR', current);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    stat = fs.lstatSync(current, { bigint: true });
    if (stat.isSymbolicLink()) fail('PACKAGE_PIN_SYMLINK', current);
    const directory = i < parts.length - 1 || finalKind === 'directory';
    if (directory ? !stat.isDirectory() : !stat.isFile()) fail('PACKAGE_PIN_NONREGULAR', current);
  }
  if (parts.length === 0 && finalKind !== 'directory') fail('PACKAGE_PIN_NONREGULAR', full);
  return stat;
}
function checkedRead(full, entry) {
  const before = checkedPath(full, 'file');
  if (entry) {
    if (before.size !== BigInt(entry.bytes)) fail('PACKAGE_PIN_FILE_SIZE', entry.path);
    // Match the generator's Git file-mode convention exactly. Read-only 0444
    // remains 100644; do not invent a writable-0644 deployment requirement.
    const actualMode = (before.mode & 0o111n) !== 0n ? '100755' : '100644';
    if (actualMode !== entry.mode) fail('PACKAGE_PIN_FILE_MODE', entry.path);
  }
  if (!Number.isSafeInteger(fs.constants.O_NOFOLLOW)) fail('PACKAGE_PIN_NOFOLLOW_UNAVAILABLE');
  const fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || !sameStat(before, opened)) fail('PACKAGE_PIN_FILE_CHANGED', full);
    const bytes = fs.readFileSync(fd);
    if (!sameStat(opened, fs.fstatSync(fd, { bigint: true })) ||
        !sameStat(opened, checkedPath(full, 'file'))) fail('PACKAGE_PIN_FILE_CHANGED', full);
    return { bytes, stat: opened };
  } finally { fs.closeSync(fd); }
}
function safeRelative(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) fail('PACKAGE_PIN_ENTRY_PATH');
  const relative = value.slice(PREFIX.length);
  if (!relative || relative.includes('\\') || relative.includes('\0') || path.posix.isAbsolute(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..') || path.posix.normalize(relative) !== relative) {
    fail('PACKAGE_PIN_ENTRY_PATH', value);
  }
  if (relative.split('/').includes('.connector-gate-cache')) fail('PACKAGE_PIN_GENERATED_CACHE', value);
  if (relative.split('/').includes('node_modules') || relative === DIST || relative.startsWith(DIST + '/')) {
    fail('PACKAGE_PIN_EXCLUDED_ENTRY', value);
  }
  return relative;
}
function scan(root) {
  const files = [], directories = new Map(), excluded = [];
  function walk(full, relative) {
    const before = checkedPath(full, 'directory');
    const entries = fs.readdirSync(full, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of entries) {
      const child = relative ? relative + '/' + item.name : item.name;
      if (item.name === '.connector-gate-cache') fail('PACKAGE_PIN_GENERATED_CACHE', child);
      if (item.name === 'node_modules' || child === DIST) { excluded.push(child); continue; }
      if (item.isSymbolicLink()) fail('PACKAGE_PIN_SYMLINK', child);
      if (item.isDirectory()) walk(path.join(full, item.name), child);
      else if (item.isFile()) files.push(child);
      else fail('PACKAGE_PIN_NONREGULAR', child);
    }
    if (!sameStat(before, checkedPath(full, 'directory'))) fail('PACKAGE_PIN_DIRECTORY_CHANGED', relative);
    directories.set(relative, before);
  }
  walk(root, '');
  return { files: files.sort(), directories, excluded: excluded.sort() };
}

/** Synchronous; the caller must call this before ANY candidate module import.
 * Neither manifest content nor its self-computed digest can choose the trusted
 * expectedManifestSha256. A valid report grants no permission to execute. */
export function verifyPackageSourcePreimport({ packageRoot, manifestPath, expectedManifestSha256 } = {}) {
  const root = safeAbsolute(packageRoot, 'PACKAGE_PIN_FIXED_ROOT_REQUIRED');
  const manifestFile = safeAbsolute(manifestPath, 'PACKAGE_PIN_EXTERNAL_MANIFEST_REQUIRED');
  if (typeof expectedManifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(expectedManifestSha256)) {
    fail('PACKAGE_PIN_REVIEWED_SHA_REQUIRED');
  }
  const relation = path.relative(root, manifestFile);
  if (relation === '' || (!relation.startsWith('..' + path.sep) && relation !== '..' && !path.isAbsolute(relation))) {
    fail('PACKAGE_PIN_MANIFEST_MUST_BE_EXTERNAL');
  }
  checkedPath(root, 'directory');
  const rawManifest = checkedRead(manifestFile).bytes;
  if (hash('sha256', rawManifest) !== expectedManifestSha256) fail('PACKAGE_PIN_MANIFEST_SHA');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawManifest)); }
  catch { fail('PACKAGE_PIN_MANIFEST_JSON'); }
  if (!exactKeys(manifest, MANIFEST_KEYS) || manifest.schemaVersion !== 1 || manifest.packagePrefix !== PREFIX ||
      !Array.isArray(manifest.entries) || !Number.isSafeInteger(manifest.files) || manifest.files < 1 ||
      manifest.files !== manifest.entries.length || !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
    fail('PACKAGE_PIN_MANIFEST_SHAPE');
  }
  const byPath = new Map();
  let totalBytes = 0;
  for (const entry of manifest.entries) {
    if (!exactKeys(entry, ENTRY_KEYS) || !['100644', '100755'].includes(entry.mode) ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        typeof entry.gitBlobSha1 !== 'string' || !/^[a-f0-9]{40}$/.test(entry.gitBlobSha1) ||
        typeof entry.gitBlobSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.gitBlobSha256) ||
        !['binary', 'utf-8'].includes(entry.encoding) || !plain(entry.provenance)) fail('PACKAGE_PIN_ENTRY_SHAPE');
    const relative = safeRelative(entry.path);
    if (byPath.has(relative)) fail('PACKAGE_PIN_DUPLICATE_ENTRY', entry.path);
    byPath.set(relative, entry);
    totalBytes += entry.bytes;
    if (!Number.isSafeInteger(totalBytes)) fail('PACKAGE_PIN_TOTAL_BYTES');
  }
  if (totalBytes !== manifest.totalBytes) fail('PACKAGE_PIN_TOTAL_BYTES');
  const before = scan(root);
  const listed = [...byPath.keys()].sort();
  if (listed.length !== before.files.length || listed.some((name, i) => name !== before.files[i])) {
    fail('PACKAGE_PIN_SOURCE_SET_MISMATCH');
  }
  const verifiedFiles = new Map();
  for (const relative of listed) {
    const entry = byPath.get(relative), full = path.join(root, ...relative.split('/'));
    const { bytes, stat } = checkedRead(full, entry);
    verifiedFiles.set(full, stat);
    if (bytes.length !== entry.bytes) fail('PACKAGE_PIN_FILE_SIZE', entry.path);
    if (hash('sha256', bytes) !== entry.sha256) fail('PACKAGE_PIN_FILE_SHA', entry.path);
    const object = Buffer.concat([Buffer.from('blob ' + bytes.length + '\0'), bytes]);
    if (hash('sha1', object) !== entry.gitBlobSha1 || hash('sha256', object) !== entry.gitBlobSha256) {
      fail('PACKAGE_PIN_GIT_BLOB', entry.path);
    }
    let encoding = 'utf-8';
    try { if (new TextDecoder('utf-8', { fatal: true }).decode(bytes).includes('\0')) encoding = 'binary'; }
    catch { encoding = 'binary'; }
    if (entry.encoding !== encoding) fail('PACKAGE_PIN_ENCODING', entry.path);
  }
  const after = scan(root);
  if (JSON.stringify(before.files) !== JSON.stringify(after.files) ||
      JSON.stringify(before.excluded) !== JSON.stringify(after.excluded) ||
      before.directories.size !== after.directories.size ||
      [...before.directories].some(([name, stat]) => !after.directories.has(name) || !sameStat(stat, after.directories.get(name)))) {
    fail('PACKAGE_PIN_TREE_CHANGED');
  }
  for (const [full, stat] of verifiedFiles) {
    if (!sameStat(stat, checkedPath(full, 'file'))) fail('PACKAGE_PIN_FILE_CHANGED', full);
  }
  if (!checkedRead(manifestFile).bytes.equals(rawManifest)) fail('PACKAGE_PIN_MANIFEST_CHANGED');
  return freeze({ schemaVersion: 1, kind: 'PACKAGE_SOURCE_PREIMPORT_REPORT', packageRoot: root,
    manifestPath: manifestFile, manifestSha256: expectedManifestSha256, packagePrefix: PREFIX,
    sourceFileCount: listed.length, totalBytes, fileModeConvention: 'Git executable-bit mode (stat.mode & 0111)',
    fixedExcludedRules: ['any entry named node_modules', DIST], excludedPaths: after.excluded,
    snapshotOnly: true, grantsAuthority: false, runtimeNodeIdentityVerified: false,
    dependencyIdentityVerified: false, vendorRuntimeTreeVerified: false });
}
