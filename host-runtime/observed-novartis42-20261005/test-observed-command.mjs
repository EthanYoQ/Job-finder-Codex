import { buildObservedCommand } from './build-observed-command.mjs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const base = fileURLToPath(new URL('.', import.meta.url));
const fixture = base + 'fixture-capture.mjs';
const sampler = '/workspace/scratch/5e9614251709/jb-memory-observation-20261005T1115Z/sample_process_tree.py';
const results = [];
for (const [name, exitCode, expectedArg] of [
  ['zero-target', 0, fixture],
  ['nonzero-target', 7, fixture],
  ['observer-failure-zero', 0, 'deliberately-wrong-root-token'],
  ['observer-failure-nonzero', 7, 'deliberately-wrong-root-token'],
]) {
  const outputDir = base + 'synthetic-' + name;
  mkdirSync(outputDir);
  const marker = outputDir + '/fixture-completed.json';
  const target = 'node ' + quote(fixture) + ' ' + exitCode + ' ' + quote(marker);
  const shell = buildObservedCommand(target, {
    samplerPath: sampler, expectedArg, outputDir, label: 'SYNTHETIC_ONLY/' + name,
  }, quote);
  assert.equal(shell.split('\n')[0], '(exec ' + target + ') &');
  assert.equal(spawnSync('bash', ['-n', '-c', shell]).status, 0);
  const startedAt = performance.now();
  const run = spawnSync('bash', ['-e', '-c', shell], { encoding: 'utf8', timeout: 15000 });
  const elapsedMs = performance.now() - startedAt;
  assert.equal(run.error, undefined);
  assert.equal(run.status, exitCode);
  assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), { childExit: 0, targetExit: exitCode, completed: true });
  assert.ok(elapsedMs >= 1000, 'Target must survive until its child completes');
  const observerFailed = name.startsWith('observer-failure');
  assert.match(run.stdout, new RegExp('MEMORY_OBSERVER_EXIT=' + (observerFailed ? 2 : 0) + ' CAPTURE_EXIT=' + exitCode));
  if (!observerFailed) {
    const report = JSON.parse(readFileSync(outputDir + '/summary.json', 'utf8'));
    assert.equal(report.status, 'TARGET_TREE_EXITED');
    assert.equal(report.rootIdentityVerifiedByExactArg, true);
    assert.ok(report.sampleCount >= 2);
    assert.ok(report.treeRssPeak.KiB > 0);
    assert.ok(report.processLifetimes.length >= 2, 'Synthetic root and child must both be observed');
    assert.ok(report.processLifetimes.every(process => process.pid !== report.samplerPid));
  }
  results.push({ name, expectedCaptureExit: exitCode, actualExit: run.status, observerExit: observerFailed ? 2 : 0, completedMarkerVerified: true, bashErrexitEnabled: true, elapsedMs: Math.round(elapsedMs), output: run.stdout.trim() });
}
writeFileSync(base + 'SELFTEST.json', JSON.stringify({ checkedAt: new Date().toISOString(), noNetworkOrDatabase: true, passed: results.length, results }, null, 2) + '\n');
console.log(JSON.stringify({ passed: results.length, results }));
