import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyAndSaveSnapshot} from './verified-snapshot.mjs';

const readerRoot = fileURLToPath(new URL('../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/reader-main/', import.meta.url));
test('original public API projection must match the independent expected file before snapshot replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobfinder-local-reader-'));
  try {
    const sourceId = 'source-ucb-china-social', companyId = 'company-ucb-china', time = '2026-10-31T00:00:00.000Z';
    const job = {id: 'synthetic-job', companyId, sourceId, title: '测试职位', officialTitle: '测试职位',
      officialPublishedAt: null, city: '上海', cities: ['上海'], locationRaw: '上海', category: '销售', isNew: false,
      officialUrl: 'https://careers.ucb.com/synthetic-test-only', lastSeenAt: time, inGrace: false};
    const snapshot = {schemaVersion: 'portable-public-snapshot-v1', generatedAt: time, lastUpdatedAt: time, totalJobs: 1,
      sources: [{sourceId, companyId, lastSuccessAt: time}],
      coverage: {requiredCompanyCount: 1, excludedCompanyCount: 0},
      companies: [{id: companyId, companyName: '优时比中国', pinyin: 'youshibi', category: 'FOREIGN_PHARMA',
        sourceIds: [sourceId], publishingSourceIds: [sourceId], required: true, health: 'HEALTHY', jobs: [job]}]};
    const expected = {after: {id: companyId, companyName: '优时比中国', pinyin: 'youshibi', jobs: [{...job, cityPending: false}]},
      afterCoverage: {id: companyId, companyName: '优时比中国', officialWebsiteUrl: 'https://www.ucb.com/',
        officialCareersUrl: 'https://careers.ucb.com/global/zh/search-results?keywords=China',
        category: 'FOREIGN_PHARMA', state: 'PUBLISHING', health: 'HEALTHY', lastSuccessAt: time}};
    const destination = join(dir, 'snapshot.json');
    const result = await verifyAndSaveSnapshot({readerRoot, snapshot, expected, destination});
    assert.equal(result.status, 'SNAPSHOT_VERIFIED');
    assert.equal(result.generatedAt, time);
    const saved = await readFile(destination, 'utf8');
    const wrong = structuredClone(expected); wrong.after.jobs[0].title = '不一致';
    await assert.rejects(verifyAndSaveSnapshot({readerRoot, snapshot, expected: wrong, destination}), /LOCAL_SEARCH_PROJECTION_MISMATCH/);
    assert.equal(await readFile(destination, 'utf8'), saved);
  } finally { await rm(dir, {recursive: true, force: true}); }
});
