import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const capturedAt = '2026-11-06T00:00:00.000Z';
const archivedPages = JSON.parse(readFileSync(new URL('./fixtures/bms-numeric-id-pages.json', import.meta.url), 'utf8'));
assert.ok(archivedPages.every(page => page.data.positions.every(row => Number.isSafeInteger(row.id))));

for (const candidate of ['runner-candidate', 'web-candidate']) {
  const root = `../../${candidate}`;
  const {candidateCompanies} = await import(`${root}/src/data/companyRegistry.ts`);
  const {buildStagedSourceCrawlPlans} = await import(`${root}/src/crawler/sourcePlan.ts`);
  const {createOfficialJsonSourceFetch} = await import(`${root}/src/crawler/officialJsonSourceFetch.ts`);
  const {runSourceCrawl, replayStrictSourceQualityEvidence} = await import(`${root}/src/crawler/runSourceCrawl.ts`);
  const plan = buildStagedSourceCrawlPlans(candidateCompanies).find(p => p.source.id === 'source-bms-china-social');

  async function crawl(total, mutate = () => {}) {
    const rows = Array.from({length: total}, (_, i) => ({
      id: 137484251800 + i, name: `Synthetic Role ${i + 1}`, positionUrl: `/careers/job/${137484251800 + i}`,
      locations: ['Shanghai - CN'], standardizedLocations: ['Shanghai, Shanghai, CN'], postedTs: 1793836800,
      workLocationOption: 'onsite', locationFlexibility: null
    }));
    const offsets = [];
    const fetch = createOfficialJsonSourceFetch({now: () => new Date(capturedAt), http: async ({url}) => {
      const start = Number(new URL(url).searchParams.get('start'));
      offsets.push(start);
      const body = candidate === 'runner-candidate' && total === 27
        ? structuredClone(archivedPages[start / 10])
        : {status: 200, data: {count: total, positions: rows.slice(start, start + 10)}};
      assert.ok(body, `Unexpected archived page offset ${start}`);
      const status = mutate(body, start) ?? 200;
      return {status, body: JSON.stringify(body), finalUrl: url, contentType: 'application/json', capturedAt};
    }});
    return {result: await runSourceCrawl(plan, {fetch, isBaseline: false}), offsets};
  }

  for (const total of [10, 27]) {
    test(`${candidate} BMS verifies ${total} ${candidate === 'runner-candidate' && total === 27 ? 'archived' : 'synthetic'} numeric-ID jobs across native pagination`, async () => {
      const {result, offsets} = await crawl(total);
      assert.equal(result.truth.completenessVerified, true, JSON.stringify(result.observation));
      assert.equal(result.jobs.length, total);
      assert.deepEqual(offsets, total === 27 ? [0, 10, 20] : [0]);
      assert.deepEqual(result.fetchEvidence.pages.map(page => page.returnedPageSize), offsets.map(() => null));
      assert.deepEqual(result.paginationEvaluation.derivedAnomalyCodes, []);
      assert.equal(replayStrictSourceQualityEvidence({
        plan, evidence: result.fetchEvidence, paginationEvaluation: result.paginationEvaluation,
        reconciliation: result.reconciliation, jobs: result.jobs, capturedAt
      }), true);
    });
  }

  test(`${candidate} BMS rejects missing, short, duplicate, and changing-total pages`, async () => {
    for (const mutate of [
      (_body, start) => start === 20 ? 503 : 200,
      (body, start) => { if (start === 10) body.data.positions.pop(); },
      (body, start) => { if (start === 20) body.data.positions[0].id = candidate === 'runner-candidate' ? archivedPages[0].data.positions[0].id : 137484251800; },
      (body, start) => { if (start === 20) body.data.count += 1; }
    ]) {
      const {result} = await crawl(27, mutate);
      assert.equal(result.truth.completenessVerified, false);
    }
  });

  if (candidate === 'runner-candidate') {
    test('BMS numeric IDs remain verifiable when one malformed job is quarantined', async () => {
      const {result} = await crawl(27, (body, start) => { if (start === 10) body.data.positions[0].name = ''; });
      assert.equal(result.truth.completenessVerified, true);
      assert.equal(result.jobs.length, 26);
      assert.equal(result.fetchEvidence.jobQuarantines.length, 1);
      const evidence = structuredClone(result.fetchEvidence);
      evidence.jobQuarantines[0].sourceJobId = 'wrong';
      assert.equal(replayStrictSourceQualityEvidence({
        plan, evidence, paginationEvaluation: result.paginationEvaluation,
        reconciliation: result.reconciliation, jobs: result.jobs, capturedAt
      }), false);
    });
  }
}
