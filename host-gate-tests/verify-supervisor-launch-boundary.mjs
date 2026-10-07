// Synthetic regression: actual supervisor/wrapper plus an exit42-only inner Node;
// separate negative tests intercept the final spawn boundary.
// No source HTTP, database, registration, producer execution, or real capture occurs.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const N = resolve(import.meta.dirname, '..');
const R = resolve(N, '../..');
const testRoot = join(N, 'host-gate-tests');
const output = mkdtempSync(join(testRoot, 'synthetic-launch-boundary-'));
const host = join(N, 'hosts/kelun/host');
const supervision = join(N, 'hosts/kelun/supervision');
const node = join(R, 'runtime/node-v22.23.3-linux-x64/bin/node');
const supervisor = join(supervision, 'supervise-cancel.mjs');
const starterPath = process.env.KELUN_TEST_PREPARED === '1' ? join(N, 'host-prepared-C55-0907Z/supervision/start-monitor-kelun-next-combined.js') : join(supervision, 'start-monitor-kelun-next-combined.unbound.template.js');
const newWrapper = join(N, 'producer/scripts/run-with-http-diagnostics.mjs');
const oldWrapper = join(R, 'producer/scripts/run-with-http-diagnostics.mjs');
const expectedWrapperHash = 'f15522e6f209bfe99bfa258b5dffbce1f74d6af662c4c2ee682604e0798bbc88';
const sha = value => createHash('sha256').update(value).digest('hex');
const q = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const results = [];
const dependencies = [join(supervision, 'sample_process_tree.py'), supervisor, newWrapper, join(supervision, 'inspect-launch-identity.mjs')];
const pins = [...dependencies, starterPath, oldWrapper, node].map(path => ({ path, sha256: sha(readFileSync(path)) }));
const initialPins = new Map(pins.map(x => [x.path, x.sha256]));
assert.equal(initialPins.get(newWrapper), expectedWrapperHash);
assert.equal(initialPins.get(oldWrapper), expectedWrapperHash);
write(join(output, 'pins-before.json'), pins);

const instrumentation = join(output, 'intercept-final-spawn.mjs');
writeFileSync(instrumentation, `// Test-only --import hook. Never forwards spawn to an OS process.
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const audit = record => fs.appendFileSync(process.env.SYNTHETIC_BOUNDARY_AUDIT, JSON.stringify(record) + '\\n');
if (process.env.SYNTHETIC_WRAPPER_HASH_MISMATCH === '1') {
  const originalRead = fs.readFileSync;
  fs.readFileSync = function(path, ...args) {
    const result = originalRead.call(this, path, ...args);
    if (path === process.env.SYNTHETIC_EXPECTED_WRAPPER) {
      audit({event:'NARROW_HASH_READ_OVERRIDE', path, fileBytesUnmodified:true});
      if (!Buffer.isBuffer(result)) throw Error('HASH_OVERRIDE_EXPECTED_BUFFER');
      return Buffer.concat([result, Buffer.from('\\n// Synthetic hash mismatch; disk unchanged.\\n')]);
    }
    return result;
  };
}
childProcess.spawn = function(command, argv, options) {
  audit({event:'CONTROLLED_FINAL_SPAWN_BOUNDARY', command, argv, options:{shell:options.shell,stdio:options.stdio,detached:options.detached,environmentPassedUnchanged:options.env===process.env}, actualProducerStarted:false});
  if (command !== process.execPath || argv[0] !== process.env.SYNTHETIC_EXPECTED_WRAPPER || options.shell !== false || options.stdio !== 'inherit' || options.detached !== false || options.env !== process.env) throw Error('UNEXPECTED_FINAL_SPAWN');
  const child = new EventEmitter();
  child.pid = undefined; child.exitCode = null; child.signalCode = null;
  child.kill = () => { throw Error('SYNTHETIC_SIGNAL_FORBIDDEN'); };
  // Deliberately no spawn event: this proves only argument/hash admission and
  // the spawn-call boundary, never /proc child identity or supervisor readiness.
  setImmediate(() => { child.exitCode = 0; child.emit('close', 0, null); });
  return child;
};
syncBuiltinESMExports();
`);

function supervisorCase(name, wrapper, admitted, mismatch = false) {
  const directory = join(output, name);
  mkdirSync(directory);
  const auditPath = join(directory, 'instrumentation.jsonl');
  const args = ['--import', instrumentation, supervisor, 'start', join(directory, 'control'), 'synthetic-' + name, '--', node, wrapper, join(directory, 'diagnostics'), '500', '--', node, '-e', 'throw Error("PRODUCER_MUST_NEVER_RUN")'];
  const command = [node, ...args].map(q).join(' ');
  writeFileSync(join(directory, 'command.txt'), command + '\n');
  const child = spawnSync(node, args, { cwd: join(N, 'producer'), encoding: 'utf8', maxBuffer: 2e6, timeout: 10000, env: { ...process.env, TSX_DISABLE_CACHE: '1', NODE_DISABLE_COMPILE_CACHE: '1', SYNTHETIC_BOUNDARY_AUDIT: auditPath, SYNTHETIC_EXPECTED_WRAPPER: newWrapper, SYNTHETIC_WRAPPER_HASH_MISMATCH: mismatch ? '1' : '0' } });
  writeFileSync(join(directory, 'stdout.txt'), child.stdout ?? '');
  writeFileSync(join(directory, 'stderr.txt'), child.stderr ?? '');
  write(join(directory, 'process-result.json'), {command, executable:node, argv:args, cwd:join(N, 'producer'), exitCode:child.status, signal:child.signal, error:child.error?.message ?? null, stdout:child.stdout, stderr:child.stderr});
  assert.ifError(child.error);
  const events = existsSync(auditPath) ? readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const spawns = events.filter(event => event.event === 'CONTROLLED_FINAL_SPAWN_BOUNDARY');
  if (admitted) {
    assert.equal(child.status, 0, child.stderr);
    assert.equal(spawns.length, 1);
    assert.deepEqual(spawns[0].argv, args.slice(args.indexOf('--') + 2));
    assert.equal(existsSync(join(directory, 'control/descriptor.json')), false);
    assert.equal(JSON.parse(readFileSync(join(directory, 'control/terminal.json'), 'utf8')).supervisorExitCode, 0);
  } else {
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /ORIGINAL_WRAPPER_COMMAND_REQUIRED/);
    assert.equal(spawns.length, 0);
    assert.equal(existsSync(join(directory, 'control/terminal.json')), false);
  }
  assert.equal(events.filter(event => event.event === 'NARROW_HASH_READ_OVERRIDE').length, mismatch ? 1 : 0);
  results.push({ name, passed: true, actualPinnedNodeSupervisor: true, finalSpawnCalls: spawns.length, producerStarted: false, evidence: directory });
  return child;
}

const terminalSupervisor = supervisorCase('old-wrapper-rejected', oldWrapper, false);
supervisorCase('new-wrapper-admitted', newWrapper, true);
supervisorCase('wrong-wrapper-path-rejected', join(N, 'producer/scripts/not-authorized-wrapper.mjs'), false);
supervisorCase('wrong-wrapper-hash-rejected', newWrapper, false, true);

// Exercise the real final spawn, unmodified wrapper, /proc identity and terminal paths.
{
  const directory=join(output,'actual-wrapper-pure-inner-exit42');mkdirSync(directory);
  const fixture=join(directory,'pure-synthetic-child.mjs');
  writeFileSync(fixture,"globalThis.fetch=()=>{throw Error('SYNTHETIC_NETWORK_FORBIDDEN')};\nconsole.log('KELUN_SUPERVISOR_SYNTHETIC_CHILD_EXIT42');\nprocess.exitCode=42;\n");
  const args=[supervisor,'start',join(directory,'control'),'synthetic-real-wrapper-exit42','--',node,newWrapper,join(directory,'diagnostics'),'10000','--',node,fixture];
  const child=spawnSync(node,args,{cwd:join(N,'producer'),encoding:'utf8',maxBuffer:2e6,timeout:20000,env:process.env});
  write(join(directory,'process-result.json'),{command:[node,...args].map(q).join(' '),argv:args,cwd:join(N,'producer'),exitCode:child.status,signal:child.signal,error:child.error?.message??null,stdout:child.stdout,stderr:child.stderr});
  assert.ifError(child.error);assert.equal(child.status,42,child.stderr);
  const terminal=JSON.parse(readFileSync(join(directory,'control/terminal.json'),'utf8'));
  assert.equal(terminal.supervisorExitCode,42);assert.equal(terminal.code,42);assert.equal(terminal.signal,null);
  const events=readFileSync(join(directory,'diagnostics/process.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.at(-1).event,'CHILD_EXIT');assert.equal(events.at(-1).exitCode,42);assert.equal(events.at(-1).wrapperExitCode,42);
  const audit=readFileSync(join(directory,'control/supervisor.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert(audit.some(e=>e.event==='SUPERVISOR_READY'));assert.equal(readFileSync(join(directory,'diagnostics/stdout.log'),'utf8'),'KELUN_SUPERVISOR_SYNTHETIC_CHILD_EXIT42\n');
  results.push({name:'actual-supervisor-wrapper-pure-inner-exit42',passed:true,actualSpawn:true,actualWrapper:true,actualChildIdentityAndReadiness:true,innerExit:42,wrapperExit:42,supervisorExit:42,sourceEntryInvoked:false,evidence:directory});
}

const cfg = JSON.parse(readFileSync(join(host, 'host-config.json'), 'utf8'));
const starterBytes = readFileSync(starterPath, 'utf8');
const unboundMarker='const expectedCandidate=null; // OWNER_CANDIDATE_BINDING';
const candidatePattern=/const expectedCandidate=(\{[^\n]+?\}); \/\/ OWNER_CANDIDATE_BINDING/;
const fixtureSource=process.env.KELUN_LAUNCH_TEST_UNBOUND==='1'
  ?starterBytes.replace(candidatePattern,unboundMarker):starterBytes;
const candidateMatch=fixtureSource.match(candidatePattern);
const candidate=candidateMatch?JSON.parse(candidateMatch[1]):{id:'synthetic-only-restored-launch-boundary',goalId:'jobfinder-portable-required-40',version:54};
if(!candidateMatch)assert.equal(fixtureSource.split(unboundMarker).length,2,'Exactly one unbound candidate marker required');
const starter=candidateMatch?fixtureSource:fixtureSource.replace(unboundMarker,'const expectedCandidate='+JSON.stringify(candidate)+'; // OWNER_CANDIDATE_BINDING');
const starterBindingMode=candidateMatch?'ACTUAL_REGISTERED_CANDIDATE':'IN_MEMORY_SYNTHETIC_CANDIDATE_FROM_UNBOUND_TEMPLATE';
const binding = { status: 'REGISTERED_VERIFIED', candidate, build: JSON.parse(readFileSync(join(N, 'NEW_LOCAL_BUILD_IDENTITY.json'), 'utf8')) };
const parse = new Function('output', 'record', readFileSync(join(host, 'machine-json.js'), 'utf8'));
const A = Object.getPrototypeOf(async function(){}).constructor;
const ns = 'proxyNode22:kelunNext:';

function safeClone(value) {
  const rejectUndefined = (v, path = '$') => {
    assert.notEqual(v, undefined, 'UNDEFINED_SAFE_STORE_VALUE:' + path);
    if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) rejectUndefined(child, path + '.' + key);
  };
  rejectUndefined(value);
  return JSON.parse(JSON.stringify(value));
}

async function starterCase(name, started, expectSession) {
  const directory = join(output, name); mkdirSync(directory);
  const saves = new Map(), stores = new Map([[ns+"refreshSession",987654321]]), trace = [], execResults = [];
  let relayEntered = 0, attemptedLaunch = 0, mockDbCalls = 0;
  const now = Date.now(), observed = now - 13 * 3600000;
  const stamp = value => new Date(value).toISOString();
  const source = {sourceResultId:'synthetic-source-result', sourceId:cfg.sourceId, batchId:'synthetic-prior-batch', releaseCandidateId:'synthetic-prior-candidate', sourceConfigHash:cfg.sourceConfigSha256, startedAt:stamp(observed-1000), finishedAt:stamp(observed+1000)};
  source.observations = [{id:'synthetic-observation', sourceResultId:source.sourceResultId, sourceId:source.sourceId, batchId:source.batchId, releaseCandidateId:source.releaseCandidateId, sourceConfigSha256:source.sourceConfigHash, crawledAt:stamp(observed), observedFrom:source.startedAt, observedTo:source.finishedAt, successful:true, transportSucceeded:true, adapterSucceeded:true, completenessVerified:true, atomicCommitSucceeded:true}];
  const row = {checkedAt:stamp(now), holderId:'', candidateRows:[{...candidate, commitSha:binding.build.commitSha}], latestSuccessfulSource:source};
  globalThis.__boundaryTestHelpers = {
    cfg, q, rows:value=>value, machineJson:value=>parse(value, ()=>{}),
    save:async(path, value)=>{
      const full = safeClone(value);
      const artifact = join(directory, 'saved-' + String(saves.size + 1).padStart(2, '0') + '.json');
      write(artifact, {virtualHostPath:path, value:full});
      saves.set(path, {value:full, artifact}); trace.push({event:'SAVE', path, artifact, value:full});
    },
    readFile:async path=>{ const saved=saves.get(path); assert(saved); const text=typeof saved.value==='string'?saved.value:JSON.stringify(saved.value); return {hash:sha(text),text}; },
    cmd:async command=>{assert(command.includes('/runtime/preflight/preflight-launch.mjs')); trace.push({event:'SYNTHETIC_PREFLIGHT', command});return {syntheticPreflightOnly:true};}
  };
  globalThis.__boundaryRelay = () => {relayEntered++;trace.push({event:'SYNTHETIC_RELAY_ENTERED'});};
  globalThis.load = key => key===ns+'cloudPilotHostHelpers'?'return globalThis.__boundaryTestHelpers;':key===ns+'registeredCandidateBinding'?binding:key===ns+'nextBatchId'?'synthetic-launch-boundary-'+name:key===ns+'continuousPortableRelayCodeWithPoll'?'globalThis.__boundaryRelay();':stores.get(key);
  globalThis.store = (key, value) => {assert(key.startsWith(ns));const full=safeClone(value);stores.set(key,full);trace.push({event:'STORE',key,value:full});};
  globalThis.notify = value => trace.push({event:'NOTIFY',value});
  globalThis.text = () => {};
  globalThis.tools = {
    mcp__codex_apps__supabase_execute_sql:async args=>{mockDbCalls++;assert(args.query.startsWith('WITH latest_successful AS'));return [row];},
    exec_command:async args=>{
      if (args.cmd.startsWith('sha256sum -- ') || args.cmd.includes('/supervision/inspect-launch-identity.mjs')) {
        const isHash=args.cmd.startsWith('sha256sum -- ');
        if(isHash)assert.equal(args.cmd,'sha256sum -- '+dependencies.map(q).join(' '));
        const proc=spawnSync('/bin/bash',['-c',args.cmd],{cwd:args.workdir,encoding:'utf8',maxBuffer:2e6,timeout:15000,env:{...process.env,TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'}});
        execResults.push({phase:isHash?'ACTUAL_HASH_CHECK':'ACTUAL_IDENTITY_INSPECTOR',command:args.cmd,stdout:proc.stdout,stderr:proc.stderr,exitCode:proc.status,signal:proc.signal,error:proc.error?.message??null});
        assert.ifError(proc.error);assert.equal(proc.status,0,proc.stderr);
        return {exit_code:proc.status,output:proc.stdout+proc.stderr};
      }
      assert(args.cmd.includes('/supervision/supervise-cancel.mjs'));
      assert.equal(stores.get(ns+'refreshSession'),null,'STALE_SESSION_MUST_CLEAR_BEFORE_LAUNCH');
      attemptedLaunch++;trace.push({event:'SYNTHETIC_EXEC_RESULT',command:args.cmd,result:started});
      writeFileSync(join(directory,'launch-command-not-executed.txt'),args.cmd+'\n');
      return safeClone(started);
    }
  };
  let error=null;
  try { await new A(starter)(); } catch(e) { error=e.message;trace.push({event:'CAUGHT_ERROR',error}); }
  write(join(directory,'trace.json'),trace);
  write(join(directory,'actual-read-only-exec-results.json'),execResults);
  write(join(directory,'started-result.json'),started);
  write(join(directory,'outcome.json'),{error,relayEntered,attemptedLaunch,mockDbCalls,expectedSession:expectSession});
  assert.equal(attemptedLaunch,1);
  assert.equal(mockDbCalls,1);
  assert.equal(execResults.length,2);
  const fullSaves=trace.filter(x=>x.event==='SAVE'&&JSON.stringify(x.value)===JSON.stringify(started));
  assert.equal(fullSaves.length,1,'Full unmodified exec result must be persisted through h.save');
  assert.deepEqual(stores.get(ns+'refreshLaunchToolResult'),started,'Full exec result must also survive the safe store');
  const fullStoreIndex=trace.findIndex(x=>x.event==='STORE'&&x.key===ns+'refreshLaunchToolResult');
  const savedReadback=JSON.parse(readFileSync(fullSaves[0].artifact,'utf8'));
  assert.deepEqual(savedReadback.value,started);
  const resultIndex=trace.findIndex(x=>x===fullSaves[0]);
  if(expectSession){
    assert.equal(error,null);assert.equal(relayEntered,1);assert.equal(stores.get(ns+'refreshSession'),started.session_id);
    assert(resultIndex<trace.findIndex(x=>x.event==='SYNTHETIC_RELAY_ENTERED'));
    assert(fullStoreIndex<trace.findIndex(x=>x.event==='SYNTHETIC_RELAY_ENTERED'));
  }else{
    assert.equal(error,'NO_RUNNING_LAUNCH_SESSION');assert.equal(relayEntered,0);
    assert.equal(stores.has(ns+'refreshSession')&&stores.get(ns+'refreshSession')!==null,false);
    assert(resultIndex<trace.findIndex(x=>x.event==='CAUGHT_ERROR'));
    assert(fullStoreIndex<trace.findIndex(x=>x.event==='CAUGHT_ERROR'));
  }
  results.push({name,passed:true,starterBodyUnmodified:true,starterBindingMode,fullResultPersistedBeforeValidation:true,fullResultSafeStored:true,undefinedStoreRejected:true,staleSessionClearedBeforeLaunch:true,relayEntered,evidence:directory});
}

await starterCase('terminal-failure-no-session', {chunk_id:'synthetic-terminal-from-actual-supervisor-rejection',wall_time_seconds:0.01,exit_code:terminalSupervisor.status,original_token_count:157,output:terminalSupervisor.stdout+terminalSupervisor.stderr,extraEvidence:{retentionSentinel:'preserve-every-field',syntheticToolResult:true}}, false);
const actualToolTerminal=JSON.parse(readFileSync(join(testRoot,'fixtures/real-supervisor-exit42-exec-result.json'),'utf8'));
assert.equal(actualToolTerminal.exit_code,42);assert.equal(actualToolTerminal.session_id,undefined);
await starterCase('actual-tool-exit42-full-result',actualToolTerminal,false);
await starterCase('terminal-success-no-session', {chunk_id:'synthetic-terminal-success',wall_time_seconds:0.01,exit_code:0,output:'Synthetic already-terminal command; no running session\n',extraEvidence:{retentionSentinel:'preserve-terminal-zero'}}, false);
await starterCase('running-session-result', {chunk_id:'synthetic-running',wall_time_seconds:1.001,session_id:73194,original_token_count:9,output:'Synthetic running session, no real producer\n',extraEvidence:{retentionSentinel:'preserve-running-fields'}}, true);

for(const pin of pins)assert.equal(sha(readFileSync(pin.path)),pin.sha256,'Pinned file changed during regression: '+pin.path);
results.push({name:'all-runtime-and-producer-pins-unchanged',passed:true});
const report={starterBindingMode,classification:'SYNTHETIC_ACTUAL_SUPERVISOR_SPAWN_BOUNDARY_AND_STARTER_RESULT_REGRESSION',createdAt:new Date().toISOString(),output,noExternalHttp:true,noDatabase:true,noRegistration:true,noRealCapture:true,noProducerExecution:true,noPublisher:true,noProducerEdits:true,supervisorLimit:'Negative admission cases intercept spawn; the positive exit42 case executes actual supervisor, wrapper and pure synthetic Node with real readiness and terminal preservation. No cancellation or real source success claimed',starterLimit:'Actual starter/hash/identity code; synthetic DB/preflight/launch result/relay only; host saves redirected to local test evidence',narrowHashOverride:'Only readFileSync(exact N wrapper path) returns altered bytes in the wrong-hash child; disk bytes unchanged',pins,instrumentationSha256:sha(readFileSync(instrumentation)),testFileSha256:sha(readFileSync(import.meta.filename)),results};
write(join(output,'REPORT.json'),report);
console.log(JSON.stringify({passed:results.length,report:join(output,'REPORT.json'),supervisorSha256:initialPins.get(supervisor),starterSha256:initialPins.get(starterPath)}));
