import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readRoundCoverage,readSourceCompletion} from './round-coverage.ts';

const history=JSON.parse(await readFile(new URL('./fixtures/round-completion-history.json',import.meta.url),'utf8'));
const slot=String(Date.parse('2026-11-16T16:01:00Z'));
const candidateId='instabox-completion-test';
const sourceIds=Array.from({length:35},(_,i)=>`healthy-${i}`).concat(history.roche.sourceId);
const success=[{status:'SUCCESS',failedSourceCount:0,blockedSourceCount:0}];
function result(sourceId,patch={}) {
  return {id:`result-${sourceId}`,sourceId,batchId:`batch-${sourceId}`,releaseCandidateId:candidateId,
    sourceConfigHash:'current-config',atomicCommitState:'COMMITTED',completenessState:'VERIFIED',
    startedAt:new Date(Number(slot)+10_000),finishedAt:new Date(Number(slot)+60_000),batch:{kind:'SCHEDULED',ownerId:'direct-scheduler'},
    losses:[],artifacts:[],...patch};
}

// Apply the actual reader's filters to archived counts and explicit relation records.
function database(rows) {
  return {crawlBatchSourceResult:{findMany:async query=>{
    const where=query.where;
    const selected=rows.filter(row=>row.releaseCandidateId===where.releaseCandidateId&&
      where.sourceId.in.includes(row.sourceId)&&row.startedAt>=where.startedAt.gte&&row.finishedAt>=where.finishedAt.gte&&row.finishedAt<where.finishedAt.lt&&
      row.batch.kind===where.batch.is.kind&&row.batch.ownerId===where.batch.is.ownerId&&
      (!where.OR||where.OR.some(scope=>row.sourceId===scope.sourceId&&row.sourceConfigHash===scope.sourceConfigHash)));
    selected.sort((a,b)=>a.finishedAt-b.finishedAt||a.id.localeCompare(b.id));
    const matches=(details,filter)=>details[filter.details.path[0]]===filter.details.equals;
    const matchesArtifact=(artifact,filter)=>Object.entries(filter).every(([key,value])=>
      key==='OR'?value.some(branch=>matchesArtifact(artifact,branch)):
        typeof value==='object'?value.in.includes(artifact[key]):artifact[key]===value);
    return selected.map(row=>({...row,
      lossLedgerEntries:row.losses.filter(loss=>query.select.lossLedgerEntries.where.OR.some(filter=>matches(loss.details,filter))),
      _count:{lossLedgerEntries:row.losses.filter(loss=>matches(loss.details,query.select._count.select.lossLedgerEntries.where)).length,
        evidenceArtifacts:row.artifacts.filter(artifact=>matchesArtifact({...artifact,sourceId:row.sourceId},query.select._count.select.evidenceArtifacts.where)).length}
    }));
  }}};
}
const loss=code=>({id:`loss-${code}`,details:{code}});

test('archived Roche 2 published + 308 quarantined is captured but remains incomplete',async()=>{
  assert.equal(history.roche.dedupeOutputCount,2);
  assert.deepEqual(history.roche.losses,[{code:'JOB_QUARANTINED',n:308}]);
  const rows=sourceIds.map(id=>result(id));
  rows[35]=result(history.roche.sourceId,{...history.roche,
    startedAt:new Date(history.roche.startedAt+'Z'),finishedAt:new Date(history.roche.finishedAt+'Z'),
    losses:history.roche.losses.flatMap(({code,n})=>Array.from({length:n},()=>loss(code)))});
  const coverage=await readRoundCoverage(database(rows),candidateId,slot,sourceIds,success);
  assert.equal(coverage.complete,false);
  assert.equal(coverage.capturedSources.length,35);
  assert.equal(coverage.quarantinedJobCount,308);
  const completion=await readSourceCompletion(database(rows),candidateId,slot,sourceIds);
  assert.equal(completion.filter(row=>row.complete).length,35);
  assert.equal(completion.find(row=>row.sourceId===history.roche.sourceId).complete,false);
});

test('small quarantines and explicit pending losses complete capture while reporting audit flags',async()=>{
  const sample=history.rocheS22;
  assert.deepEqual([sample.responses,sample.expected,sample.jobs,sample.denied.length,sample.verified],[319,315,314,1,true]);
  const rocheId=history.roche.sourceId;
  const rocheDb=database([result(rocheId,{batchId:sample.batchId,validCount:sample.jobs,losses:sample.denied.map(()=>loss('ROCHE_DETAIL_DENIED'))})]);
  const rocheCov=await readRoundCoverage(rocheDb,candidateId,slot,[rocheId],success);
  assert.equal(rocheCov.complete,true);
  assert.equal(rocheCov.quarantinedJobCount,0);
  assert.equal(rocheCov.unresolvedCoverage,true);
  assert.deepEqual(rocheCov.capturedSources,[{sourceId:rocheId,batchId:sample.batchId}]);

  const cases=[result('source-novartis-social',{validCount:646,artifacts:[{extractorLocator:'novartis-default-discovery-exhausted'}]}),
    result('source-cspc-social',{validCount:26,losses:[loss('JOB_QUARANTINED'),loss('JOB_QUARANTINED')]}),
    ...['NOVO_DETAIL_INSUFFICIENT','SERVIER_WORKPLACE_COUNTRY_UNKNOWN','KELUN_GEOGRAPHY_UNKNOWN',
      'MAINLAND_COUNTRY_UNRESOLVED','BIOGEN_LIST_GEOGRAPHY_UNRESOLVED'].map(code=>result(code,{validCount:20,losses:[loss(code)]}))];
  for(const row of cases){
    const coverage=await readRoundCoverage(database([row]),candidateId,slot,[row.sourceId],success);
    assert.equal(coverage.complete,true,row.sourceId);
    assert.deepEqual(coverage.capturedSources,[{sourceId:row.sourceId,batchId:row.batchId}],row.sourceId);
    if(row.sourceId==='source-cspc-social')assert.equal(coverage.quarantinedJobCount,2);
    else assert.equal(coverage.unresolvedCoverage,true,row.sourceId);
  }
});

test('archived Novartis audit versions report unresolvedCoverage while committed capture stays captured',async()=>{
  assert.deepEqual([history.novartis.indexDeclaredTotal,history.novartis.primaryUniqueCount,history.novartis.noOmissionVerified],[609,610,false]);
  const sourceId='source-novartis-social';
  const artifact={extractorLocator:'novartis-partitions-audit',captureToolName:'novartis-native-functional-partitions',captureToolVersion:'13'};
  for(const captureToolVersion of ['4','13']){
    const row=result(sourceId,{id:history.novartis.sourceResultId,validCount:610,artifacts:[{...artifact,captureToolVersion}]});
    const coverage=await readRoundCoverage(database([row]),candidateId,slot,[sourceId],success);
    assert.equal(coverage.complete,true);assert.equal(coverage.unresolvedCoverage,true);
    assert.deepEqual(coverage.capturedSources,[{sourceId,batchId:row.batchId}]);
  }
  for(const patch of [{captureToolVersion:'14'},{captureToolName:'unrelated-capture-tool'}]){
    const row=result(sourceId,{validCount:610,artifacts:[{...artifact,...patch}]});
    const coverage=await readRoundCoverage(database([row]),candidateId,slot,[sourceId],success);
    assert.equal(coverage.complete,true);assert.equal(coverage.unresolvedCoverage,false);
  }
});

test('fresh verified zero-job results and definitive business exclusions are complete',async()=>{
  const codes=['LILLY_OFFICIAL_APPLICATION_CLOSED','ORGANON_OFFICIAL_APPLICATION_CLOSED','OFFICIAL_APPLICATION_CLOSED',
    'VERIFIED_DETAIL_OUT_OF_MAINLAND_SCOPE','VERIFIED_MOKA_OUT_OF_MAINLAND_SCOPE','KELUN_EXPLICIT_OUTSIDE_MAINLAND',
    'GILEAD_VERIFIED_HONG_KONG_ONLY','BAYER_OFFICIAL_PAUSED','OUT_OF_SCOPE','OUTSIDE_RECENT_JOB_WINDOW'];
  for(const losses of [[],codes.map(loss)]){
    const row=result('zero',{dedupeOutputCount:0,losses});
    const coverage=await readRoundCoverage(database([row]),candidateId,slot,['zero'],success);
    assert.equal(coverage.complete,true);
    assert.equal(coverage.quarantinedJobCount,0);
    assert.equal(coverage.unresolvedCoverage,false);
  }
});

test('a committed capture within the slot is preserved across later failed retries unless replaced by a collapse',async()=>{
  const sourceId='source-johnson-innovative-medicine-social';
  const healthy=result(sourceId,{validCount:129,losses:[loss('JOB_QUARANTINED')]});
  const transientFail=result(sourceId,{id:'later-fail',batchId:'later-fail',finishedAt:new Date(Number(slot)+120_000),
    atomicCommitState:'NOT_ATTEMPTED',completenessState:'FAILED'});
  const preserved=await readRoundCoverage(database([healthy,transientFail]),candidateId,slot,[sourceId],success);
  assert.equal(preserved.complete,true);
  assert.deepEqual(preserved.capturedSources,[{sourceId,batchId:healthy.batchId}]);
  const collapse=result(sourceId,{id:'collapse',batchId:'collapse',validCount:0,finishedAt:new Date(Number(slot)+180_000),
    losses:Array.from({length:20},()=>loss('JOB_QUARANTINED'))});
  assert.equal((await readSourceCompletion(database([healthy,collapse]),candidateId,slot,[sourceId]))[0].complete,false);
  const recovered=result(sourceId,{id:'recovered',batchId:'recovered',validCount:130,finishedAt:new Date(Number(slot)+240_000)});
  const coverage=await readRoundCoverage(database([healthy,collapse,recovered]),candidateId,slot,[sourceId],success);
  assert.equal(coverage.complete,true);assert.equal(coverage.quarantinedJobCount,0);
  assert.deepEqual(coverage.capturedSources,[{sourceId,batchId:'recovered'}]);
  const tie={...collapse,finishedAt:healthy.finishedAt,id:'z-last'};
  assert.equal((await readSourceCompletion(database([healthy,tie]),candidateId,slot,[sourceId]))[0].complete,false);
});

test('pending failures retain unresolved coverage until a committed capture succeeds',async()=>{
  const sourceId='source-novartis-social';
  const failed=result(sourceId,{id:'failed',batchId:'failed',atomicCommitState:'NOT_ATTEMPTED',
    completenessState:'FAILED',artifacts:[{extractorLocator:'novartis-default-discovery-exhausted'}]});
  const coverage=await readRoundCoverage(database([failed]),candidateId,slot,[sourceId],[]);
  assert.equal(coverage.complete,false);assert.deepEqual(coverage.capturedSources,[]);
  assert.equal(coverage.unresolvedCoverage,true);
  assert.equal(coverage.quarantinedJobCount,0);
  const recovered=result(sourceId,{id:'recovered',batchId:'recovered',validCount:650,finishedAt:new Date(Number(slot)+180_000)});
  const fresh=await readRoundCoverage(database([failed,recovered]),candidateId,slot,[sourceId],success);
  assert.equal(fresh.complete,true);assert.equal(fresh.unresolvedCoverage,false);
  assert.deepEqual(fresh.capturedSources,[{sourceId,batchId:'recovered'}]);
  const transportFailure=result(sourceId,{atomicCommitState:'NOT_ATTEMPTED',completenessState:'FAILED'});
  const onlyFail=await readRoundCoverage(database([transportFailure]),candidateId,slot,[sourceId],[]);
  assert.equal(onlyFail.complete,false);assert.equal(onlyFail.unresolvedCoverage,false);
});

test('legacy scheduler no-op leaves a verified capture intact while no-op alone is incomplete',async()=>{
  const sourceId='source-abbvie-china-social';
  const accepted=result(sourceId,{validCount:51});
  const noOp=result(sourceId,{id:'no-op',batchId:'no-op',finishedAt:new Date(Number(slot)+180_000),
    transportState:'SKIPPED',adapterState:'SKIPPED',failureCode:'SOURCE_NOT_DUE',
    atomicCommitState:'NOT_ATTEMPTED',completenessState:'FAILED'});
  const failed=result(sourceId,{id:'failed',batchId:'failed',finishedAt:new Date(Number(slot)+120_000),
    transportState:'FAILED',adapterState:'SKIPPED',failureCode:'SOURCE_TRANSPORT_FAILED',
    atomicCommitState:'NOT_ATTEMPTED',completenessState:'FAILED'});
  const complete=await readRoundCoverage(database([accepted,noOp]),candidateId,slot,[sourceId],[]);
  assert.equal(complete.complete,true);
  assert.deepEqual(complete.capturedSources,[{sourceId,batchId:accepted.batchId}]);
  assert.deepEqual(await readSourceCompletion(database([noOp]),candidateId,slot,[sourceId]),[]);
  const afterTransient=await readRoundCoverage(database([accepted,noOp,failed]),candidateId,slot,[sourceId],[]);
  assert.equal(afterTransient.complete,true);
  assert.deepEqual(afterTransient.capturedSources,[{sourceId,batchId:accepted.batchId}]);
  const onlyFailed=await readRoundCoverage(database([noOp,failed]),candidateId,slot,[sourceId],[]);
  assert.equal(onlyFailed.complete,false);
  assert.deepEqual(onlyFailed.capturedSources,[]);
});

test('candidate, slot, scheduler owner and config constrain completion',async()=>{
  const scoped=result('source');
  for(const patch of [{releaseCandidateId:'another-candidate'},{startedAt:new Date(Number(slot)-1)},
    {finishedAt:new Date(Number(slot)-1)},
    {finishedAt:new Date(Number(slot)+86400_000)},{batch:{kind:'MANUAL',ownerId:'direct-scheduler'}},
    {batch:{kind:'SCHEDULED',ownerId:'another-owner'}},{sourceConfigHash:'old-config'}]){
    const completion=await readSourceCompletion(database([{...scoped,...patch}]),candidateId,slot,['source'],new Map([['source','current-config']]));
    assert.deepEqual(completion,[],JSON.stringify(patch));
  }
  assert.deepEqual(await readSourceCompletion(database([scoped]),candidateId,null,['source']),[]);
  await assert.rejects(readSourceCompletion(database([scoped]),candidateId,slot,['source'],new Map()),/SOURCE_CONFIG_HASH_REQUIRED/);
  const coverage=await readRoundCoverage(database([{...scoped,sourceConfigHash:'old-config'}]),candidateId,slot,['source'],success,new Map([['source','current-config']]));
  assert.equal(coverage.complete,false);assert.deepEqual(coverage.capturedSources,[]);
});

test('a capture that starts before the slot cannot satisfy the next day after finishing',async()=>{
  const row=result('source',{startedAt:new Date(Number(slot)-1),finishedAt:new Date(Number(slot)+60_000)});
  const db=database([row]);
  assert.deepEqual(await readSourceCompletion(db,candidateId,slot,['source']),[]);
  assert.equal((await readRoundCoverage(db,candidateId,slot,['source'],success)).complete,false);
  const within=result('source',{startedAt:new Date(Number(slot))});
  assert.equal((await readRoundCoverage(database([within]),candidateId,slot,['source'],success)).complete,true);
});
