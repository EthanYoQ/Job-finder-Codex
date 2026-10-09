/**
 * In-process, one-shot transport boundary. Not a network service or an SQL API.
 * The trusted compiler is fixed by deployment, never selected by request data.
 * This is application containment, NOT a substitute for PostgreSQL privileges.
 * No connection is opened until an explicitly activated dispatch.
 */
import { createHash, randomUUID } from 'node:crypto';

export const PROJECT_ID = 'yiopvxysxrtrnvqxwgbx';
export const KINDS = Object.freeze(['READ_CONTEXT', 'READ_PUBLICATION_CONTEXT', 'READ_READER_CONTEXT', 'PUBLISH', 'READ_OUTCOME']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const identity = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const failure = (outcome, code) => ({ status: 'FAILED', outcome, code });
const codeOf = e => typeof e?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(e.code) ? e.code : 'TRANSPORT_ERROR';
function fail(code) { throw Object.assign(new Error(code), { code }); }
function freeze(value) {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function assertBinding(binding) {
  if (!binding || binding.projectId !== PROJECT_ID ||
      ['sourceId', 'candidateId', 'batchId', 'sourceResultId'].some(k => !identity.test(binding[k] ?? '')) ||
      !/^[a-f0-9]{64}$/.test(binding.sourceConfigSha256 ?? '') ||
      binding.sourceResultId !== binding.batchId + '--' + binding.sourceId ||
      !Number.isSafeInteger(binding.overallDeadline) || !Number.isSafeInteger(binding.expiresAt) ||
      !Number.isSafeInteger(binding.dispatchBefore) || binding.dispatchBefore >= binding.expiresAt ||
      binding.expiresAt > binding.overallDeadline) fail('BINDING_INVALID');
}
function normalizeRows(raw, kind) {
  const results = Array.isArray(raw) ? raw : [raw];
  if (!results.length || results.some(r => !r || !Array.isArray(r.rows) || typeof r.command !== 'string')) fail('PG_RESULT_SHAPE');
  if (kind === 'PUBLISH') {
    // The deployed legacy compiler sends exactly SET LOCAL + one atomic DO.
    // Requiring both command tags also observes completion, not merely write start.
    if (results.length !== 2 || results[0].command !== 'SET' || results[1].command !== 'DO' ||
        results.some(r => r.rows.length !== 0)) fail('PG_PUBLICATION_COMPLETION_SHAPE');
    return [];
  }
  if (kind === 'READ_READER_CONTEXT') {
    if (results.length !== 3 || results.map(r => r.command).join(',') !== 'BEGIN,SELECT,ROLLBACK' ||
        results[0].rows.length || results[2].rows.length) fail('PG_READER_RESULT_SHAPE');
    return results[1].rows;
  }
  if (results.length !== 1 || results[0].command !== 'SELECT') fail('PG_READ_RESULT_SHAPE');
  return results[0].rows;
}

export function createRestrictedTransport({ compiler, journal, openConnection, activated = false, now = Date.now,
  schedule = setTimeout, unschedule = clearTimeout }) {
  if (typeof compiler !== 'function' || !journal || typeof journal.prepare !== 'function' ||
      typeof journal.claim !== 'function' || typeof journal.finish !== 'function' ||
      typeof openConnection !== 'function') fail('TRANSPORT_DEPENDENCY');
  const tickets = new WeakMap();
  async function bounded(promise, deadline) {
    const remaining = deadline - now();
    if (remaining <= 0) fail('RESPONSE_DEADLINE');
    let timer;
    try {
      const result = await Promise.race([promise, new Promise((_, reject) => {
        timer = schedule(() => reject(Object.assign(new Error('RESPONSE_DEADLINE'), { code: 'RESPONSE_DEADLINE' })), remaining);
      })]);
      if (now() >= deadline) fail('RESPONSE_DEADLINE');
      return result;
    } finally { if (timer !== undefined) unschedule(timer); }
  }
  const closeWithoutWaiting = connection => {
    // Socket teardown cannot delay saving the authoritative result. The pg
    // adapter's end() also destroys an outstanding query on response timeout.
    try { Promise.resolve(connection?.close()).catch(() => {}); } catch {}
  };
  async function prepare(kind, input, suppliedBinding) {
    if (!KINDS.includes(kind)) fail('KIND_NOT_ALLOWED');
    const binding = clone(suppliedBinding); assertBinding(binding);
    if (now() >= binding.dispatchBefore) fail('REQUEST_EXPIRED');
    // Compile once. Existing compilers mint random holder/row/delimiter IDs.
    // Neither serialized SQL nor a loaded request can mint a dispatch ticket.
    const compiled = await compiler(kind, input, clone(binding));
    if (!compiled || typeof compiled.sql !== 'string' || !compiled.sql ||
        (kind === 'PUBLISH' && (compiled.values !== undefined || compiled.atomic !== true))) fail('COMPILER_OUTPUT_INVALID');
    const expiry = compiled.expiresAt === undefined ? binding.expiresAt : Date.parse(compiled.expiresAt);
    if (!Number.isSafeInteger(expiry) || expiry > binding.expiresAt) fail('COMPILER_EXTENDED_DEADLINE');
    const reserve = kind === 'PUBLISH' ? 165000 : 25000;
    const cutoff = Math.min(binding.dispatchBefore, expiry - reserve);
    if (now() >= cutoff) fail('REQUEST_EXPIRED');
    const effectiveBinding = freeze({ ...binding, expiresAt: expiry, dispatchBefore: cutoff });
    const payload = { projectId: PROJECT_ID, sql: compiled.sql,
      ...(compiled.values === undefined ? {} : { values: clone(compiled.values) }),
      dispatchBefore: new Date(cutoff).toISOString() };
    const body = { schemaVersion: 1, requestId: randomUUID(), kind,
      expiresAt: new Date(expiry).toISOString(), payload };
    const request = freeze({ ...body, requestSha256: sha256(JSON.stringify(body)) });
    const artifact = freeze({ schemaVersion: 1, request, binding: effectiveBinding,
      sqlSha256: sha256(compiled.sql), packet: clone(compiled.packet ?? null) });
    await journal.prepare(artifact);
    const ticket = Object.freeze({});
    tickets.set(ticket, { artifact, state: 'PREPARED' });
    return { ticket, request: clone(request), binding: clone(effectiveBinding), packet: clone(artifact.packet) };
  }
  async function dispatch(ticket, { assertScope, verifyPublicationReady } = {}) {
    const entry = tickets.get(ticket);
    if (!entry || entry.state !== 'PREPARED') fail('NO_LIVE_ONE_SHOT_TICKET');
    // Set synchronously so concurrent calls cannot both enter the async path.
    entry.state = 'CONSUMED';
    const { artifact } = entry, { request, binding } = artifact;
    if (activated !== true) return failure('NOT_DISPATCHED', 'ACTIVATION_REQUIRED');
    if (typeof assertScope !== 'function' || assertScope.constructor?.name === 'AsyncFunction' ||
        (request.kind === 'PUBLISH' && typeof verifyPublicationReady !== 'function')) return failure('NOT_DISPATCHED', 'GUARDS_REQUIRED');
    const guard = () => {
      if (assertScope(clone(binding)) !== true) fail('SCOPE_CHANGED');
      if (now() >= binding.dispatchBefore || now() >= binding.expiresAt || now() >= binding.overallDeadline) fail('REQUEST_EXPIRED');
    };
    let connection, claimed = false, claimAttempted = false, invoked = false, result;
    try {
      guard();
      let connectWaitOver = false;
      const connecting = Promise.resolve(openConnection({ deadline: binding.dispatchBefore, kind: request.kind }));
      connecting.then(c => { if (connectWaitOver && !connection) closeWithoutWaiting(c); }, () => {});
      try { connection = await bounded(connecting, binding.dispatchBefore); }
      finally { connectWaitOver = true; }
      if (!connection || typeof connection.query !== 'function' || typeof connection.close !== 'function') fail('CONNECTION_SHAPE');
      guard();
      // The program must complete the existing real reader/build/source gate.
      // Network or evidence work happens BEFORE the durable send claim.
      if (request.kind === 'PUBLISH' && await bounded(Promise.resolve(verifyPublicationReady(clone(artifact))), binding.dispatchBefore) !== true) fail('PUBLICATION_GATE_FAILED');
      guard();
      claimAttempted = true; await bounded(Promise.resolve(journal.claim(artifact)), binding.dispatchBefore); claimed = true;
      // No await between this true final guard and pg.query invocation.
      guard(); invoked = true;
      const pending = connection.query({ text: request.payload.sql,
        ...(request.payload.values === undefined ? {} : { values: request.payload.values }) });
      const raw = await bounded(Promise.resolve(pending), binding.expiresAt);
      result = { status: 'SUCCEEDED', rows: normalizeRows(raw, request.kind) };
    } catch (error) {
      // Missing reply, disconnect, unknown completion or result shape are UNKNOWN.
      // Do not trust arbitrary error strings/SQLSTATE as proof of server rollback.
      // READ_OUTCOME determines database truth using the retained original tuple.
      result = failure(invoked || (claimAttempted && !claimed) ? 'UNKNOWN' : 'NOT_DISPATCHED', codeOf(error));
    } finally {
      closeWithoutWaiting(connection);
    }
    if (claimed) {
      try { await bounded(Promise.resolve(journal.finish(artifact, result)), binding.overallDeadline); }
      catch { return failure('UNKNOWN', 'RESULT_NOT_DURABLE'); }
    }
    return result;
  }
  return Object.freeze({ prepare, dispatch });
}
