import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {mkdtemp, rmdir} from 'node:fs/promises';
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

test('the registered scheduler runs without the migration file and keeps source budgets and pacing', async () => {
  const routes = await loadDirectPlans(), calls = [];
  const accepted = [];
  const candidate = {id: 'instabox-timeout-test', goalId: 'job-finder-instabox-migration', status: 'BUILDING'};
  const lease = {signal: new AbortController().signal};
  const db = {
    releaseCandidate: {findUniqueOrThrow: async ({where}) => {
      if(where.id!==candidate.id)throw Error('CANDIDATE_NOT_REGISTERED');
      return candidate;
    }},
    manualCrawlRequest: {findUnique: async () => {throw Error('LEGACY_REQUEST_REPLAY_FORBIDDEN');},
      findMany: async () => {throw Error('LEGACY_REQUEST_REPLAY_FORBIDDEN');}},
    recruitmentSource: {findMany: async () => routes.map(({sourceId: id, companyId}) => ({id, companyId}))},
    crawlBatchSourceResult: {findFirst: async () => null, findMany: async ({where}) => {
      assert.equal(where.releaseCandidateId, candidate.id);
      assert.deepEqual(where.batch.is, {kind: 'SCHEDULED', ownerId: 'direct-scheduler'});
      assert.equal(where.startedAt.gte.toISOString(), '2026-11-17T16:01:00.000Z');
      assert.equal(where.finishedAt.gte.toISOString(), '2026-11-17T16:01:00.000Z');
      assert.equal(where.finishedAt.lt.toISOString(), '2026-11-18T16:01:00.000Z');
      return accepted.filter(row => where.OR.some(bound =>
        row.sourceId === bound.sourceId && row.sourceConfigHash === bound.sourceConfigHash));
    }}, crawlBatch: {findFirst: async () => null},
    capture: async (plans, deps) => { calls.push({sourceId: plans[0].source.id, deps}); return {status: 'SUCCESS'}; }
  };
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'jobfinder-timeout-test-'));
  const slot = String(Date.parse('2026-11-17T16:01:00Z'));
  try {
    await assert.rejects(runDirectRound({db, leaseDb: {lease}, candidateId: 'old-candidate', workspaceRoot}),
      /NEW_INSTABOX_CANDIDATE_REQUIRED/);
    await assert.rejects(runDirectRound({db, leaseDb: {lease}, candidateId: 'instabox-unregistered', workspaceRoot}),
      /CANDIDATE_NOT_REGISTERED/);
    assert.equal(calls.length,0);
    candidate.goalId = 'old-registration';
    await assert.rejects(runDirectRound({db, leaseDb: {lease}, candidateId: candidate.id, workspaceRoot}),
      /NEW_INSTABOX_CANDIDATE_REQUIRED/);
    candidate.goalId = 'job-finder-instabox-migration';
    candidate.status = 'INVALIDATED';
    await assert.rejects(runDirectRound({db, leaseDb: {lease}, candidateId: candidate.id, workspaceRoot}), /CANDIDATE_NOT_ACTIVE/);
    candidate.status = 'BUILDING';
    const results = await runDirectRound({db, leaseDb: {lease}, candidateId: candidate.id, workspaceRoot, slot});
    assert.equal(results.length, 36);
    assert.equal(calls.length, 36);
    assert.deepEqual(Object.fromEntries(calls.filter(({deps}) => Object.hasOwn(deps, 'sourceAttemptTimeoutMs'))
      .map(({sourceId, deps}) => [sourceId, deps.sourceAttemptTimeoutMs])), {
      'source-johnson-innovative-medicine-social': 1_800_000,
      'source-sanofi-china-social': 1_800_000,
      'source-novartis-social': 1_500_000,
      'source-novo-nordisk-china-social': 1_200_000
    });
    const workdayIds = new Set(['biogen']
      .map(company => 'source-' + company + '-china-social'));
    const workdayPositions = calls.flatMap(({sourceId}, index) => workdayIds.has(sourceId) ? [index] : []);
    assert.deepEqual(workdayPositions.map(index => calls[index].sourceId),
      routes.filter(row => workdayIds.has(row.sourceId)).map(row => row.sourceId));
    assert.ok(workdayPositions.every((index, pos) => index > (workdayPositions[pos - 1] ?? -2) + 1));
    assert.deepEqual(calls.filter(row => !workdayIds.has(row.sourceId)).map(row => row.sourceId),
      routes.filter(row => !workdayIds.has(row.sourceId)).map(row => row.sourceId));
    assert(calls.every(({deps}) => deps.portableLease === lease && deps.portableLease.signal === lease.signal));
    assert(calls.every(({deps}) => deps.force === true));

    const [current, obsolete] = routes;
    const completed={atomicCommitState:'COMMITTED',completenessState:'VERIFIED',lossLedgerEntries:[],_count:{lossLedgerEntries:0,evidenceArtifacts:0}};
    accepted.push({...completed,sourceId: current.sourceId, sourceConfigHash: current.sourceConfigSha256, batchId: 'accepted-batch'},
      {...completed,sourceId: obsolete.sourceId, sourceConfigHash: 'old-config', batchId: 'old-batch'});
    calls.length = 0;
    const retry = await runDirectRound({db, leaseDb: {lease}, candidateId: candidate.id, workspaceRoot, slot,
      onlySourceIds: [current.sourceId, obsolete.sourceId]});
    assert.deepEqual(calls.map(row => row.sourceId), [obsolete.sourceId]);
    assert.deepEqual(retry.find(row => row.sourceId === current.sourceId), {
      sourceId: current.sourceId, route: current.route, batchId: 'accepted-batch', status: 'SKIPPED_ALREADY_COMMITTED_IN_WINDOW'
    });
    for(const gap of [
      {sourceId:'source-roche-china-social',quarantined:308,unresolved:0,lossLedgerEntries:[],validCount:2,rerun:true},
      {sourceId:'source-roche-china-social',quarantined:0,unresolved:0,lossLedgerEntries:[{id:'s22-denied'}],validCount:314,rerun:false},
      {sourceId:'source-novartis-social',quarantined:0,unresolved:1,lossLedgerEntries:[],validCount:646,rerun:false}
    ]){
      const route=routes.find(row=>row.sourceId===gap.sourceId);
      accepted.length=0;calls.length=0;
      accepted.push({...completed,sourceId:route.sourceId,sourceConfigHash:route.sourceConfigSha256,batchId:'old-healthy',validCount:300},
        {...completed,sourceId:route.sourceId,sourceConfigHash:route.sourceConfigSha256,batchId:'latest-gap',validCount:gap.validCount,
          lossLedgerEntries:gap.lossLedgerEntries,_count:{lossLedgerEntries:gap.quarantined,evidenceArtifacts:gap.unresolved}});
      const pending=await runDirectRound({db,leaseDb:{lease},candidateId:candidate.id,workspaceRoot,slot,onlySourceIds:[route.sourceId]});
      if(gap.rerun){
        assert.deepEqual(calls.map(row=>row.sourceId),[route.sourceId]);
        assert.equal(pending[0].status,'SUCCESS');
        accepted.push({...completed,sourceId:route.sourceId,sourceConfigHash:route.sourceConfigSha256,batchId:'recovered',validCount:315});
        calls.length=0;
        const recovered=await runDirectRound({db,leaseDb:{lease},candidateId:candidate.id,workspaceRoot,slot,onlySourceIds:[route.sourceId]});
        assert.equal(calls.length,0);
        assert.equal(recovered[0].batchId,'recovered');
        assert.equal(recovered[0].status,'SKIPPED_ALREADY_COMMITTED_IN_WINDOW');
      }else{
        assert.equal(calls.length,0);
        assert.equal(pending[0].batchId,'latest-gap');
        assert.equal(pending[0].status,'SKIPPED_ALREADY_COMMITTED_IN_WINDOW');
      }
    }
    accepted.length=0;calls.length=0;
    const dueOrder=['source-biogen-china-social'];
    const observations=[],onSourceTransportObservation=observation=>observations.push(observation);
    await runDirectRound({db,leaseDb:{lease},candidateId:candidate.id,workspaceRoot,slot,
      onlySourceIds:dueOrder,prioritizeSelectedSources:true,onSourceTransportObservation});
    assert.deepEqual(calls.map(row=>row.sourceId),dueOrder);
    assert.ok(calls.every(({deps})=>deps.onSourceTransportObservation===onSourceTransportObservation));
    const observation={sourceId:dueOrder[0],observedAt:Date.now(),observedActualHttp:true,actualHttpStatuses:[429],locallyDeferred:false};
    calls[0].deps.onSourceTransportObservation(observation);
    assert.deepEqual(observations,[observation]);
    calls.length=0;
    const regular=routes.filter(row=>!workdayIds.has(row.sourceId)).slice(0,4).map(row=>row.sourceId);
    await runDirectRound({db,leaseDb:{lease},candidateId:candidate.id,workspaceRoot,slot,
      onlySourceIds:[...dueOrder,...regular],prioritizeSelectedSources:true});
    assert.deepEqual(calls.filter(row=>workdayIds.has(row.sourceId)).map(row=>row.sourceId),dueOrder);
    assert.deepEqual(calls.map(row=>row.sourceId),[
      regular[0],regular[1],dueOrder[0],regular[2],regular[3]
    ]);
  } finally {
    await rmdir(workspaceRoot);
  }
});
