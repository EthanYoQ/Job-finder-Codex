import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as wait} from 'node:timers/promises';
import {FilePilotRelay, PilotSqlFailure} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/src/crawler/cloudSourcePilotRelay.ts';
import {assertRelayRequestReady, readyRequestNames} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/ops/cloud-pilot-host/relay-request-ready.mjs';
import {createPostgresExecutor} from './postgres-executor.mjs';
import {createPostgresStage} from './postgres-stage.mjs';

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const original = new URL('../original-relay-automation-20261017T0609Z/', import.meta.url);
const {runOriginalSerial, serviceOriginalRelay} = await new AsyncFunction(await readFile(new URL('automatic-relay-functions.js', original), 'utf8'))();

async function setup(query) {
  const appRoot = await mkdtemp(join(tmpdir(), 'jobfinder-migration-new-'));
  const scope = {roundId: 'round-' + 'a'.repeat(32),
    candidateId: 'instabox-synthetic-new-migration', buildContentSha256: 'synthetic-new-build'};
  const directory = join(appRoot, 'rounds', scope.roundId, 'connector-host-task/relay');
  await mkdir(directory, {recursive: true});
  const calls = [], sourceId = 'source-ucb-china-social';
  const host = {
    cfg: {project: 'yiopvxysxrtrnvqxwgbx', sourceId, root: '/synthetic-host'}, q: value => value,
    binding: async () => ({...scope, relayDirectory: directory, sourceId, sourceConfigSha256: 'synthetic-config',
      repo: join(appRoot, 'five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source')}),
    next: async () => {
      const names = await readdir(directory);
      const name = readyRequestNames(names).find(name => !names.includes(name.replace('.request.json', '.response.json')));
      if (!name) return;
      const file = join(directory, name); assertRelayRequestReady(file);
      const request = JSON.parse(await readFile(file, 'utf8'));
      return {...request, dispatchRecorded: names.includes(request.requestId + '.dispatch.json')};
    },
    mark: async request => {
      calls.push('mark:' + request.kind);
      await writeFile(join(directory, request.requestId + '.dispatch.json'), 'MAY_HAVE_BEEN_SENT', {flag: 'wx'});
    },
    respond: async (request, dir, result) => {
      calls.push('respond:' + request.kind);
      await writeFile(join(dir, request.requestId + '.response.json'), JSON.stringify({schemaVersion: 1,
        requestId: request.requestId, requestSha256: request.requestSha256, kind: request.kind, result}), {flag: 'wx'});
    },
    cmd: async command => {
      const request = JSON.parse(await readFile(command.split(' ').at(-1), 'utf8'));
      return JSON.stringify({...request, ...scope, projectId: host.cfg.project,
        output: join(directory, request.requestId + '.sql'), sql: request.payload.sql});
    }
  };
  const executeSql = createPostgresExecutor(() => ({on() {}, async connect() {}, async end() {},
    async query(sql) { calls.push('query:' + sql); return query(sql); }}));
  const database = {target: 'INSTABOX_POSTGRESQL_V1', appRoot, executeSql};
  return {appRoot, directory, scope, database, calls, sourceId, host,
    stage: createPostgresStage({host, database, scope}), relay: new FilePilotRelay(directory)};
}

test('actual FilePilotRelay accepts pg success and failure envelopes; old queue and candidate are rejected', async () => {
  for (const fail of [false, true]) {
    const f = await setup(async () => { if (fail) throw Error('connection lost'); return {rows: [{value: 1}]}; });
    try {
      const response = f.relay.sql('READ_OUTCOME', 'SELECT synthetic', Date.now() + 60_000);
      const observed = response.then(rows => ({rows}), error => ({error}));
      let request; while (!(request = await f.host.next())) await wait(5);
      await assert.rejects(f.stage.handle(request, f.directory + '-old'), /MIGRATION_SCOPE_MISMATCH/);
      assert.throws(() => createPostgresStage({host: f.host, database: f.database,
        scope: {...f.scope, candidateId: 'old-candidate'}}), /MIGRATION_TARGET_REQUIRED/);
      const bad = createPostgresStage({host: f.host, database: f.database,
        scope: {...f.scope, candidateId: 'instabox-other-candidate'}});
      await assert.rejects(bad.handle(request, f.directory), /MIGRATION_SCOPE_MISMATCH/);
      assert.equal(f.calls.length, 0);
      await f.stage.handle(request, f.directory);
      const result = await observed;
      if (fail) {
        assert(result.error instanceof PilotSqlFailure);
        assert.equal(result.error.code, 'PG_QUERY_OUTCOME_UNKNOWN');
        assert.equal(result.error.outcome, 'UNKNOWN');
      } else assert.deepEqual(result.rows, [{value: 1}]);
      assert.deepEqual(f.calls, ['mark:READ_OUTCOME', 'query:SELECT synthetic', 'respond:READ_OUTCOME']);
      await assert.rejects(f.stage.handle({...request, dispatchRecorded: true}, f.directory), /UNCERTAIN/);
      assert.equal(f.calls.filter(call => call.startsWith('query:')).length, 1);
    } finally { await rm(f.appRoot, {recursive: true, force: true}); }
  }
});

test('original serial loop consumes real relay files; a lost publish result is never sent twice', async () => {
  const f = await setup(async sql => { if (sql === 'synthetic publish') throw Error('lost after commit'); return {rows: []}; });
  try {
    let terminal = false;
    const producer = (async () => {
      await f.relay.sql('READ_PUBLICATION_CONTEXT', 'synthetic context', Date.now() + 60_000);
      await assert.rejects(f.relay.sql('PUBLISH', 'synthetic publish', Date.now() + 200_000), PilotSqlFailure);
      await f.relay.sql('READ_OUTCOME', 'synthetic outcome', Date.now() + 60_000);
      terminal = true;
    })();
    let prepared = 0;
    const result = await runOriginalSerial([f.sourceId, 'must-not-start'], async () => {
      prepared++;
      return {sourceId: f.sourceId, stage: f.stage, relayDirectory: f.directory, deadline: Date.now() + 30_000,
        reviewPublication: async request => {f.calls.push('original-review-callback'); return request;},
        pollProducer: async () => ({exitCode: terminal ? 1 : null}),
        readback: async () => {throw Error('unknown cannot become public success');}};
    });
    await producer;
    assert.equal(prepared, 1);
    assert.equal(result[0].reason, 'UNKNOWN_PUBLICATION');
    assert.equal(f.calls.filter(call => call === 'query:synthetic publish').length, 1);
    assert(f.calls.indexOf('original-review-callback') < f.calls.indexOf('query:synthetic publish'));
    assert(f.calls.includes('query:synthetic outcome'));
  } finally { await rm(f.appRoot, {recursive: true, force: true}); }
});

test('current 36-source enumeration preserves exact fixed, dynamic and isolated HOLDs', async () => {
  const entry = await readFile(new URL('run-original-functions.js', original), 'utf8');
  const begin = entry.indexOf(' const hold='), end = entry.indexOf('\n \n if(!sourceFolders', begin);
  assert(begin >= 0 && end > begin);
  const checkHold = new Function('sourceId', 'load', 'readIsolation', entry.slice(begin, end));
  const routes = JSON.parse(await readFile(new URL('sources.json', original), 'utf8')).rows;
  const visited = [];
  const results = await runOriginalSerial(routes.map(row => row.sourceId), async sourceId => {
    checkHold(sourceId, () => ({'source-amgen-china-social': 'DYNAMIC_HOLD'}),
      {holds: {'source-boehringer-ingelheim-china-social': 'PRE_CAPTURE_READ_UNKNOWN_PRODUCER_TERMINAL_NO_PUBLISH'}});
    visited.push(sourceId); return {skip: 'OFFLINE_TEST_NO_CAPTURE'};
  });
  assert.equal(results.length, 36);
  assert.equal(results.filter(row => row.status === 'HELD').length, 20);
  assert.equal(visited.length, 16);
  assert(results.find(row => row.sourceId === 'source-abbvie-china-social').reason.includes('PUBLICATION_REVIEW_REJECTED_20261030'));
});
