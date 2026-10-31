import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedBGradeTraversalValidator, executeBGradeValidatorCommand} from '../src/crawler/isolatedBGradeTraversalValidator.ts';

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
