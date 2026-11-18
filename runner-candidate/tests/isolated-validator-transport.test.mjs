import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {bGradeValidatorChildEnvironment,createIsolatedBGradeTraversalValidator,executeBGradeValidatorCommand,
  decodeBGradeValidatorOutput} from '../src/crawler/isolatedBGradeTraversalValidator.ts';
import {recordIsolatedSourceTransportObservation,withSourceTransportObservation} from '../src/crawler/sourceTransportObservation.ts';

const loader=new URL('./fixtures/isolated-transport-loader.mjs',import.meta.url).href;
const inputFor=(sourceId,mode='failure')=>({sourceId,companyId:'company-'+sourceId.slice(7).replace(/-social$/,''),
  entryUrl:`https://careers.example.test/synthetic?mode=${mode}`,sourceConfigSha256:'a'.repeat(64),
  surfaceIds:['synthetic-surface'],channelIds:['synthetic-channel']});
const child=(input,signal,observe)=>executeBGradeValidatorCommand(process.execPath,
  ['--import','tsx','--import',loader,'scripts/p0-b-grade-validator.ts'],
  bGradeValidatorChildEnvironment(process.env,input),signal,20,observe);

for(const sourceId of ['source-sanofi-china-social','source-bayer-healthcare-social','source-pfizer-china-social']) {
  test(`${sourceId} real child relays two-hour Retry-After and does not restart immediately`,async t=>{
    t.mock.method(console,'error',()=>{});
    const observations=[],input=inputFor(sourceId,'browser-failure');let launches=0,envelope;
    const validate=createIsolatedBGradeTraversalValidator(async(payload,signal)=>{
      launches++;
      const output=await child(payload,signal,AsyncLocalStorage.bind(recordIsolatedSourceTransportObservation));
      envelope=JSON.parse(decodeBGradeValidatorOutput(output,payload.sourceId));
      assert.equal(output.includes('PRIVATE_SYNTHETIC_RESPONSE_BODY'),false);
      return output;
    },async()=>assert.fail('A future official retry floor must prevent immediate validator retry'));
    await assert.rejects(withSourceTransportObservation(sourceId,value=>observations.push(value),
      ()=>validate({...input,signal:AbortSignal.timeout(15_000)})),
      {bGradeIndependentTraversalFailureCode:'B_GRADE_BROWSER_READINESS_FAILED'});
    assert.equal(launches,1);assert.equal(envelope.decision,'FAILED');
    const last=observations.at(-1);
    assert.equal(last.sourceId,sourceId);assert.equal(last.observedActualHttp,true);
    assert.deepEqual(last.actualHttpStatuses,[429]);
    assert.equal(last.retryAt-last.lastActualRequestAt,7_200_000);
    assert.deepEqual(envelope.transportObservation.actualHttpStatuses,[429]);
    assert.equal(envelope.transportObservation.retryAt,last.retryAt);
  });
}

test('successful real child returns its transport floor without changing the validation',async()=>{
  const input=inputFor('source-viatris-social','success'),observations=[];
  const validate=createIsolatedBGradeTraversalValidator((payload,signal)=>child(payload,signal,
    AsyncLocalStorage.bind(recordIsolatedSourceTransportObservation)));
  const validation=await withSourceTransportObservation(input.sourceId,value=>observations.push(value),
    ()=>validate({...input,signal:AbortSignal.timeout(15_000)}));
  assert.equal(validation.sourceId,input.sourceId);
  assert.equal(validation.companyId,input.companyId);
  assert.equal(validation.sourceConfigSha256,input.sourceConfigSha256);
  assert.deepEqual(validation.surfaceIds,input.surfaceIds);
  assert.deepEqual(validation.channelIds,input.channelIds);
  const last=observations.at(-1);
  assert.deepEqual(last.actualHttpStatuses,[503]);
  assert.equal(last.retryAt-last.lastActualRequestAt,7_200_000);
});

test('a child killed before its final envelope has already relayed its official retry floor',async()=>{
  const input=inputFor('source-sanofi-china-social','hang'),controller=new AbortController(),observations=[];
  await assert.rejects(withSourceTransportObservation(input.sourceId,value=>observations.push(value),async()=>{
    await child(input,controller.signal,AsyncLocalStorage.bind(observation=>{
      recordIsolatedSourceTransportObservation(observation);
      controller.abort(Error('synthetic parent cancellation'));
    }));
  }));
  assert.equal(controller.signal.aborted,true);
  const last=observations.at(-1);
  assert.deepEqual(last.actualHttpStatuses,[503]);
  assert.equal(last.retryAt-last.lastActualRequestAt,7_200_000);
});

test('malformed streaming frames are ignored and wrong-source envelopes cannot alter parent scheduling',async()=>{
  let streamed=0;
  await executeBGradeValidatorCommand(process.execPath,['-e',
    'process.stderr.write("JOBFINDER_SOURCE_TRANSPORT_OBSERVATION:{bad}\\n");process.stdout.write("ok")'],
    process.env,AbortSignal.timeout(10_000),20,()=>streamed++);
  assert.equal(streamed,0);
  const input=inputFor('source-sanofi-china-social'),now=Date.now(),observations=[];
  const validate=createIsolatedBGradeTraversalValidator(async()=>JSON.stringify({decision:'FAILED',
    failureCode:'B_GRADE_BROWSER_READINESS_FAILED',message:'synthetic failure',transportObservation:{
      sourceId:'source-bayer-healthcare-social',observedAt:now,observedActualHttp:true,
      actualHttpStatuses:[503],lastActualRequestAt:now,locallyDeferred:false,retryAt:now+7_200_000}}));
  await assert.rejects(withSourceTransportObservation(input.sourceId,value=>observations.push(value),()=>validate(input)),
    /transport observation source mismatch/);
  assert.deepEqual(observations,[]);
});
