import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {createOfficialJsonSourceFetch} from '../src/crawler/officialJsonSourceFetch.ts';
import {runWithOfficialSourceAttemptTimeout} from '../src/crawler/officialHttpRuntimeLimits.ts';
import {NOVO_NATIVE_RETRY} from '../src/crawler/novoNativeGatewayRetry.ts';
import {pages,detail} from './novo-synthetic-pages.ts';
import {NOVO_CHINA_ENDPOINT} from '../src/crawler/novoChinaQuality.ts';

test('Novo native acquisition completes beyond five minutes and retains one bounded gateway retry',async t=>{
  const plan=(await loadDirectPlans()).find(row=>row.sourceId==='source-novo-nordisk-china-social').plan;
  t.mock.timers.enable({apis:['Date','setTimeout'],now:Date.UTC(2026,10,18)});
  for(const timeout of [300_000,NOVO_NATIVE_RETRY.sourceMs]) {
    const calls=[];let gatewayFailed=false;
    const fetch=createOfficialJsonSourceFetch({now:()=>new Date(),nativeHttpRetryDelay:async ms=>t.mock.timers.tick(ms),
      http:async request=>{
        const page=pages.get(request.url);assert.ok(page,request.url);calls.push(request.url);
        if(request.url===detail(1))t.mock.timers.tick(300_001);
        const gateway=request.url===detail(2)&&!gatewayFailed;
        if(gateway)gatewayFailed=true;
        return {...page,status:gateway?504:200,body:gateway?'<html><h1>504 Gateway Time-out</h1></html>':page.body,
          capturedAt:new Date().toISOString()};
      }});
    const operation=runWithOfficialSourceAttemptTimeout(()=>fetch(plan),timeout);
    if(timeout===300_000) {
      await assert.rejects(operation,{code:'OFFICIAL_SOURCE_ATTEMPT_TIMEOUT'});
      assert.equal(calls.includes(detail(2)),false);
    } else {
      const result=await operation;
      assert.equal(result.ok,true,result.failureReason);
      assert.equal(result.fetchEvidence.jobQuarantines?.length??0,0);
      assert.equal(calls.filter(url=>url===NOVO_CHINA_ENDPOINT).length,1);
      assert.equal(calls.filter(url=>url===detail(2)).length,2);
      assert.equal(result.fetchEvidence.artifacts.filter(a=>a.httpStatus===504).length,1);
      assert.equal(result.fetchEvidence.fetchLosses.filter(loss=>loss.details.code==='OFFICIAL_APPLICATION_CLOSED').length,1);
    }
  }
});
