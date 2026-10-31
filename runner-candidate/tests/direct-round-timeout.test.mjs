import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {mkdtemp, writeFile, unlink, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Replace only execution boundaries; exercise the actual 36-source direct-round wiring.
const hooks = registerHooks({load(url, context, next) {
  const stubs = {
    '/src/db/crawlRuntimeRepository.ts': 'export const createPrismaCrawlRuntimeDeps = () => ({});',
    '/src/crawler/portableCrawlLease.ts': 'export const withPortableCrawlLease = (db, run) => run(db.lease);',
    '/scripts/recover-direct.ts': 'export const recoverDirectBatches = async () => {};',
    '/src/crawler/runCrawlBatch.ts': 'export const runP0CrawlBatch = (plans, deps) => deps.db.capture(plans, deps);'
  };
  const key = Object.keys(stubs).find(suffix => url.endsWith(suffix));
  return key ? {format: 'module', shortCircuit: true, source: stubs[key]} : next(url, context);
}});
const {loadDirectPlans, runDirectRound} = await import('../scripts/direct-round.ts');
hooks.deregister();

test('direct round gives only Pfizer thirty minutes and preserves every lease signal', async () => {
  const routes = await loadDirectPlans(), calls = [];
  const candidate = {id: 'instabox-timeout-test', status: 'BUILDING'};
  const lease = {signal: new AbortController().signal};
  const db = {
    releaseCandidate: {findUniqueOrThrow: async () => candidate},
    recruitmentSource: {findMany: async () => routes.map(({sourceId: id, companyId}) => ({id, companyId}))},
    crawlBatchSourceResult: {findFirst: async () => null}, crawlBatch: {findFirst: async () => null},
    capture: async (plans, deps) => { calls.push({sourceId: plans[0].source.id, deps}); return {status: 'SUCCESS'}; }
  };
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'jobfinder-timeout-test-'));
  try {
    await writeFile(join(workspaceRoot, 'migration-state.json'), JSON.stringify({candidateId: candidate.id,
      legacyCandidateIds: [], unresolvedRequests: [], replayLegacy: false}));
    const results = await runDirectRound({db, leaseDb: {lease}, candidateId: candidate.id, workspaceRoot});
    assert.equal(results.length, 36);
    assert.equal(calls.length, 36);
    assert.deepEqual(calls.filter(({deps}) => Object.hasOwn(deps, 'sourceAttemptTimeoutMs'))
      .map(({sourceId, deps}) => [sourceId, deps.sourceAttemptTimeoutMs]), [['source-pfizer-china-social', 1_800_000]]);
    assert(calls.every(({deps}) => deps.portableLease === lease && deps.portableLease.signal === lease.signal));
  } finally {
    await unlink(join(workspaceRoot, 'migration-state.json'));
    await rmdir(workspaceRoot);
  }
});
