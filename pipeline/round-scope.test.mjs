import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDirectPlans,selectDirectRoutes,runDirectRound} from '../runner-candidate/scripts/direct-round.ts';
import {readRoundCoverage} from './round-coverage.ts';

const routes=await loadDirectPlans(),sourceIds=routes.map(row=>row.sourceId);
const retryIds=['source-novo-nordisk-china-social','source-pfizer-china-social','source-sanofi-china-social'];
const results=retryIds.map(sourceId=>({sourceId,status:'SUCCESS',failedSourceCount:0,blockedSourceCount:0}));
const slot=String(Date.parse('2026-10-31T04:01:00Z'));

test('one-off selection preserves the full default and excludes unrequested sources',()=>{
  assert.equal(selectDirectRoutes(routes).length,36);
  assert.deepEqual(new Set(selectDirectRoutes(routes,retryIds).map(row=>row.sourceId)),new Set(retryIds));
  assert.equal(selectDirectRoutes(routes,retryIds).some(row=>row.sourceId==='source-johnson-innovative-medicine-social'),false);
  assert.equal(routes.length,36);
});

test('empty, duplicate and unknown selections fail before migration state or DB access',async()=>{
  for(const onlySourceIds of [[],[''],[retryIds[0],retryIds[0]],['source-unknown'],[retryIds[0],'']]) {
    assert.throws(()=>selectDirectRoutes(routes,onlySourceIds),/INVALID_SOURCE_SELECTION/);
    await assert.rejects(runDirectRound({onlySourceIds}),/INVALID_SOURCE_SELECTION/);
  }
});

function database(acceptedIds) {
  return {crawlBatchSourceResult:{findMany:async query=>{
    assert.deepEqual(query.where.sourceId.in,sourceIds);
    assert.equal(query.where.releaseCandidateId,'instabox-test');
    assert.equal(query.where.atomicCommitState,'COMMITTED');
    assert.equal(query.where.completenessState,'VERIFIED');
    assert.equal(query.where.finishedAt.gte.toISOString(),'2026-10-31T04:01:00.000Z');
    assert.equal(query.where.finishedAt.lt.toISOString(),'2026-10-31T16:01:00.000Z');
    return acceptedIds.map(sourceId=>({sourceId,batchId:`batch-${sourceId}`}));
  }}};
}

test('three successful retries never reduce the 36-source completion denominator',async()=>{
  const partial=await readRoundCoverage(database(retryIds),'instabox-test',slot,sourceIds,results);
  assert.equal(partial.complete,false);assert.equal(partial.capturedSources.length,3);
  const earlier=sourceIds.filter(id=>id!=='source-johnson-innovative-medicine-social');
  const accumulated=await readRoundCoverage(database(earlier),'instabox-test',slot,sourceIds,results);
  assert.equal(accumulated.complete,false);assert.equal(accumulated.capturedSources.length,35);
  const full=await readRoundCoverage(database(sourceIds),'instabox-test',slot,sourceIds,results);
  assert.equal(full.complete,true);assert.equal(full.capturedSources.length,36);
  assert.equal((await readRoundCoverage(database(sourceIds),'instabox-test',slot,sourceIds,[{status:'FAILED'}])).complete,false);
  assert.equal((await readRoundCoverage(database(sourceIds),'instabox-test',null,sourceIds,results)).complete,false);
});
