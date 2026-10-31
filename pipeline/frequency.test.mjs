import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slotAt,isNoonSlot,stableThreeDays} from './frequency.mjs';
const sources=Array.from({length:36},(_,i)=>`source-${i}`);
const recovery={kind:'live',verifiedAt:'2026-10-27T10:00:00Z',checks:{wake:true,interruptedCommit:true,failedSourceKeepsLastGood:true,failedInstallKeepsLastGood:true,webRestart:true}};
const records=['2026-10-28','2026-10-29','2026-10-30'].flatMap(day=>['00:01','12:01'].map(clock=>({
  slot:String(Date.parse(`${day}T${clock}:00+08:00`)),verifiedAt:new Date(Date.parse(`${day}T${clock}:00+08:00`)+3600_000).toISOString(),
  kind:'live',trigger:'timer',complete:true,webReadback:true,capturedSourceIds:sources
})));
test('slot boundaries follow Beijing midnight/noon at minute 01',()=>{
  const midnight=Date.parse('2026-10-31T00:01:00+08:00');
  assert.equal(slotAt(midnight-1),midnight-12*3600_000);
  assert.equal(slotAt(midnight),midnight);
  assert.equal(slotAt(midnight+12*3600_000),midnight+12*3600_000);
  assert.equal(isNoonSlot(midnight),false);
  assert.equal(isNoonSlot(midnight+12*3600_000),true);
});
test('three completed consecutive calendar days qualify, partial current day does not',()=>{
  assert.deepEqual(stableThreeDays(records,Date.parse('2026-10-31T00:00:00+08:00'),sources,recovery),['2026-10-28','2026-10-29','2026-10-30']);
  assert.equal(stableThreeDays(records,Date.parse('2026-10-30T23:59:59+08:00'),sources,recovery),null);
});
test('missing scope, manual/synthetic runs, failed readback and unverified recovery never lower frequency',()=>{
  const now=Date.parse('2026-10-31T00:01:00+08:00');
  for(const change of [{capturedSourceIds:sources.slice(1)},{trigger:'manual'},{kind:'synthetic'},{webReadback:false},{complete:false},{verifiedAt:'2026-10-31T00:01:00+08:00'}]) {
    assert.equal(stableThreeDays([{...records[0],...change},...records.slice(1)],now,sources,recovery),null);
  }
  assert.equal(stableThreeDays(records.slice(1),now,sources,recovery),null);
  assert.equal(stableThreeDays(records,now,sources,{...recovery,kind:'synthetic'}),null);
  assert.equal(stableThreeDays(records,now,sources,{...recovery,checks:{}}),null);
});
