import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverQueuedManualPreviews } from './recover-manual.ts';

const candidateId='instabox-synthetic';
const registeredAt=new Date('2026-10-31T04:00:00Z');
const request=(id,extra={})=>({id,sourceId:'source-abbvie-china-social',createdAt:new Date('2026-10-31T04:01:00Z'),status:'QUEUED',...extra});
const inactive='LoadState=loaded\nActiveState=inactive\nJob=0\n';
async function fixture(t,requests){
  const workspaceRoot=await mkdtemp(join(tmpdir(),'jobfinder-manual-recovery-'));
  t.after(()=>rm(workspaceRoot,{recursive:true,force:true}));
  await writeFile(join(workspaceRoot,'migration-state.json'),JSON.stringify({candidateId,legacyCandidateIds:['old-candidate'],replayLegacy:false,
    unresolvedRequests:[{kind:'MANUAL_REQUEST',id:'legacy'}]}));
  return {candidateId,workspaceRoot,db:{
    releaseCandidate:{findUniqueOrThrow:async()=>({createdAt:registeredAt,status:'BUILDING'})},
    manualCrawlRequest:{findMany:async()=>requests,findUnique:async({where})=>requests.find(row=>row.id===where.id)??null}
  }};
}

test('only a new queued request gets its fixed unit started; legacy and finished requests stay untouched',async t=>{
  const rows=[request('new'),request('legacy'),request('earlier',{createdAt:registeredAt}),
    request('running',{status:'RUNNING'}),request('finished',{status:'SUCCESS'}),request('outside',{sourceId:'outside'}),request('bad/id')];
  const input=await fixture(t,rows),before=JSON.stringify(rows),inspected=[],started=[];
  const result=await recoverQueuedManualPreviews({...input,inspectUnit:async unit=>{inspected.push(unit);return inactive;},startUnit:async unit=>{started.push(unit);}});
  assert.deepEqual(inspected,['jobfinder-manual@new.service']);
  assert.deepEqual(started,inspected);
  assert.equal(result.startRequestedCount,1);assert.equal(result.skippedCount,6);
  assert.equal(JSON.stringify(rows),before);
});

test('active units, queued systemd jobs, unknown state and a DB claim race never launch a duplicate',async t=>{
  const rows=['active','activating','pending-job','unreadable','missing-unit','raced'].map(id=>request(id));
  const input=await fixture(t,rows);
  const result=await recoverQueuedManualPreviews({...input,inspectUnit:async unit=>{
    if(unit.includes('@unreadable.'))throw Error('SYNTHETIC_DBUS_UNAVAILABLE');
    if(unit.includes('@missing-unit.'))return 'LoadState=not-found\nActiveState=inactive\nJob=0\n';
    if(unit.includes('@raced.')){rows.find(row=>row.id==='raced').status='RUNNING';return inactive;}
    if(unit.includes('@pending-job.'))return inactive.replace('Job=0','Job=17');
    return inactive.replace('ActiveState=inactive',unit.includes('@activating.')?'ActiveState=activating':'ActiveState=active');
  },startUnit:async()=>{assert.fail('must not start');}});
  assert.equal(result.activeCount,3);assert.equal(result.unconfirmedCount,2);assert.equal(result.skippedCount,1);
});

test('uncertain start is not retried; a later round inspects unit and DB before any new request',async t=>{
  const input=await fixture(t,[request('new')]);let starts=0,reads=0;
  let state=inactive;
  const inspectUnit=async()=>{reads++;return state;};
  const startUnit=async()=>{starts++;state=inactive.replace('ActiveState=inactive','ActiveState=activating');throw Object.assign(Error('SYNTHETIC_START_TIMEOUT'),{killed:true});};
  const first=await recoverQueuedManualPreviews({...input,inspectUnit,startUnit});
  assert.equal(first.unconfirmedCount,1);assert.equal(starts,1);
  const second=await recoverQueuedManualPreviews({...input,inspectUnit,startUnit});
  assert.equal(second.activeCount,1);assert.equal(starts,1);assert.equal(reads,2);
  state=inactive.replace('ActiveState=inactive','ActiveState=failed');
  const third=await recoverQueuedManualPreviews({...input,inspectUnit,startUnit:async()=>{starts++;}});
  assert.equal(third.startRequestedCount,1);assert.equal(starts,2);assert.equal(reads,3);
});
