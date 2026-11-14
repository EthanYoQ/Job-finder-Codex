import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {createIsolatedBGradeTraversalValidator, executeBGradeValidatorCommand,
  serializeBGradeValidatorSuccess,decodeBGradeValidatorOutput} from '../src/crawler/isolatedBGradeTraversalValidator.ts';

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
