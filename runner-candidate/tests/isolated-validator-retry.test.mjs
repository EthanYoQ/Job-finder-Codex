import test from 'node:test';
import assert from 'node:assert/strict';
import {createIsolatedBGradeTraversalValidator} from '../src/crawler/isolatedBGradeTraversalValidator.ts';
import {classifyBGradeIndependentTraversalFailure} from '../src/crawler/independentTraversalDiagnostics.ts';
import {createViatrisBrowserTraversalValidation} from '../src/crawler/traversalCertificate.ts';

const input = {
  sourceId: 'source-viatris-social', companyId: 'company-viatris',
  sourceConfigSha256: 'a'.repeat(64), surfaceIds: ['synthetic-surface'], channelIds: ['synthetic-channel']
};
const validation = createViatrisBrowserTraversalValidation({
  sourceConfigSha256: input.sourceConfigSha256, surfaceIds: input.surfaceIds, channelIds: input.channelIds,
  pages: [{pageNumber: 1, declaredTotalPages: 1, sourceJobIds: ['synthetic-job'], nextControlPresent: false}],
  observedAt: '2026-10-31T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z'
});
const succeeded = JSON.stringify({decision: 'SUCCEEDED', validation});
const failed = failureCode => JSON.stringify({decision: 'FAILED', failureCode, message: failureCode});

test('program failure envelope is executed once without backoff', async () => {
  let calls = 0;
  const delays = [];
  const validate = createIsolatedBGradeTraversalValidator(async () => {
    calls++;
    return failed('B_GRADE_VALIDATOR_EXECUTION_FAILED');
  }, async ms => { delays.push(ms); });
  await assert.rejects(validate(input), error =>
    classifyBGradeIndependentTraversalFailure(error) === 'B_GRADE_VALIDATOR_EXECUTION_FAILED');
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test('unclassified process exception is not presumed transient or retried', async t => {
  const logs = [];
  t.mock.method(console, 'error', line => logs.push(line));
  let calls = 0;
  const delays = [];
  const original = new Error('Please use browser.newContext()');
  const validate = createIsolatedBGradeTraversalValidator(async () => {
    calls++;
    throw original;
  }, async ms => { delays.push(ms); });
  await assert.rejects(validate(input), error => error === original &&
    classifyBGradeIndependentTraversalFailure(error) === 'B_GRADE_VALIDATOR_EXECUTION_FAILED');
  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
  assert.equal(logs.length, 1);
});

test('successful validated result returns once without backoff', async () => {
  let calls = 0;
  const validate = createIsolatedBGradeTraversalValidator(async () => {
    calls++;
    return succeeded;
  }, async () => assert.fail('success must not wait'));
  assert.deepEqual(await validate(input), validation);
  assert.equal(calls, 1);
});

test('temporary navigation and readiness failures retain bounded retries and success', async () => {
  for (const [failureCode, attempts] of [
    ['B_GRADE_BROWSER_NAVIGATION_FAILED', 2],
    ['B_GRADE_BROWSER_READINESS_FAILED', 3]
  ]) {
    let calls = 0;
    const delays = [];
    const validate = createIsolatedBGradeTraversalValidator(async () =>
      ++calls < attempts ? failed(failureCode) : succeeded,
    async ms => { delays.push(ms); });
    assert.deepEqual(await validate(input), validation);
    assert.equal(calls, attempts);
    assert.deepEqual(delays, Array(attempts - 1).fill(10_000));

    calls = 0;
    delays.length = 0;
    const exhaust = createIsolatedBGradeTraversalValidator(async () => {
      calls++;
      return failed(failureCode);
    }, async ms => { delays.push(ms); });
    await assert.rejects(exhaust(input), error => classifyBGradeIndependentTraversalFailure(error) === failureCode);
    assert.equal(calls, attempts);
    assert.deepEqual(delays, Array(attempts - 1).fill(10_000));
  }
});

test('aborted process keeps aborted classification without retry', async t => {
  t.mock.method(console, 'error', () => {});
  const controller = new AbortController();
  let calls = 0;
  const validate = createIsolatedBGradeTraversalValidator(async () => {
    calls++;
    controller.abort(new Error('synthetic cancellation'));
    throw controller.signal.reason;
  }, async () => assert.fail('abort must not wait'));
  await assert.rejects(validate({...input, signal: controller.signal}), error =>
    classifyBGradeIndependentTraversalFailure(error) === 'B_GRADE_VALIDATOR_ABORTED');
  assert.equal(calls, 1);
});
