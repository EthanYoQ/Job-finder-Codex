import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {savePublicSnapshot} from './public-snapshot-file.mjs';

/** Reuses the original reader and EXPECTED_TARGET_API contract before replacing a file.
 * This is local snapshot verification, not an assertion that Aliyun was updated.
 */
export async function exportVerifiedSnapshot({readerRoot, db, expectedFile, destination}) {
  const {readPortablePublicSnapshot} = await import(pathToFileURL(join(readerRoot, 'src/db/portablePublicSnapshotRepository.ts')));
  const snapshot = await readPortablePublicSnapshot(db);
  return verifyAndSaveSnapshot({readerRoot, snapshot, expected: JSON.parse(await readFile(expectedFile, 'utf8')), destination});
}

export async function verifyAndSaveSnapshot({readerRoot, snapshot, expected, destination}) {
  const {searchPortableSnapshot, coverageFromPortableSnapshot} = await import(pathToFileURL(join(readerRoot, 'src/server/portablePublicationApi.ts')));
  const actual = searchPortableSnapshot({city: '全部城市', companyIds: [expected.after.id]}, snapshot);
  const coverage = coverageFromPortableSnapshot({keyword: expected.afterCoverage.companyName, offset: 0, limit: 41}, snapshot);
  assert.deepEqual(actual.companies, expected.after.jobs.length ? [expected.after] : [], 'LOCAL_SEARCH_PROJECTION_MISMATCH');
  assert.deepEqual(coverage.companies, [expected.afterCoverage], 'LOCAL_COVERAGE_PROJECTION_MISMATCH');
  await savePublicSnapshot(destination, snapshot);
  return {status: 'SNAPSHOT_VERIFIED', allFieldsMatch: true, uniqueJobs: expected.after.jobs.length,
    lastSuccessAt: expected.afterCoverage.lastSuccessAt, generatedAt: snapshot.generatedAt};
}
