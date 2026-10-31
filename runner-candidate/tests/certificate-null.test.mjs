import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { memoryDb } from './memory-db.mjs';
import { loadDirectPlans, identityForSource } from '../scripts/direct-round.ts';
import { recoverDirectBatches } from '../scripts/recover-direct.ts';
import { withPortableCrawlLease } from '../src/crawler/portableCrawlLease.ts';
import { runP0CrawlBatch } from '../src/crawler/runCrawlBatch.ts';

const candidate={id:'instabox-test',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};

test('same-window Amgen skip persists SQL NULL certificate with SQL NULL hash through Prisma',async()=>{
  const {plan}=(await loadDirectPlans()).find(row=>row.sourceId==='source-amgen-china-social');
  const memory=memoryDb();
  const create=memory.db.crawlBatchSourceResult.create;
  memory.db.crawlBatchSourceResult.create=async args=>{
    assert.equal(args.data.completenessCertificate,Prisma.DbNull);
    assert.equal(args.data.completenessCertificateSha256,null);
    return create(args);
  };
  const result=await withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([plan],{
    db:memory.db,identity:identityForSource(candidate,plan.source.id),now:()=>new Date('2026-10-31T04:05:00Z'),
    publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',portableLease:lease,
    fetch:async()=>{throw Error('same-window skip must not fetch');},
    getRecentObservations:async()=>[{crawledAt:new Date('2026-10-31T04:04:00Z'),successful:true}],
    getPreviousJobs:async()=>[],isBaselineCompleted:async()=>true
  }));
  assert.equal(result.skippedSourceCount,1);
  assert.equal(memory.rows[0].failureCode,'SOURCE_NOT_DUE');
  assert.equal(memory.rows[0].completenessCertificate,Prisma.DbNull);
  assert.equal(memory.rows[0].completenessCertificateSha256,null);
  assert.equal(memory.jobWrites(),0);
});

test('new-runner interrupted JSON-null pending result closes with database null without replay',async()=>{
  const memory=memoryDb();
  memory.batches.push({id:'b',status:'RUNNING',releaseCandidateId:candidate.id,ownerId:'direct-scheduler',kind:'SCHEDULED',plannedSourceIds:['s']});
  memory.rows.push({id:'r',sourceId:'s',batchId:'b',releaseCandidateId:candidate.id,atomicCommitState:'PENDING',
    completenessCertificate:null,completenessCertificateSha256:null});
  memory.db.crawlBatch.findMany=async()=>memory.batches.filter(row=>row.status==='RUNNING');
  await withPortableCrawlLease(memory.db,lease=>recoverDirectBatches(memory.db,lease,candidate.id,['s']));
  assert.equal(memory.rows[0].atomicCommitState,'NOT_ATTEMPTED');
  assert.equal(memory.rows[0].completenessCertificate,Prisma.DbNull);
  assert.equal(memory.rows[0].completenessCertificateSha256,null);
  assert.equal(memory.batches[0].status,'INCOMPLETE');
  assert.equal(memory.jobWrites(),0);
});
