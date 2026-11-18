import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {bGradeValidatorChildEnvironment,createIsolatedBGradeTraversalValidator,executeBGradeValidatorCommand,
  serializeBGradeValidatorSuccess,decodeBGradeValidatorOutput} from '../src/crawler/isolatedBGradeTraversalValidator.ts';
import {assertWorkdayAvailable,waitForWorkdayRequest,withWorkdayRequestPolicy,WorkdayCooldownError} from '../src/crawler/workdayRequestPolicy.ts';
import {classifyBGradeIndependentTraversalFailure,tagBGradeIndependentTraversalFailure} from '../src/crawler/independentTraversalDiagnostics.ts';

test('an explicit validator cancellation tag takes precedence over the cooldown error type',()=>{
  const error=new WorkdayCooldownError(429,60_000);
  assert.equal(classifyBGradeIndependentTraversalFailure(error),'B_GRADE_WORKDAY_COOLDOWN');
  tagBGradeIndependentTraversalFailure(error,'B_GRADE_VALIDATOR_ABORTED');
  assert.equal(classifyBGradeIndependentTraversalFailure(error),'B_GRADE_VALIDATOR_ABORTED');
});

test('Pfizer isolated browser launch respects Workday pacing in both directions',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pfizer-validator-pace-'));
  const entryUrl='https://pfizer.wd1.myworkdayjobs.com/PfizerCareers';
  const amgenUrl='https://amgen.wd1.myworkdayjobs.com/Careers';
  try {
    await withWorkdayRequestPolicy(root,async()=>{
      const firstRequestAt=Date.now();
      await waitForWorkdayRequest(amgenUrl);
      let childFinishedAt;
      const validate=createIsolatedBGradeTraversalValidator(async()=>{
        childFinishedAt=Date.now();
        return JSON.stringify({decision:'FAILED',failureCode:'B_GRADE_VALIDATOR_EXECUTION_FAILED',
          message:'B-grade independent traversal failed: B_GRADE_VALIDATOR_EXECUTION_FAILED'});
      });
      await assert.rejects(validate({sourceId:'source-pfizer-china-social',entryUrl}),
        {bGradeIndependentTraversalFailureCode:'B_GRADE_VALIDATOR_EXECUTION_FAILED'});
      assert.ok(childFinishedAt-firstRequestAt>=500,'The child cannot launch immediately after a parent Workday request');
      await waitForWorkdayRequest(amgenUrl);
      assert.ok(Date.now()-childFinishedAt>=500,'The next parent request must respect the gap after the last possible child request');
    });
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('Pfizer reloads a child cooldown and skips launching the isolated browser again', async t => {
  t.mock.method(console, 'error', () => {});
  const root = await mkdtemp(join(tmpdir(),'pfizer-validator-cooldown-'));
  const entryUrl = 'https://pfizer.wd1.myworkdayjobs.com/PfizerCareers';
  const otherUrl = 'https://amgen.wd1.myworkdayjobs.com/Careers';
  const input = {sourceId:'source-pfizer-china-social',companyId:'company-pfizer-china',entryUrl};
  const moduleUrl = new URL('../src/crawler/workdayRequestPolicy.ts',import.meta.url).href;
  try {
    await withWorkdayRequestPolicy(root, async () => {
      assertWorkdayAvailable(entryUrl);
      let calls = 0;
      const validate = createIsolatedBGradeTraversalValidator(async (payload, signal) => {
        calls++;
        const env = bGradeValidatorChildEnvironment(process.env,payload);
        assert.equal(env.JOBFINDER_WORKDAY_POLICY_ROOT,root);
        assert.equal(bGradeValidatorChildEnvironment(process.env,{
          ...payload,sourceId:'source-sanofi-china-social'
        }).JOBFINDER_WORKDAY_POLICY_ROOT,undefined);
        return executeBGradeValidatorCommand(process.execPath,
          ['--import','tsx','--input-type=module','-e',`
            import {recordWorkdayAccessResponse,withWorkdayRequestPolicy} from ${JSON.stringify(moduleUrl)};
            await withWorkdayRequestPolicy(process.env.JOBFINDER_WORKDAY_POLICY_ROOT,async()=>{
              recordWorkdayAccessResponse(${JSON.stringify(entryUrl)},429,new Headers({'cf-mitigated':'challenge'}));
            });
            process.stdout.write(JSON.stringify({decision:'FAILED',failureCode:'B_GRADE_OFFICIAL_ACCESS_RESTRICTED',
              message:'B-grade independent traversal failed: B_GRADE_OFFICIAL_ACCESS_RESTRICTED'}));
          `], env, signal);
      }, async () => assert.fail('Pfizer access restrictions must not be retried'));
      await assert.rejects(validate(input),{bGradeIndependentTraversalFailureCode:'B_GRADE_OFFICIAL_ACCESS_RESTRICTED'});
      const saved=JSON.parse(await readFile(join(root,'workday-cooldown.json'),'utf8'));
      assert.equal(saved.family,undefined);
      assert.deepEqual(Object.keys(saved.hosts),[new URL(entryUrl).hostname]);
      assert.throws(()=>assertWorkdayAvailable(entryUrl),{code:'WORKDAY_COOLDOWN'});
      assert.doesNotThrow(()=>assertWorkdayAvailable(otherUrl));
      await assert.rejects(validate(input),{bGradeIndependentTraversalFailureCode:'B_GRADE_WORKDAY_COOLDOWN'});
      assert.equal(calls,1);

      const output = await executeBGradeValidatorCommand(process.execPath,
        ['--import','tsx','scripts/p0-b-grade-validator.ts'], bGradeValidatorChildEnvironment(process.env,input),
        AbortSignal.timeout(10_000));
      assert.equal(JSON.parse(output).failureCode,'B_GRADE_WORKDAY_COOLDOWN');
    });
  } finally {
    await rm(root,{recursive:true,force:true});
  }
});

test('actual child returns a complete 32 MiB synthetic evidence envelope', async () => {
  const output = await executeBGradeValidatorCommand(process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify({decision:"SUCCEEDED",validation:{syntheticEvidence:"x".repeat(32*1024*1024)}}))'],
    {}, AbortSignal.timeout(30_000));
  const result = JSON.parse(output);
  assert.equal(result.decision, 'SUCCEEDED');
  assert.equal(result.validation.syntheticEvidence.length, 32 * 1024 * 1024);
  assert.equal(result.validation.syntheticEvidence, 'x'.repeat(32 * 1024 * 1024));
});

test('actual child exceeding 64 MiB remains a single execution failure', async t => {
  t.mock.method(console, 'error', () => {});
  let executions = 0;
  const validate = createIsolatedBGradeTraversalValidator(async (_input, signal) => {
    executions++;
    return executeBGradeValidatorCommand(process.execPath,
      ['-e', 'process.stdout.write("x".repeat(65*1024*1024))'], {}, signal);
  }, async () => assert.fail('output-limit failure must not be retried'));
  await assert.rejects(validate({sourceId: 'source-sanofi-china-social', signal: AbortSignal.timeout(30_000)}),
    /Isolated B-grade traversal process exceeded its output limit/);
  assert.equal(executions, 1);
});

test('Sanofi transports 65 MiB of synthetic exact evidence without increasing the pipe limit',async()=>{
  const moduleUrl=new URL('../src/crawler/isolatedBGradeTraversalValidator.ts',import.meta.url).href;
  const output=await executeBGradeValidatorCommand(process.execPath,
    ['--import','tsx','--input-type=module','-e',`import {serializeBGradeValidatorSuccess} from ${JSON.stringify(moduleUrl)};
      process.stdout.write(serializeBGradeValidatorSuccess({sourceId:'source-sanofi-china-social',syntheticEvidence:'x'.repeat(65*1024*1024)}));`],
    process.env,AbortSignal.timeout(30_000));
  assert.ok(Buffer.byteLength(output)<64*1024*1024);
  const decoded=decodeBGradeValidatorOutput(output,'source-sanofi-china-social');
  assert.equal(decoded,JSON.stringify({decision:'SUCCEEDED',validation:{sourceId:'source-sanofi-china-social',syntheticEvidence:'x'.repeat(65*1024*1024)}}));
});

test('Sanofi transport keeps legacy JSON and rejects wrong-source, corrupt and over-expanded output',()=>{
  const validation={sourceId:'source-sanofi-china-social',syntheticEvidence:'中文岗位原件'};
  const legacy=JSON.stringify({decision:'SUCCEEDED',validation});
  const compressed=serializeBGradeValidatorSuccess(validation);
  assert.equal(decodeBGradeValidatorOutput(compressed,validation.sourceId),legacy);
  assert.equal(decodeBGradeValidatorOutput(legacy,validation.sourceId),legacy);
  const other={...validation,sourceId:'source-bayer-healthcare-social'};
  assert.equal(serializeBGradeValidatorSuccess(other),JSON.stringify({decision:'SUCCEEDED',validation:other}));
  assert.throws(()=>decodeBGradeValidatorOutput(compressed,other.sourceId),/source mismatch/);
  assert.throws(()=>decodeBGradeValidatorOutput(compressed+'!',validation.sourceId),/Malformed/);
  assert.throws(()=>decodeBGradeValidatorOutput(compressed.slice(0,-8),validation.sourceId));
  const oversized='sanofi-b-grade-gzip-v1:'+gzipSync(Buffer.alloc(128*1024*1024+1),{level:1}).toString('base64');
  assert.throws(()=>decodeBGradeValidatorOutput(oversized,validation.sourceId),{code:'ERR_BUFFER_TOO_LARGE'});
});
