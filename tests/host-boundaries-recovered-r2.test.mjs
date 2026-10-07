// PURE_SYNTHETIC_OFFLINE: actual prepared source is evaluated only in a VM.
// Every command, DB call, file mutation, child process, clock and signal in the
// fragments is intercepted. Only reading this payload uses the real filesystem.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, constants as F } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { constants as O } from 'node:os';
import vm from 'node:vm';

const preparation = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtime = resolve(preparation, '../..');
const payload = join(preparation, 'payload');
const candidate = { id: 'dot-cloud-delta-proxy-28402a29-20261007', goalId: 'jobfinder-portable-required-40', version: 51 };
const commit = '28402a299bb04cbf5873da66c2fe8ca76827c0d1';
const databaseIdentity = { databaseId: 'SYNTHETIC_ONLY', projectId: 'SYNTHETIC_ONLY' };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const quote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const fragment = (code, globals, params = [], args = []) => vm.compileFunction(
  'return (async () => {\n' + code + '\n})();', params,
  { parsingContext: vm.createContext(globals) }
)(...args);
const bindInMemory = (code, database = false) => {
  assert.equal(code.split('const expectedCandidate=null; // OWNER_CANDIDATE_BINDING').length, 2);
  code = code.replace('const expectedCandidate=null; // OWNER_CANDIDATE_BINDING', `const expectedCandidate=${JSON.stringify(candidate)}; // SYNTHETIC_ONLY`);
  if (database) {
    assert.equal(code.split('const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING').length, 2);
    code = code.replace('const expectedDatabaseIdentity=null; // OWNER_DATABASE_BINDING', `const expectedDatabaseIdentity=${JSON.stringify(databaseIdentity)}; // SYNTHETIC_ONLY`);
  }
  return code;
};
const clockFor = value => {
  const clock = { now: value };
  clock.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } };
  return clock;
};

function loadFixture(key) {
  const base = join(payload, 'hosts', key), host = join(base, 'host');
  const read = path => readFileSync(join(base, path), 'utf8');
  const cfg = JSON.parse(read('host/host-config.json'));
  const control = JSON.parse(read('host/control-base.template.json'));
  const binding = { status: 'REGISTERED_VERIFIED', candidate: copy(candidate), databaseIdentity: copy(databaseIdentity), build: copy(control.build), contextReadSha256: 'c'.repeat(64) };
  Object.assign(control, { candidate: copy(candidate), databaseIdentity: copy(databaseIdentity) });
  const files = {
    'host-config.json': JSON.stringify(cfg), 'control-base.json': JSON.stringify(control), 'activation.json': JSON.stringify(binding),
    'machine-json.js': read('host/machine-json.js'), 'host-helper-functions.js': read('host/host-helper-functions.js'),
    'host-stage-functions.js': read('host/host-stage-functions.js'), 'context-read.sql': '-- synthetic only', __contextReadSha256: binding.contextReadSha256
  };
  const proof = { build: copy(control.build), candidate: copy(candidate), contextReadSha256: binding.contextReadSha256 };
  return { key, base, host, read, cfg, control, binding, files, proof };
}

async function runLoader(f, mutate = () => {}, args = {}) {
  mutate(f);
  f.files['host-config.json'] = JSON.stringify(f.cfg);
  f.files['control-base.json'] = JSON.stringify(f.control);
  f.files['activation.json'] = JSON.stringify(f.binding);
  const calls = [], diagnostics = [], state = new Map([['other-source:sentinel', 'unchanged']]);
  const code = bindInMemory(f.read('host/runtime/load-host-state.js'), true);
  const promise = fragment(code, {
    tools: { exec_command: async input => {
      calls.push(input);
      if (calls.length === 1) { assert.match(input.cmd, /^python3 - /); return { exit_code: 0, output: JSON.stringify(f.files) }; }
      assert.equal(calls.length, 2); assert.match(input.cmd, /inspect-host-binding\.mts/);
      return { exit_code: 0, output: JSON.stringify(f.proof) };
    } }, store: (key, value) => state.set(key, value), notify: diagnostic => { assert.equal(diagnostic.phase, 'HOST_RUNTIME_MACHINE_JSON_DIAGNOSTIC'); assert.deepEqual(Array.from(diagnostic.recognizedWarningLines), []); assert.equal(diagnostic.rawOutput, JSON.stringify(f.proof)); diagnostics.push(diagnostic); }
  }, ['root', 'sourceId', 'candidateId', 'commit'], [args.root ?? f.cfg.root, args.sourceId ?? (f.key === 'hansoh' ? 'source-hansoh-social' : 'source-fosun-pharma-social'), args.candidateId ?? candidate.id, args.commit ?? commit]);
  return { promise, calls, state, diagnostics };
}

async function runStarter(f, options = {}) {
  const ns = `proxyNode22:${f.key}:`, clock = clockFor(Date.parse('2026-10-07T21:00:00.000Z'));
  const batch = 'synthetic-boundary-' + f.key, files = new Map(), state = new Map(), sql = [], commands = [], monitorCalls = [];
  const cfg = copy(f.cfg), binding = copy(f.binding);
  if (options.sourceId) cfg.sourceId = options.sourceId;
  if (options.candidateId) binding.candidate.id = options.candidateId;
  const observedFrom = new Date(clock.now - 43_200_100).toISOString(), observedTo = new Date(clock.now - 43_200_000).toISOString();
  const source = { sourceId: cfg.sourceId, sourceConfigHash: cfg.sourceConfigSha256, sourceResultId: 'synthetic-result', batchId: 'synthetic-previous-batch', releaseCandidateId: candidate.id, startedAt: observedFrom, finishedAt: observedTo };
  source.observations = [{ id: 'synthetic-observation', sourceResultId: source.sourceResultId, sourceId: source.sourceId, batchId: source.batchId, releaseCandidateId: source.releaseCandidateId, sourceConfigSha256: source.sourceConfigHash, crawledAt: observedTo, observedFrom, observedTo, successful: true, transportSucceeded: true, adapterSucceeded: true, completenessVerified: true, atomicCommitSucceeded: true }];
  const row = { checkedAt: new Date(clock.now).toISOString(), candidateRows: [{ ...candidate, commitSha: commit }], holderId: '', latestSuccessfulSource: source };
  const code = bindInMemory(f.read(`supervision/start-monitor-${f.key}51-combined.js`));
  const pinMatch = code.match(/combinedHashes\.output\.trim\(\)!==("(?:\\.|[^"\\])*")/);
  assert.ok(pinMatch, 'starter must compare exact combined file hashes');
  const pinnedHashes = JSON.parse(pinMatch[1]);
  const helper = {
    cfg, q: quote, rows: raw => raw, machineJson: JSON.parse,
    save: async (path, value) => { files.set(path, value); },
    readFile: async path => { assert.ok(files.has(path)); return { hash: sha(JSON.stringify(files.get(path))) }; },
    cmd: async command => { commands.push({ kind: 'preflight', command }); return { synthetic: true }; }
  };
  state.set(ns + 'cloudPilotHostHelpers', 'return globalThis.__helpers;');
  state.set(ns + 'registeredCandidateBinding', binding);
  state.set(ns + 'nextBatchId', batch);
  state.set(ns + 'durableMonitorInvocationMode', 'stale-mode-must-be-replaced');
  state.set(ns + 'continuousPortableRelayCodeWithPoll', 'return globalThis.__monitor();');
  const globals = {
    Date: clock.Date, __helpers: helper,
    __monitor: () => { monitorCalls.push({ mode: state.get(ns + 'durableMonitorInvocationMode'), session: state.get(ns + 'refreshSession') }); },
    load: key => { assert.ok(key.startsWith(ns), 'starter must load only its source namespace'); assert.ok(state.has(key), 'unexpected dependency ' + key); return state.get(key); },
    store: (key, value) => { assert.ok(key.startsWith(ns), 'starter must store only its source namespace'); state.set(key, value); }, notify: () => {},
    tools: {
      mcp__codex_apps__supabase_execute_sql: async args => { sql.push(args); return [row]; },
      exec_command: async args => {
        commands.push({ kind: 'exec', ...args });
        if (args.cmd.startsWith('sha256sum -- ')) return { exit_code: 0, output: pinnedHashes };
        if (args.cmd.includes('inspect-launch-identity.mjs')) return { exit_code: 0, output: JSON.stringify({ cwd: cfg.repo, cwdRealPath: cfg.repo, wrapperPath: cfg.repo + '/scripts/run-with-http-diagnostics.mjs', wrapperRealPath: cfg.repo + '/scripts/run-with-http-diagnostics.mjs', nodePath: cfg.node, nodeRealPath: cfg.node, controlRunId: 'jb-' + sha(batch) }) };
        assert.match(args.cmd, /capture_root_pid=\$!/);
        assert.match(args.cmd, new RegExp('/hosts/' + f.key + '/supervision/supervise-cancel\\.mjs'));
        assert.equal(args.workdir, cfg.repo);
        return options.noSession ? { exit_code: 17, output: 'synthetic immediate failure' } : { session_id: 4242, output: 'synthetic session' };
      }
    }
  };
  return { promise: fragment(code, globals), state, files, sql, commands, monitorCalls, ns };
}

// This fake OS is intentionally in-memory. No exported fs mutation or child
// process function is provided to the VM, and no supervisor CLI is executed.
function runSupervisor(f, options = {}) {
  const original = f.read('supervision/supervise-cancel.mjs');
  const imports = original.match(/^import [\s\S]*?;\n/gm);
  assert.equal(imports?.length, 5, 'review new imports before providing dependencies');
  const source = original.replace(/^import [\s\S]*?;\n/gm, '');
  const controlRoot = '/synthetic/control', diagnostics = '/synthetic/diagnostics', node = '/synthetic/node';
  const wrapper = runtime + '/producer/scripts/run-with-http-diagnostics.mjs';
  const pin = original.match(/const wrapperSha256 = '([a-f0-9]{64})'/)?.[1];
  assert.ok(pin);
  const clock = clockFor(2_000_000), uid = 1200, runId = 'jb-' + '1'.repeat(64), childPid = 321, supervisorPid = 123;
  const entries = new Map(), fds = new Map(), handlers = new Map(), signals = [], spawns = [], flags = [], stdout = [];
  let nextFd = 10, nextInode = 100, interval, closed = false;
  const makeEntry = (data, directory = false, extra = {}) => ({ data: Buffer.from(data), directory, uid, mode: directory ? 0o700 : 0o600, nlink: 1, dev: 9, ino: nextInode++, symlink: false, ...extra });
  const err = code => Object.assign(Error(code), { code });
  const entryPath = value => {
    const match = String(value).match(/^\/proc\/self\/fd\/(\d+)\/(.+)$/);
    if (match) { assert.equal(fds.get(Number(match[1]))?.path, controlRoot); return controlRoot + '/' + match[2]; }
    return String(value);
  };
  const stat = entry => ({ ...entry, size: entry.data.length, isDirectory: () => entry.directory && !entry.symlink, isFile: () => !entry.directory && !entry.symlink });
  if (options.mode === 'request') entries.set(controlRoot, makeEntry('', true));
  const child = { pid: childPid, exitCode: null, signalCode: null, once: (event, callback) => handlers.set(event, callback), kill: signal => { signals.push(signal); return true; } };
  const processStub = {
    argv: options.mode === 'request' ? ['node', 'supervisor', 'request', controlRoot, runId, ...(options.requestExtra ?? [])] : ['node', 'supervisor', 'start', controlRoot, runId, '--', node, wrapper, diagnostics, '1800000', '--', '/synthetic/inner'],
    pid: supervisorPid, execPath: node, env: { SYNTHETIC: '1' }, getuid: () => uid
  };
  const globals = {
    F, O, Buffer, dirname, join, resolve, process: processStub, Date: clock.Date,
    console: { log: value => stdout.push(value) },
    createHash: algorithm => { assert.equal(algorithm, 'sha256'); return { update: bytes => { assert.equal(bytes.toString(), 'synthetic-wrapper'); return { digest: encoding => { assert.equal(encoding, 'hex'); return pin; } }; } }; },
    randomBytes: count => Buffer.alloc(count, 0xab),
    spawn: (command, args, opts) => { spawns.push({ command, args, opts }); return child; },
    setInterval: callback => { interval = callback; return 77; }, clearInterval: () => { interval = undefined; },
    realpathSync: path => options.symlinkParent && path === dirname(controlRoot) ? '/synthetic/different-parent' : String(path),
    mkdirSync: (path, opts) => { assert.equal(path, controlRoot); assert.equal(opts.mode, 0o700); if (entries.has(path)) throw err('EEXIST'); entries.set(path, makeEntry('', true, options.rootStat ?? {})); },
    openSync: (path, openFlags, mode) => {
      path = entryPath(path); flags.push({ path, flags: openFlags, mode });
      let entry = entries.get(path);
      if (entry?.symlink && openFlags & F.O_NOFOLLOW) throw err('ELOOP');
      if (openFlags & F.O_CREAT) { if (entry && openFlags & F.O_EXCL) throw err('EEXIST'); if (!entry) { entry = makeEntry('', false, { mode }); entries.set(path, entry); } }
      if (!entry) throw err('ENOENT');
      if (openFlags & F.O_DIRECTORY && !entry.directory) throw err('ENOTDIR');
      const fd = nextFd++; fds.set(fd, { path, entry }); return fd;
    },
    fstatSync: fd => stat(fds.get(fd).entry),
    lstatSync: path => { const entry = entries.get(path); if (!entry) throw err('ENOENT'); return stat(entry); },
    closeSync: fd => { assert.ok(fds.has(fd)); fds.delete(fd); }, fsyncSync: fd => { assert.ok(fds.has(fd)); },
    readFileSync: (path, encoding) => {
      if (typeof path === 'number') { assert.ok(fds.has(path)); return fds.get(path).entry.data.toString(encoding); }
      path = entryPath(path);
      if (path === wrapper) return Buffer.from('synthetic-wrapper');
      if (path === `/proc/${childPid}/stat`) { const fields = Array(20).fill('0'); fields[1] = String(options.changedParent ? 999 : supervisorPid); fields[19] = options.changedStartTicks && interval ? 'different' : '1000'; return childPid + ' (synthetic child) ' + fields.join(' '); }
      if (path === diagnostics + '/process.jsonl') return JSON.stringify({ event: 'CHILD_STARTED', wrapperPid: options.wrapperNotReady ? 999 : childPid });
      const entry = entries.get(path); if (!entry) throw err('ENOENT'); return encoding ? entry.data.toString(encoding) : entry.data;
    },
    writeSync: (fd, data, offset, length) => {
      if (fd === 2) return Buffer.byteLength(data);
      const entry = fds.get(fd)?.entry; assert.ok(entry);
      const bytes = typeof data === 'string' ? Buffer.from(data) : data.subarray(offset, offset + length);
      entry.data = Buffer.concat([entry.data, bytes]); return bytes.length;
    },
    linkSync: (from, to) => { from = entryPath(from); to = entryPath(to); if (entries.has(to)) throw err('EEXIST'); assert.ok(entries.has(from)); const entry = entries.get(from); entry.nlink++; entries.set(to, entry); },
    unlinkSync: path => { path = entryPath(path); const entry = entries.get(path); if (!entry) throw err('ENOENT'); entry.nlink--; entries.delete(path); }
  };
  const put = (name, value, extra = {}) => entries.set(controlRoot + '/' + name, makeEntry(JSON.stringify(value), false, extra));
  if (options.mode === 'request') put('descriptor.json', { schemaVersion: 1, runId, nonce: 'ab'.repeat(32), startedAtMs: clock.now, ...options.descriptor }, options.descriptorStat);
  if (options.existingRoot) entries.set(controlRoot, makeEntry('', true));
  const invoke = () => vm.runInNewContext(source, globals, { filename: 'synthetic-supervisor-' + f.key + '.js', timeout: 1000 });
  const start = () => { invoke(); handlers.get('spawn')?.(); };
  const get = name => JSON.parse(entries.get(controlRoot + '/' + name).data.toString());
  const events = () => (entries.get(controlRoot + '/supervisor.jsonl')?.data.toString().trim() ?? '').split('\n').filter(Boolean).map(JSON.parse);
  const cancel = (change = {}, extra = {}) => { const d = get('descriptor.json'); put('cancel.json', { schemaVersion: 1, runId, nonce: d.nonce, action: 'SIGTERM', requestedAtMs: clock.now, ...change }, extra); };
  const tick = () => { assert.ok(interval, 'supervisor must be polling'); interval(); };
  return { invoke, start, get, events, cancel, tick, entries, fds, flags, signals, spawns, stdout, child, handlers, clock, controlRoot, runId, put };
}

for (const key of ['hansoh', 'fosun']) {
  const sourceId = key === 'hansoh' ? 'source-hansoh-social' : 'source-fosun-pharma-social';
  test(`${key}: actual payload stays unbound and uses the production destination`, async () => {
    const f = loadFixture(key);
    assert.equal(f.cfg.root, join(runtime, 'hosts', key, 'host')); assert.equal(f.cfg.sourceId, sourceId);
    assert.equal(f.control.build.commitSha, commit);
    for (const name of ['activation.json', 'control-base.json', 'context-read.sql']) assert.equal(existsSync(join(f.host, name)), false, name + ' must not be bound');
    assert.equal(f.read('host/runtime/load-host-state.js'), f.read('host/runtime/load-host-state.unbound.template.js'));
    assert.equal(f.read(`supervision/start-monitor-${key}51-combined.js`), f.read(`supervision/start-monitor-${key}51-combined.unbound.template.js`));
    let calls = 0; const forbidden = () => { calls++; throw Error('SIDE_EFFECT_FORBIDDEN'); };
    const globals = { tools: new Proxy({}, { get: () => forbidden }), load: forbidden, store: forbidden, notify: forbidden };
    await assert.rejects(fragment(f.read('host/runtime/load-host-state.js'), globals, ['root', 'sourceId', 'candidateId', 'commit'], [f.cfg.root, sourceId, candidate.id, commit]), /HOST_OWNER_BINDING_REQUIRED/);
    await assert.rejects(fragment(f.read(`supervision/start-monitor-${key}51-combined.js`), globals), /HOST_OWNER_BINDING_REQUIRED/);
    assert.equal(calls, 0);
  });
  test(`${key}: valid synthetic loader binds only its namespace`, async () => {
    const f = loadFixture(key), r = await runLoader(f); const value = await r.promise;
    assert.equal(value.sourceId, sourceId); assert.equal(r.calls.length, 2); assert.equal(r.diagnostics.length, 1); assert.equal(r.state.get('other-source:sentinel'), 'unchanged');
    assert.equal([...r.state.keys()].filter(k => k.startsWith(`proxyNode22:${key}:`)).length, 5);
  });
  const loaderRejects = [
    ['wrong-candidate-argument', () => {}, { candidateId: 'synthetic-wrong-candidate' }, /HOST_CANDIDATE_ID_MISMATCH/, 0],
    ['cross-source-argument', () => {}, { sourceId: 'source-other-social' }, /HOST_LOAD_ARGUMENT/, 0],
    ['wrong-candidate-id', f => { f.binding.candidate.id = 'synthetic-wrong-candidate'; }, {}, /CANDIDATE_NOT_REGISTERED/, 1],
    ['wrong-candidate-version', f => { f.binding.candidate.version = 50; }, {}, /CANDIDATE_NOT_REGISTERED/, 1],
    ['wrong-candidate-goal', f => { f.control.candidate.goalId = 'synthetic-wrong-goal'; }, {}, /HOST_CANDIDATE_IDENTITY_MISMATCH/, 1],
    ['wrong-config-hash', f => { f.cfg.sourceConfigSha256 = '0'.repeat(64); }, {}, /HOST_LOAD_BINDING_MISMATCH/, 1],
    ['cross-source-config', f => { f.cfg.sourceId = 'source-other-social'; }, {}, /HOST_LOAD_BINDING_MISMATCH/, 1],
    ['cross-source-helper', f => { f.files['host-helper-functions.js'] = f.files['host-helper-functions.js'].replaceAll(sourceId, 'source-other-social'); }, {}, /HOST_LOAD_HELPER_SCOPE_MISMATCH/, 1],
    ['cross-source-stage', f => { f.files['host-stage-functions.js'] = f.files['host-stage-functions.js'].replaceAll(sourceId, 'source-other-social'); }, {}, /HOST_LOAD_HELPER_SCOPE_MISMATCH/, 1],
    ['wrong-runtime-proof', f => { f.proof.candidate.version = 50; }, {}, /HOST_CONTEXT_COMPILER_BINDING_MISMATCH/, 2]
  ];
  for (const [name, mutate, args, error, calls] of loaderRejects) test(`${key}: synthetic loader rejects ${name} before storing state`, async () => {
    const r = await runLoader(loadFixture(key), mutate, args); await assert.rejects(r.promise, error); assert.equal(r.calls.length, calls); assert.equal(r.state.size, 1);
  });
  test(`${key}: whole starter explicitly selects start mode before monitor invocation`, async () => {
    const r = await runStarter(loadFixture(key)); await r.promise;
    assert.deepEqual(r.monitorCalls, [{ mode: 'start', session: 4242 }]);
    assert.equal(r.sql.length, 1); assert.equal(r.commands.length, 4); assert.equal(r.state.get(r.ns + 'durableMonitorInvocationMode'), 'start');
    assert.ok([...r.files.keys()].some(p => p.endsWith('/original-launch-exec-tool-result.json')));
  });
  test(`${key}: whole starter retains failed synthetic launch and never invokes monitor`, async () => {
    const r = await runStarter(loadFixture(key), { noSession: true }); await assert.rejects(r.promise, /NO_RUNNING_LAUNCH_SESSION/);
    assert.equal(r.monitorCalls.length, 0); assert.equal(r.state.get(r.ns + 'refreshLaunchToolResult').exit_code, 17);
  });
  for (const [name, options, error] of [['cross-source', { sourceId: 'source-other-social' }, /SOURCE_SCOPE/], ['wrong-candidate', { candidateId: 'synthetic-wrong-candidate' }, /CANDIDATE_NOT_REGISTERED/]]) test(`${key}: whole starter rejects ${name} before synthetic DB or command`, async () => {
    const r = await runStarter(loadFixture(key), options); await assert.rejects(r.promise, error); assert.equal(r.sql.length, 0); assert.equal(r.commands.length, 0); assert.equal(r.monitorCalls.length, 0);
  });
  for (const [name, options, error] of [['symlink-parent', { symlinkParent: true }, /SYMLINK_PARENT_REFUSED/], ['existing-control-directory', { existingRoot: true }, /EEXIST/], ['unsafe-directory-mode', { rootStat: { mode: 0o755 } }, /UNSAFE_CONTROL_DIRECTORY/], ['foreign-directory-owner', { rootStat: { uid: 999 } }, /UNSAFE_CONTROL_DIRECTORY/], ['symlink-control-directory', { rootStat: { symlink: true } }, /ELOOP/]]) test(`${key}: control refuses ${name} before synthetic spawn`, () => {
    const r = runSupervisor(loadFixture(key), options); assert.throws(r.invoke, error); assert.equal(r.spawns.length, 0); assert.equal(r.signals.length, 0);
  });
  test(`${key}: request protocol writes a nonce-bound request without a signal`, () => {
    const r = runSupervisor(loadFixture(key), { mode: 'request' }); r.invoke();
    assert.deepEqual(r.get('cancel.json'), { schemaVersion: 1, runId: r.runId, nonce: 'ab'.repeat(32), action: 'SIGTERM', requestedAtMs: r.clock.now });
    assert.equal(r.spawns.length, 0); assert.equal(r.signals.length, 0); assert.deepEqual(r.stdout, ['CANCEL_REQUEST_WRITTEN']);
    assert.ok(r.flags.filter(x => x.path.endsWith('descriptor.json')).every(x => (x.flags & F.O_NOFOLLOW) && (x.flags & F.O_NONBLOCK)));
  });
  for (const [name, options, error] of [['foreign-run', { descriptor: { runId: 'wrong-run' } }, /DESCRIPTOR_MISMATCH/], ['malformed-nonce', { descriptor: { nonce: 'bad' } }, /DESCRIPTOR_MISMATCH/], ['command-or-pid', { requestExtra: ['999'] }, /REQUEST_TAKES_NO_COMMAND_OR_PID/], ['symlink-descriptor', { descriptorStat: { symlink: true } }, /ELOOP/], ['multiply-linked-descriptor', { descriptorStat: { nlink: 2 } }, /UNSAFE_CONTROL_FILE/]]) test(`${key}: request refuses ${name}`, () => {
    const r = runSupervisor(loadFixture(key), { mode: 'request', ...options }); assert.throws(r.invoke, error); assert.equal(r.entries.has(r.controlRoot + '/cancel.json'), false); assert.equal(r.spawns.length, 0);
  });
  const rejects = [
    ['wrong-nonce', r => r.cancel({ nonce: '0'.repeat(64) }), 'CANCEL_NONCE_MISMATCH'],
    ['wrong-run', r => r.cancel({ runId: 'wrong-run' }), 'CANCEL_RUN_MISMATCH'],
    ['extra-field', r => r.cancel({ pid: 999 }), 'CANCEL_SCHEMA_MISMATCH'],
    ['expired-60001ms', r => { const started = r.clock.now; r.clock.now += 60_001; r.cancel({ requestedAtMs: started }); }, 'CANCEL_TIME_MISMATCH'],
    ['future-request', r => r.cancel({ requestedAtMs: r.clock.now + 1 }), 'CANCEL_TIME_MISMATCH'],
    ['before-supervisor-start', r => r.cancel({ requestedAtMs: r.clock.now - 1 }), 'CANCEL_TIME_MISMATCH'],
    ['replaced-directory-inode', r => { r.cancel(); r.entries.get(r.controlRoot).ino++; }, 'CONTROL_DIRECTORY_REPLACED'],
    ['replaced-directory-device', r => { r.cancel(); r.entries.get(r.controlRoot).dev++; }, 'CONTROL_DIRECTORY_REPLACED'],
    ['symlink-cancel-file', r => r.cancel({}, { symlink: true }), 'ELOOP'],
    ['multiply-linked-cancel-file', r => r.cancel({}, { nlink: 2 }), 'UNSAFE_CONTROL_FILE'],
    ['unsafe-cancel-file-mode', r => r.cancel({}, { mode: 0o644 }), 'UNSAFE_CONTROL_FILE']
  ];
  for (const [name, setup, reason] of rejects) test(`${key}: live control rejects ${name} without signal`, () => {
    const r = runSupervisor(loadFixture(key)); r.start(); setup(r); r.tick(); assert.equal(r.signals.length, 0);
    assert.equal(r.events().at(-1).event, 'CANCEL_REJECTED'); assert.equal(r.events().at(-1).reason, reason);
  });
  test(`${key}: 60000ms nonce-valid control is accepted once and signals only its own child`, () => {
    const r = runSupervisor(loadFixture(key)); r.start(); const started = r.clock.now; r.clock.now += 60_000; r.cancel({ requestedAtMs: started }); r.tick(); r.tick();
    assert.deepEqual(r.signals, ['SIGTERM']); assert.equal(r.spawns.length, 1); assert.equal(r.events().filter(e => e.event === 'CANCEL_ACCEPTED').length, 1);
    assert.ok(r.flags.find(x => x.path === r.controlRoot).flags & F.O_NOFOLLOW);
  });
  test(`${key}: changed wrapper start ticks fail before signal`, () => {
    const r = runSupervisor(loadFixture(key), { changedStartTicks: true }); r.start(); r.cancel(); r.tick(); assert.equal(r.signals.length, 0); assert.equal(r.events().at(-1).reason, 'WRAPPER_IDENTITY_CHANGED');
  });
  test(`${key}: control waits for unchanged wrapper readiness`, () => {
    const r = runSupervisor(loadFixture(key), { wrapperNotReady: true }); r.start(); r.cancel(); r.tick(); assert.equal(r.signals.length, 0); assert.equal(r.events().at(-1).event, 'SUPERVISOR_READY');
  });
}
