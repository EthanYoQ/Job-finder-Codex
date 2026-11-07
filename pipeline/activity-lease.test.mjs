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
  let count=0,timers=0;
  await assert.rejects(startActivityLease('m_synthetic','SYNTHETIC_TEST_KEY',{
    request:async()=>{count++;return new Response('PRIVATE_PROVIDER_TEXT',{status:403});},
    every(){timers++;throw Error('TIMER_MUST_NOT_START');}
  }),error=>{
    assert.equal(error.message,'ACTIVITY_LEASE_PUT_FAILED');
    assert.deepEqual(error.diagnostics,{category:'HTTP',httpStatus:403,lastSuccessfulPutAt:null});
    assert.equal(error.cause,undefined);
    assert.doesNotMatch(String(error)+JSON.stringify(error),/PRIVATE_PROVIDER_TEXT|SYNTHETIC_TEST_KEY|https:\/\//);
    return true;
  });
  assert.equal(count,1);assert.equal(timers,0);
});

test('renewal failure is visible and recoverable; release failure is bounded by lease expiry',async(t)=>{
  const startedAt=Date.parse('2026-11-07T06:30:00.000Z');
  t.mock.timers.enable({apis:['Date'],now:startedAt});
  let tick,count=0,timers=0;const reports=[];
  const release=await startActivityLease('m_synthetic','SYNTHETIC_TEST_KEY',{
    request:async(_url,options)=>{
      count++;
      if(count===2)return new Response('PRIVATE_PROVIDER_TEXT',{status:429});
      if(count===3)throw new DOMException('PRIVATE_PROVIDER_TEXT','TimeoutError');
      if(count===4)throw new TypeError('https://private.example/SYNTHETIC_TEST_KEY',{
        cause:Error('PRIVATE_PROVIDER_TEXT')
      });
      if(options.method==='DELETE')return new Response('PRIVATE_PROVIDER_TEXT',{status:503});
      return new Response();
    },every(fn,ms){assert.equal(ms,120000);timers++;tick=fn;return 1;},cancel(id){assert.equal(id,1);},report:value=>reports.push(JSON.parse(value))
  });
  for(let renewal=1;renewal<=4;renewal++){
    t.mock.timers.setTime(startedAt+renewal*120000);
    tick();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(count,renewal+1);
  }
  await release();assert.equal(count,6);assert.equal(timers,1);
  assert.deepEqual(reports,[
    {status:'ACTIVITY_LEASE_RENEWAL_FAILED',category:'HTTP',httpStatus:429,lastSuccessfulPutAt:'2026-11-07T06:30:00.000Z'},
    {status:'ACTIVITY_LEASE_RENEWAL_FAILED',category:'TIMEOUT',lastSuccessfulPutAt:'2026-11-07T06:30:00.000Z'},
    {status:'ACTIVITY_LEASE_RENEWAL_FAILED',category:'NETWORK',lastSuccessfulPutAt:'2026-11-07T06:30:00.000Z'},
    {status:'ACTIVITY_LEASE_RELEASE_FAILED',expiresWithinSeconds:300,category:'HTTP',httpStatus:503,lastSuccessfulPutAt:'2026-11-07T06:38:00.000Z'}
  ]);
});
