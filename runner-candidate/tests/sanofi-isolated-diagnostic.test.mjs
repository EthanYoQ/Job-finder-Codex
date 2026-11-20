import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedBGradeTraversalValidator} from '../src/crawler/isolatedBGradeTraversalValidator.ts';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';
import {loadDirectPlans,identityForSource} from '../scripts/direct-round.ts';
import {runP0CrawlBatch} from '../src/crawler/runCrawlBatch.ts';
import {withPortableCrawlLease} from '../src/crawler/portableCrawlLease.ts';
import {memoryDb} from './memory-db.mjs';

const sourceId='source-sanofi-china-social';
const failureCode='B_GRADE_PAGINATION_FAILED';
const file='sanofi-page-17-12345678-1234-1234-1234-123456789abc.json';
const privateCapture={file,sha256:'a'.repeat(64)};
const privateText='PRIVATE_SANOFI_RESPONSE_TOKEN';
const candidate={id:'synthetic-sanofi-diagnostic',commitSha:'a'.repeat(40),rosterHash:'b'.repeat(64),
  sourcePlanHash:'c'.repeat(64),sourceConfigHash:'d'.repeat(64),adapterBundleHash:'e'.repeat(64)};

test('Sanofi isolated failures retain safe stage context for the parent without exporting original content',async t=>{
  t.mock.method(console,'error',()=>{});
  const diagnostic=sourceFetchDiagnostic(sourceId,{error:Object.assign(Error(privateText),{
    sourceFetchStage:'SANOFI_PAGE_NEXT',sourcePage:17,privateCapture})});
  const validate=createIsolatedBGradeTraversalValidator(async()=>JSON.stringify({decision:'FAILED',failureCode,
    message:`B-grade independent traversal failed: ${failureCode}`,diagnostic}));
  await assert.rejects(validate({sourceId}),error=>{
    const reported=sourceFetchDiagnostic(sourceId,{error});
    assert.equal(error.bGradeIndependentTraversalFailureCode,failureCode);
    assert.equal(reported.stage,'SANOFI_PAGE_NEXT');
    assert.equal(reported.page,17);
    assert.deepEqual(reported.privateCapture,privateCapture);
    assert.equal(JSON.stringify(reported).includes(privateText),false);
    return true;
  });
});

test('Sanofi rejects mismatched and unsafe isolated diagnostic context',async t=>{
  t.mock.method(console,'error',()=>{});
  for(const diagnostic of [
    {sourceId:'source-bayer-healthcare-social',stage:'SANOFI_PAGE_NEXT',page:17,privateCapture},
    {sourceId,stage:privateText,page:10001,sourceJobId:privateText,privateCapture:{file:'/private/token.json',sha256:privateText}}
  ]) {
    const validate=createIsolatedBGradeTraversalValidator(async()=>JSON.stringify({decision:'FAILED',failureCode,
      message:`B-grade independent traversal failed: ${failureCode}`,diagnostic}));
    await assert.rejects(validate({sourceId}),error=>{
      const reported=sourceFetchDiagnostic(sourceId,{error});
      assert.equal(reported.stage,undefined);assert.equal(reported.page,undefined);
      assert.equal(reported.privateCapture,undefined);assert.equal(reported.sourceJobId,undefined);
      return true;
    });
  }
});

test('Sanofi pre-capture failure identifies the independent stage and preserves last-good jobs',async t=>{
  const logs=[];t.mock.method(console,'error',value=>logs.push(String(value)));
  const plan=(await loadDirectPlans()).find(row=>row.sourceId===sourceId).plan;
  const memory=memoryDb(),original=Error(privateText);
  const result=await withPortableCrawlLease(memory.db,lease=>runP0CrawlBatch([plan],{
    db:memory.db,identity:identityForSource(candidate,sourceId),now:()=>new Date(),
    publicationPolicy:'SOURCE_ATOMIC_LAST_GOOD_V1',portableLease:lease,
    getPreviousJobs:async()=>[],getRecentObservations:async()=>[],isBaselineCompleted:async()=>false,
    getTrustedCompletenessBaseline:async()=>null,getFirstAcceptedCurrentPolicyReceipt:async()=>null,
    runIndependentTraversalValidator:async()=>{throw original;},
    fetch:async()=>assert.fail('The main source cannot start after independent capture failure')
  }));
  assert.equal(sourceFetchDiagnostic(sourceId,{error:original}).stage,'SANOFI_INDEPENDENT_TRAVERSAL');
  assert.equal(result.status,'INCOMPLETE');assert.equal(memory.jobWrites(),0);
  assert.equal(memory.rows[0].atomicCommitState,'NOT_ATTEMPTED');
  assert.ok(logs.some(value=>JSON.parse(value).stage==='SANOFI_INDEPENDENT_TRAVERSAL'));
  assert.equal(logs.join('\n').includes(privateText),false);
});
