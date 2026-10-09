import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRestrictedTransport, PROJECT_ID } from './restricted-transport.mjs';
import { createFileJournal } from './file-journal.mjs';
import { createPgConnectionFactory, WRITER_ROLE } from './pg-connection.mjs';

const AUTHORITY = '12345678-1234-4234-8234-123456789abc';
async function testJournal(dir) {
  try { await writeFile(join(dir,'authority.json'), JSON.stringify({schemaVersion:1,authorityId:AUTHORITY,projectId:PROJECT_ID,initializedAt:new Date().toISOString()}), {flag:'wx',mode:0o600}); }
  catch(e) { if(e.code!=='EEXIST') throw e; }
  return createFileJournal(dir,{expectedAuthorityId:AUTHORITY});
}
const base = 1_800_000_000_000;
const binding = () => ({ projectId: PROJECT_ID, sourceId: 'source-test-china-social', sourceConfigSha256: 'a'.repeat(64),
  candidateId: 'candidate-60', batchId: 'batch-01', sourceResultId: 'batch-01--source-test-china-social',
  overallDeadline: base + 500000, expiresAt: base + 400000, dispatchBefore: base + 235000 });
const guards = { assertScope: () => true, verifyPublicationReady: async () => true };
const success = [{ command: 'SET', rows: [] }, { command: 'DO', rows: [] }];
function fixture(overrides = {}) {
  let clock = base;
  const events = [], saved = [], sent = [], claims = new Set();
  const journal = { prepare: async a => { events.push('prepare'); saved.push(a); },
    claim: async a => { events.push('claim'); if (claims.has(a.request.requestId)) throw Object.assign(Error('existing'), { code: 'EEXIST' }); claims.add(a.request.requestId); },
    finish: async (_, result) => events.push(['finish', result.status]) };
  const compiler = async kind => { events.push('compile'); return { sql: kind === 'PUBLISH' ? 'SET LOCAL; DO original;' : 'SELECT fixed;', atomic: true }; };
  const openConnection = async () => { events.push('open'); return { query: async value => { events.push('query'); sent.push(value); return success; }, close: async () => events.push('close') }; };
  const transport = createRestrictedTransport({ compiler, journal, openConnection, activated: true, now: () => clock, ...overrides });
  return { transport, events, saved, sent, claims, setClock: value => { clock = value; } };
}
test('one trusted compile, exact SQL, durable claim then one query', async () => {
  const f = fixture(), prepared = await f.transport.prepare('PUBLISH', {}, binding());
  prepared.request.payload.sql = 'DELETE anything'; // exposed copy is not authority
  const result = await f.transport.dispatch(prepared.ticket, guards);
  assert.deepEqual(result, { status: 'SUCCEEDED', rows: [] });
  assert.equal(f.sent[0].text, 'SET LOCAL; DO original;');
  assert.deepEqual(f.events, ['compile', 'prepare', 'open', 'claim', 'query', 'close', ['finish', 'SUCCEEDED']]);
  await assert.rejects(f.transport.dispatch(prepared.ticket, guards), /NO_LIVE_ONE_SHOT_TICKET/);
});
test('inactive transport does not open a connection', async () => {
  const f = fixture({ activated: false }), p = await f.transport.prepare('PUBLISH', {}, binding());
  assert.deepEqual(await f.transport.dispatch(p.ticket, guards), { status: 'FAILED', outcome: 'NOT_DISPATCHED', code: 'ACTIVATION_REQUIRED' });
  assert(!f.events.includes('open'));
});
test('serialized or copied ticket cannot dispatch', async () => {
  const f = fixture(), p = await f.transport.prepare('PUBLISH', {}, binding());
  await assert.rejects(f.transport.dispatch({ ...p.ticket }, guards), /NO_LIVE_ONE_SHOT_TICKET/);
  await assert.rejects(f.transport.dispatch(p.request, guards), /NO_LIVE_ONE_SHOT_TICKET/);
});
test('concurrent submissions of the same ticket yield only one query', async () => {
  const f = fixture(), p = await f.transport.prepare('PUBLISH', {}, binding());
  const outcomes = await Promise.allSettled([f.transport.dispatch(p.ticket, guards), f.transport.dispatch(p.ticket, guards)]);
  assert.equal(outcomes.filter(r => r.status === 'rejected').length, 1); assert.equal(f.sent.length, 1);
});
test('unsupported kind and wrong project stop before compiler', async () => {
  const f = fixture();
  await assert.rejects(f.transport.prepare('EXECUTE_SQL', {}, binding()), /KIND_NOT_ALLOWED/);
  await assert.rejects(f.transport.prepare('PUBLISH', {}, { ...binding(), projectId: 'other' }), /BINDING_INVALID/);
  assert.equal(f.events.length, 0);
});
test('expired prepare does not compile', async () => {
  const f = fixture(); f.setClock(base + 235000);
  await assert.rejects(f.transport.prepare('PUBLISH', {}, binding()), /REQUEST_EXPIRED/); assert.equal(f.events.length, 0);
});
test('compiler cannot extend the original deadline', async () => {
  const f = fixture({ compiler: async () => ({ sql: 'sql', atomic: true, expiresAt: new Date(base + 400001).toISOString() }) });
  await assert.rejects(f.transport.prepare('PUBLISH', {}, binding()), /COMPILER_EXTENDED_DEADLINE/);
});
test('compiler may shorten the original proof window', async () => {
  const f = fixture({ compiler: async () => ({ sql: 'sql', atomic: true, expiresAt: new Date(base + 300000).toISOString() }) });
  const p = await f.transport.prepare('PUBLISH', {}, binding()); assert.equal(p.binding.dispatchBefore, base + 135000);
});
test('PUBLISH requires the real-reader gate', async () => {
  const f = fixture(), p = await f.transport.prepare('PUBLISH', {}, binding());
  const result = await f.transport.dispatch(p.ticket, { assertScope: () => true });
  assert.equal(result.code, 'GUARDS_REQUIRED'); assert(!f.events.includes('open'));
});
test('failed reader gate prevents claim and query', async () => {
  const f = fixture(), p = await f.transport.prepare('PUBLISH', {}, binding());
  const result = await f.transport.dispatch(p.ticket, { ...guards, verifyPublicationReady: async () => false });
  assert.equal(result.outcome, 'NOT_DISPATCHED'); assert.equal(f.sent.length, 0); assert(!f.events.includes('claim'));
});
test('deadline crossed while reader gate runs prevents query', async () => {
  const f = fixture(), p = await f.transport.prepare('PUBLISH', {}, binding());
  const result = await f.transport.dispatch(p.ticket, { ...guards, verifyPublicationReady: async () => { f.setClock(base + 235000); return true; } });
  assert.equal(result.code, 'RESPONSE_DEADLINE'); assert.equal(f.sent.length, 0);
});
test('deadline crossed during durable claim prevents query', async () => {
  let clock = base, queried = false;
  const f = fixture({ now: () => clock, journal: { prepare: async () => {}, claim: async () => { clock = base + 235000; }, finish: async () => {} },
    openConnection: async () => ({ query: async () => { queried = true; }, close: async () => {} }) });
  const p = await f.transport.prepare('PUBLISH', {}, binding()), result = await f.transport.dispatch(p.ticket, guards);
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(result.code, 'RESPONSE_DEADLINE'); assert.equal(queried, false);
});
test('scope changed during gate prevents query', async () => {
  let valid = true; const f = fixture(), p = await f.transport.prepare('PUBLISH', {}, binding());
  const result = await f.transport.dispatch(p.ticket, { assertScope: () => valid, verifyPublicationReady: async () => { valid = false; return true; } });
  assert.equal(result.code, 'SCOPE_CHANGED'); assert.equal(f.sent.length, 0);
});
test('lost reply stays UNKNOWN and no automatic retry', async () => {
  let count = 0;
  const f = fixture({ openConnection: async () => ({ query: async () => { count++; throw Object.assign(Error('socket closed'), { code: 'ECONNRESET' }); }, close: async () => {} }) });
  const p = await f.transport.prepare('PUBLISH', {}, binding()), result = await f.transport.dispatch(p.ticket, guards);
  assert.equal(result.outcome, 'UNKNOWN'); assert.equal(count, 1);
  await assert.rejects(f.transport.dispatch(p.ticket, guards), /NO_LIVE_ONE_SHOT_TICKET/); assert.equal(count, 1);
});
test('unverified SQLSTATE never establishes rollback', async () => {
  const f = fixture({ openConnection: async () => ({ query: async () => { throw Object.assign(Error('anything'), { code: 'P0001' }); }, close: async () => {} }) });
  const p = await f.transport.prepare('PUBLISH', {}, binding()); assert.equal((await f.transport.dispatch(p.ticket, guards)).outcome, 'UNKNOWN');
});
test('existing dispatch marker is UNKNOWN and never invokes query', async () => {
  const f = fixture(), p = await f.transport.prepare('PUBLISH', {}, binding()); f.claims.add(p.request.requestId);
  assert.equal((await f.transport.dispatch(p.ticket, guards)).outcome, 'UNKNOWN'); assert.equal(f.sent.length, 0);
});
test('unpersisted acknowledgement becomes UNKNOWN', async () => {
  const f = fixture({ journal: { prepare: async () => {}, claim: async () => {}, finish: async () => { throw Error('disk'); } } });
  const p = await f.transport.prepare('PUBLISH', {}, binding()), r = await f.transport.dispatch(p.ticket, guards);
  assert.equal(r.outcome, 'UNKNOWN'); assert.equal(r.code, 'RESULT_NOT_DURABLE');
});
test('publication result must include both SET and DO completions', async () => {
  const f = fixture({ openConnection: async () => ({ query: async () => ({ command: 'SET', rows: [] }), close: async () => {} }) });
  const p = await f.transport.prepare('PUBLISH', {}, binding()); assert.equal((await f.transport.dispatch(p.ticket, guards)).outcome, 'UNKNOWN');
});
test('read outcome returns fixed selected rows with bound values', async () => {
  let actual;
  const f = fixture({ compiler: async () => ({ sql: 'SELECT $1', values: ['original-source-result'] }),
    openConnection: async () => ({ query: async q => { actual = q; return { command: 'SELECT', rows: [{ row: null, batch: null, holderId: '' }] }; }, close: async () => {} }) });
  const p = await f.transport.prepare('READ_OUTCOME', null, binding());
  assert.equal((await f.transport.dispatch(p.ticket, { assertScope: () => true })).rows.length, 1);
  assert.deepEqual(actual, { text: 'SELECT $1', values: ['original-source-result'] });
});
test('real file journal fsyncs exact prepared packet and prevents duplicate claim', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restricted-transport-'));
  try {
    await chmod(dir, 0o700); const journal = await testJournal(dir), f = fixture({ journal });
    const p = await f.transport.prepare('PUBLISH', {}, binding()); await f.transport.dispatch(p.ticket, guards);
    const files = await readdir(dir); assert.equal(files.length, 5);
    const a = JSON.parse(await readFile(join(dir, p.request.requestId + '.prepared.json'), 'utf8'));
    assert.deepEqual(a.request, p.request); await assert.rejects(journal.claim(a), { code: 'EEXIST' });
    const restored = fixture({ journal }); await assert.rejects(restored.transport.dispatch(a.request, guards), /NO_LIVE_ONE_SHOT_TICKET/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('persistent tuple fence blocks a newly compiled ticket after UNKNOWN and restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'restricted-tuple-')); let queries = 0;
  try {
    await chmod(dir, 0o700);
    const openConnection = async () => ({ query: async () => { queries++; throw Error('lost reply'); }, close: async () => {} });
    const first = fixture({ journal: await testJournal(dir), openConnection });
    const original = await first.transport.prepare('PUBLISH', {}, binding());
    assert.equal((await first.transport.dispatch(original.ticket, guards)).outcome, 'UNKNOWN');
    const restarted = fixture({ journal: await testJournal(dir), openConnection });
    const recompiled = await restarted.transport.prepare('PUBLISH', {}, binding());
    assert.notEqual(recompiled.request.requestId, original.request.requestId);
    assert.equal((await restarted.transport.dispatch(recompiled.ticket, guards)).outcome, 'UNKNOWN');
    assert.equal(queries, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('journal rejects public permissions and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'restricted-journal-'));
  try {
    await chmod(root, 0o755); await assert.rejects(createFileJournal(root), /PRIVATE_JOURNAL_REQUIRED/);
    await chmod(root, 0o700); await symlink(root, root + '-link'); await assert.rejects(createFileJournal(root + '-link'), /PRIVATE_JOURNAL_REQUIRED/);
  } finally { await rm(root + '-link', { force: true }); await rm(root, { recursive: true, force: true }); }
});

const config = () => ({ projectId: PROJECT_ID, database: 'postgres', port: 5432, mode: 'direct',
  host: `db.${PROJECT_ID}.supabase.co`, verifiedHost: `db.${PROJECT_ID}.supabase.co`, user: WRITER_ROLE,
  ca: '-----BEGIN CERTIFICATE-----\nTEST ONLY\n-----END CERTIFICATE-----' });
test('PG config rejects elevated user, insecure extras, wrong project and transaction pool', () => {
  for (const bad of [{ user: 'postgres' }, { ssl: false }, { projectId: 'wrong' }, { port: 6543 }, { mode: 'transaction' }])
    assert.throws(() => createPgConnectionFactory({ Client: class {}, config: { ...config(), ...bad }, passwordProvider: async () => 'x'.repeat(25) }), /PG_/);
});
test('PG factory pins TLS and role, uses no DSN, and restricts read timeout', async () => {
  let received, closed = false;
  class Client {
    constructor(c) { received = c; } on() {} async connect() {}
    async query() { return { rows: [{ role: WRITER_ROLE, session_role: WRITER_ROLE, database: 'postgres', isolation: 'read committed', synchronous_commit: 'on', elevated: false }] }; }
    async end() { closed = true; }
  }
  const factory = createPgConnectionFactory({ Client, config: config(), passwordProvider: async () => 'test-only-value-1234567890', now: () => base });
  const connection = await factory({ deadline: base + 10000, kind: 'READ_OUTCOME' });
  assert.equal(received.ssl.rejectUnauthorized, true); assert.equal(received.ssl.servername, config().host);
  assert.equal(received.statement_timeout, 8000); assert.equal(received.connectionString, undefined);
  await connection.close(); assert.equal(closed, true);
});
test('PG factory closes and redacts connection failures', async () => {
  let closed = false;
  class Client { on() {} async connect() { throw Error('secret-driver-message'); } async end() { closed = true; } }
  const factory = createPgConnectionFactory({ Client, config: config(), passwordProvider: async () => 'test-only-value-1234567890', now: () => base });
  await assert.rejects(factory({ deadline: base + 10000, kind: 'PUBLISH' }), e => e.message === 'PG_CONNECTION_UNAVAILABLE');
  assert.equal(closed, true);
});
test('PG factory rejects elevated authenticated role', async () => {
  class Client {
    on() {} async connect() {} async end() {}
    async query() { return { rows: [{ role: WRITER_ROLE, session_role: WRITER_ROLE, database: 'postgres', isolation: 'read committed', synchronous_commit: 'on', elevated: true }] }; }
  }
  const factory = createPgConnectionFactory({ Client, config: config(), passwordProvider: async () => 'test-only-value-1234567890', now: () => base });
  await assert.rejects(factory({ deadline: base + 10000, kind: 'PUBLISH' }), /PG_CONNECTION_UNAVAILABLE/);
});

test('text activation false cannot open a connection', async () => {
  const f=fixture({activated:'false'}), p=await f.transport.prepare('PUBLISH',{},binding());
  assert.equal((await f.transport.dispatch(p.ticket,guards)).code,'ACTIVATION_REQUIRED'); assert(!f.events.includes('open'));
});
test('missing authority marker fails closed, never initializes an empty replacement', async () => {
  const dir=await mkdtemp(join(tmpdir(),'missing-authority-'));
  try { await chmod(dir,0o700); await assert.rejects(createFileJournal(dir,{expectedAuthorityId:AUTHORITY}),{code:'ENOENT'}); assert.deepEqual(await readdir(dir),[]); }
  finally { await rm(dir,{recursive:true,force:true}); }
});
test('reader query retains BEGIN SELECT ROLLBACK and returns only inventory row', async () => {
 const f=fixture({openConnection:async()=>({query:async()=>[{command:'BEGIN',rows:[]},{command:'SELECT',rows:[{reader_before:{}}]},{command:'ROLLBACK',rows:[]}],close:async()=>{}})});
 const p=await f.transport.prepare('READ_READER_CONTEXT',null,binding());
 assert.deepEqual(await f.transport.dispatch(p.ticket,{assertScope:()=>true}),{status:'SUCCEEDED',rows:[{reader_before:{}}]});
});
test('response timeout returns durable UNKNOWN without awaiting hanging close', async () => {
 let callbacks=[],done,closed=false,clock=base;
 const transport=createRestrictedTransport({compiler:async()=>({sql:'SET;DO',atomic:true}),
 journal:{prepare:async()=>{},claim:async()=>{},finish:async(_,r)=>{done=r;}},activated:true,now:()=>clock,
 schedule:fn=>{callbacks.push(fn);return fn;},unschedule:fn=>{callbacks=callbacks.filter(x=>x!==fn);},
 openConnection:async()=>({query:()=>new Promise(()=>{}),close:()=>{closed=true;return new Promise(()=>{});}})});
 const p=await transport.prepare('PUBLISH',{},binding()),work=transport.dispatch(p.ticket,guards);
 await new Promise(r=>setImmediate(r));clock=base+400000;assert.equal(callbacks.length,1);callbacks[0]();
 const result=await work;assert.equal(result.outcome,'UNKNOWN');assert.equal(done.outcome,'UNKNOWN');assert.equal(closed,true);
});
test('PG factory bounds a blackholed identity query and closes its own client', async () => {
 let timeout,ended=false;
 class Client {on(){} async connect(){} query(){return new Promise(()=>{});} end(){ended=true;return Promise.resolve();}}
 const factory=createPgConnectionFactory({Client,config:config(),passwordProvider:async()=>'test-only-value-1234567890',now:()=>base,schedule:fn=>(timeout=fn),unschedule:()=>{}});
 const pending=factory({deadline:base+10000,kind:'PUBLISH'});await new Promise(r=>setImmediate(r));timeout();
 await assert.rejects(pending,/PG_CONNECTION_UNAVAILABLE/);assert.equal(ended,true);
});
test('PG factory rejects asynchronous WAL acknowledgement', async () => {
 class Client {on(){} async connect(){} async end(){} async query(){return {rows:[{role:WRITER_ROLE,session_role:WRITER_ROLE,database:'postgres',isolation:'read committed',synchronous_commit:'off',elevated:false}]};}}
 const factory=createPgConnectionFactory({Client,config:config(),passwordProvider:async()=> 'test-only-value-1234567890',now:()=>base});
 await assert.rejects(factory({deadline:base+10000,kind:'PUBLISH'}),/PG_CONNECTION_UNAVAILABLE/);
});
