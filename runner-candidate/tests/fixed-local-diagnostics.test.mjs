import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';

test('fixed local failures are readable while appended or external messages stay private', () => {
  const cases = [
    ['Isolated B-grade traversal process exceeded its output limit', 'B_GRADE_VALIDATOR_OUTPUT_LIMIT_EXCEEDED'],
    ['SANOFI_COMPACT_DECISION_MISMATCH', 'SANOFI_COMPACT_DECISION_MISMATCH']
  ];
  for (const [message, code] of cases) {
    const error = new Error(message);
    const diagnostic = sourceFetchDiagnostic('source-sanofi-china-social', {error});
    assert.equal(diagnostic.reason, code);
    assert.equal(diagnostic.reasonSha256, createHash('sha256').update(message).digest('hex'));
    for (const privateMessage of [`${message}: SYNTHETIC_PRIVATE_VALUE`, `SYNTHETIC_PRIVATE_VALUE ${message}`, `${message}\nSYNTHETIC_PRIVATE_VALUE`]) {
      const hidden = sourceFetchDiagnostic('source-sanofi-china-social', {error: new Error(privateMessage)});
      assert.equal(hidden.reason, 'UNRECOGNIZED_PRIVATE_REASON');
      assert(!JSON.stringify(hidden).includes('SYNTHETIC_PRIVATE_VALUE'));
    }
    assert.equal(error.message, message);
  }
  assert.equal(sourceFetchDiagnostic('source-sanofi-china-social', {
    error: new Error('SANOFI_COMPACT_DYNAMIC_PRIVATE_VALUE')
  }).reason, 'UNRECOGNIZED_PRIVATE_REASON');
});
