import { constants } from 'node:fs';
import { open, lstat, realpath, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { sha256, PROJECT_ID } from './restricted-transport.mjs';

/**
 * Use ONE existing private persistent authority directory across all runs and
 * process restarts. A new directory per attempt would defeat tuple fencing.
 * This is distinct from per-run evidence directories and the old relay.
 */
export async function createFileJournal(directory, { expectedAuthorityId } = {}) {
  const path = resolve(directory), stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || await realpath(path) !== path) throw Error('PRIVATE_JOURNAL_REQUIRED');
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(expectedAuthorityId ?? '')) throw Error('EXPECTED_AUTHORITY_REQUIRED');
  const markerPath = join(path, 'authority.json'), markerStat = await lstat(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink() || (markerStat.mode & 0o077) !== 0) throw Error('AUTHORITY_MARKER_INVALID');
  const authority = JSON.parse(await readFile(markerPath, 'utf8'));
  if (Object.keys(authority).sort().join(',') !== 'authorityId,initializedAt,projectId,schemaVersion' || authority.schemaVersion !== 1 ||
      authority.authorityId !== expectedAuthorityId || authority.projectId !== PROJECT_ID ||
      !Number.isFinite(Date.parse(authority.initializedAt))) throw Error('AUTHORITY_MARKER_INVALID');
  async function writeNew(name, value) {
    if (!/^[a-f0-9-]+\.(prepared|dispatch|result|publish-identity)\.json$/.test(name)) throw Error('JOURNAL_NAME');
    const target = join(path, name);
    const file = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); } finally { await file.close(); }
    const dir = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
    try { await dir.sync(); } finally { await dir.close(); }
  }
  const ref = artifact => ({ schemaVersion: 1, requestId: artifact.request.requestId,
    requestSha256: artifact.request.requestSha256, sqlSha256: artifact.sqlSha256,
    kind: artifact.request.kind, binding: artifact.binding });
  return Object.freeze({
    prepare: artifact => writeNew(artifact.request.requestId + '.prepared.json', artifact),
    claim: async artifact => {
      const marker = { ...ref(artifact), state: 'MAY_HAVE_BEEN_SENT', recordedAt: new Date().toISOString() };
      if (artifact.request.kind === 'PUBLISH') {
        const b = artifact.binding;
        const key = sha256(JSON.stringify([b.projectId, b.candidateId, b.sourceId, b.batchId, b.sourceResultId]));
        // Bind the original semantic publication tuple, not just a request UUID.
        // Never remove either claim. A crash between them burns this tuple and
        // forces READ_OUTCOME; it cannot authorize recompile-and-redispatch.
        await writeNew(key + '.publish-identity.json', marker);
      }
      await writeNew(artifact.request.requestId + '.dispatch.json', marker);
    },
    finish: (artifact, result) => writeNew(artifact.request.requestId + '.result.json', {
      ...ref(artifact), recordedAt: new Date().toISOString(), result,
      resultSha256: sha256(JSON.stringify(result)), retryAuthorized: false })
  });
}
