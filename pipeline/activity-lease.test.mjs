import test from 'node:test';
import assert from 'node:assert/strict';
import {startActivityLease} from './activity-lease.mjs';

test('one task lease is renewed and released after pending renewal, without lifecycle calls',async()=>{
  const calls=[],events=[];let tick,resolveRenew;
  const release=await startActivityLease('m_synthetic','SYNTHETIC_TEST_KEY',{
    request:async(url,options)=>{
      calls.push({url,...options});events.push(options.method);
      if(calls.length===2)await new Promise(resolve=>{resolveRenew=resolve;});
      return new Response(null,{status:options.method==='DELETE'?204:200});
    },every(fn,ms){assert.equal(ms,120000);tick=fn;return 1;},cancel(id){assert.equal(id,1);events.push('cancel');}
  });
  assert.equal(calls[0].method,'PUT');assert.equal(JSON.parse(calls[0].body).ttlSeconds,300);
  assert.equal(calls[0].headers['X-API-Key'],'SYNTHETIC_TEST_KEY');
  tick();await Promise.resolve();
  const closing=release();assert.deepEqual(events,['PUT','PUT','cancel']);
  resolveRenew();await closing;
  assert.deepEqual(events,['PUT','PUT','cancel','DELETE']);
  assert.equal(new Set(calls.map(row=>row.url)).size,1);
  assert.match(calls[0].url,/^https:\/\/api\.instabox\.sh\/v1\/machines\/m_synthetic\/activity-leases\/jobfinder-[a-f0-9-]+$/);
});

test('initial refusal stops before starting renewal and never exposes provider body',async()=>{
  await assert.rejects(startActivityLease('m_synthetic','SYNTHETIC_TEST_KEY',{
    request:async()=>new Response('PRIVATE_PROVIDER_TEXT',{status:403}),
    every(){throw Error('TIMER_MUST_NOT_START');}
  }),error=>error.message==='ACTIVITY_LEASE_PUT_FAILED');
});

test('renewal failure is visible and recoverable; release failure is bounded by lease expiry',async()=>{
  let tick,count=0;const reports=[];
  const release=await startActivityLease('m_synthetic','SYNTHETIC_TEST_KEY',{
    request:async(_url,options)=>{count++;if(count===2||options.method==='DELETE')throw Error('PRIVATE_PROVIDER_TEXT');return new Response();},
    every(fn){tick=fn;return 1;},cancel(){},report:value=>reports.push(JSON.parse(value))
  });
  tick();await new Promise(resolve=>setImmediate(resolve));
  tick();await new Promise(resolve=>setImmediate(resolve));
  await release();assert.equal(count,4);
  assert.deepEqual(reports,[{status:'ACTIVITY_LEASE_RENEWAL_FAILED'},{status:'ACTIVITY_LEASE_RELEASE_FAILED',expiresWithinSeconds:300}]);
});
