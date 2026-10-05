import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { buildObservedCommand } from './build-observed-command.mjs';

const base = fileURLToPath(new URL('.', import.meta.url));
const source = readFileSync(base + 'start-monitor-portable42-observed.js', 'utf8');
const A = Object.getPrototypeOf(async function () {}).constructor;
new A(source);
const baseline = JSON.parse(readFileSync(base + 'BASELINE.json', 'utf8'));
for (const [relative, expected] of Object.entries(baseline.files)) {
  assert.equal(createHash('sha256').update(readFileSync(baseline.root + '/' + relative)).digest('hex'), expected, relative + ' baseline changed');
}
const original = readFileSync(baseline.root + '/hosts/portable42-novartis/runtime-heap512/start-monitor-portable42.js', 'utf8');
const start = source.indexOf('function buildObservedCommand(');
const end = source.indexOf('const started=await tools.exec_command({cmd:observedCommand');
assert.ok(start > 0 && end > start);
const block = source.slice(start, end);
assert.equal(source.replace(block, '').replace('const started=await tools.exec_command({cmd:observedCommand,', 'const started=await tools.exec_command({cmd:command,'), original);
const originalCommand = original.split('\n').find(line => line.startsWith('const command='));
assert.equal(source.split('\n').find(line => line.startsWith('const command=')), originalCommand);
assert.match(originalCommand, /--max-old-space-size=512 /);
const runCheck = new A('h', 'tools', 'run', 'batch', 'command', 'row', block + '\nreturn observedCommand;');
const sampler = '/workspace/scratch/5e9614251709/jb-memory-observation-20261005T1115Z/sample_process_tree.py';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const correctHash = execFileSync('sha256sum', ['--', sampler], { encoding: 'utf8' });
const cases = [];

async function check(name, response, checkedAt, errorPattern) {
  let checks = 0;
  let saves = 0;
  const h = {
    q: quote, cfg: { sourceId: 'source-novartis-social' },
    readFile() { throw Error('HOST_PATH_SCOPE'); },
    async save(path, text) {
      assert.equal(path, '/synthetic-run/reviewed-observer-command.txt');
      assert.ok(text.includes('(exec NO_EXECUTION_IN_THIS_TEST) &'));
      saves++;
    },
  };
  const tools = {
    async exec_command(args) {
      checks++;
      assert.equal(args.cmd, 'sha256sum -- ' + quote(sampler));
      return response;
    },
  };
  const invoke = () => runCheck(h, tools, '/synthetic-run', 'synthetic-batch', 'NO_EXECUTION_IN_THIS_TEST', { checkedAt });
  if (errorPattern) await assert.rejects(invoke, errorPattern);
  else {
    const observed = await invoke();
    assert.equal(observed, buildObservedCommand('NO_EXECUTION_IN_THIS_TEST', { samplerPath: sampler, expectedArg: 'scripts/run-with-http-diagnostics.mjs', outputDir: '/synthetic-run/memory-observation', label: 'source-novartis-social/synthetic-batch' }, quote));
  }
  assert.equal(checks, 1);
  assert.equal(saves, name === 'good-hash' || name === 'expired-bootstrap' ? 1 : 0);
  cases.push({ name, outcome: errorPattern ? String(errorPattern) : 'PASSED', hashChecks: checks, saves, restrictedHostReadNeverCalled: true });
}
await check('good-hash', { exit_code: 0, output: correctHash }, new Date().toISOString());
await check('wrong-hash', { exit_code: 0, output: 'wrong' }, new Date().toISOString(), /MEMORY_SAMPLER_HASH_MISMATCH/);
await check('failed-hash-tool', { exit_code: 1, output: correctHash }, new Date().toISOString(), /MEMORY_SAMPLER_HASH_MISMATCH/);
await check('running-hash-tool', { exit_code: 0, session_id: 123, output: correctHash }, new Date().toISOString(), /MEMORY_SAMPLER_HASH_MISMATCH/);
await check('expired-bootstrap', { exit_code: 0, output: correctHash }, '2000-01-01T00:00:00Z', /FRESH_BOOTSTRAP_EXPIRED_BEFORE_LAUNCH/);

writeFileSync(base + 'STARTER_PREFLIGHT_SELFTEST.json', JSON.stringify({ checkedAt: new Date().toISOString(), noCaptureOrNetworkOrDatabase: true, asyncFunctionSyntax: true, baselineFilesUnchanged: Object.keys(baseline.files).length, originalCaptureCommandUnchanged: true, originalStatementsByteIdentical: true, heap512Preserved: true, passed: cases.length, cases }, null, 2) + '\n');
console.log(JSON.stringify({ passed: cases.length, originalStatementsByteIdentical: true, cases }));
