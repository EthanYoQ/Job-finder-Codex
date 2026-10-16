import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDispatchObserver, restoreDispatchObserver } from './dispatch-observer.mjs';

// ALL callbacks, capability authorities, and publication data below are
// TEST_ONLY fixtures. There is no connector credential or database invocation.
const START = 100_000;
const request = () => ({ schemaVersion: 1, requestId: 'TEST_ONLY_REQUEST',
  requestSha256: 'TEST_ONLY_HASH_IS_NOT_AUTHORIZATION', kind: 'PUBLISH',
  expiresAt: new Date(START + 500).toISOString(), payload: {
    projectId: 'TEST_ONLY_PROJECT', sql: 'TEST_ONLY_SYNTHETIC_PUBLICATION',
    dispatchBefore: new Date(START + 100).toISOString(),
  } });
const tuple = { sourceId: 'TEST_ONLY_SOURCE', batchId: 'TEST_ONLY_BATCH',
  originalSessionId: 'TEST_ONLY_SESSION', originalLaunchSha256: 'TEST_ONLY_LAUNCH' };
const successfulRaw = rows => ({ isError: false, structuredContent: {
  result: `\n<untrusted-data-test-only>\n${JSON.stringify(rows ?? [])}\n</untrusted-data-test-only>`,
} });
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function fakeClock() {
  let at = START, nextId = 1;
  const timers = new Map();
  return {
    now: () => at,
    schedule(fn, delay) { const id = nextId++; timers.set(id, { at: at + delay, fn }); return id; },
    cancel(id) { timers.delete(id); },
    advance(to) {
      assert.ok(to >= at);
      at = to;
      for (const [id, task] of [...timers]) if (task.at <= at) { timers.delete(id); task.fn(); }
    },
    pendingTimers: () => timers.size,
  };
}
function tokenAuthority() {
  const values = new WeakMap();
  return {
    issue(fact) { const token = Object.freeze({}); values.set(token, structuredClone(fact)); return token; },
    accept(token, expected) {
      const fact = values.get(token);
      if (!fact || !isEqual(fact.expected, expected)) throw Error('TEST_ONLY_OPAQUE_TOKEN_REQUIRED');
      return structuredClone(fact);
    },
  };
}
function isEqual(a, b) { try { assert.deepEqual(a, b); return true; } catch { return false; } }
function fixture(options = {}) {
  const r = request(), clock = fakeClock(), pending = deferred(), events = [];
  if (options.expiresAt !== undefined) r.expiresAt = new Date(options.expiresAt).toISOString();
  if (options.dispatchBefore !== undefined) r.payload.dispatchBefore = new Date(options.dispatchBefore).toISOString();
  const grants = new WeakMap(), authorization = Object.freeze({});
  const expected = { requestId: r.requestId, requestSha256: r.requestSha256, tuple,
    outerDeadline: options.outerDeadline ?? START + 120_800 };
  grants.set(authorization, { request: structuredClone(r), dispatchBefore: Date.parse(r.payload.dispatchBefore),
    expiresAt: Date.parse(r.expiresAt), outerDeadline: expected.outerDeadline, tuple, mode: 'OFFLINE_REVIEW_ONLY' });
  const consume = async (token, exactRequest) => {
    events.push('consume');
    const grant = grants.get(token);
    grants.delete(token); // Consumed before any async work or possible failure.
    if (!grant || !isEqual(exactRequest, grant.request)) throw Error('TEST_ONLY_GATE_REJECTED');
    if (options.consume) return options.consume(grant, clock);
    return grant;
  };
  const terminals = tokenAuthority(), outcomes = tokenAuthority();
  const terminalFact = { kind: 'ORIGINAL_CHILD_TERMINAL', expected, observedAt: START + 20,
    originalSessionId: tuple.originalSessionId, originalLaunchSha256: tuple.originalLaunchSha256,
    wrapper: { state: 'TERMINATED', exitCode: 0, signal: null, reaped: true },
    child: { state: 'TERMINATED', exitCode: 0, signal: null, reaped: true } };
  const outcomeCutoff = Math.min(expected.outerDeadline - 60_000, (options.outcomePhaseEntryAt ?? START + 30) + 60_000);
  const outcomeFact = { kind: 'READ_OUTCOME', expected, state: 'COMMITTED_EXACT', observedAt: START + 30,
    originalRequest: { schemaVersion: 1, kind: 'READ_OUTCOME', requestId: 'TEST_ONLY_OUTCOME_REQUEST',
      requestSha256: 'TEST_ONLY_OUTCOME_HASH_IS_NOT_AUTHORIZATION',
      expiresAt: new Date(outcomeCutoff).toISOString(), payload: {
        projectId: r.payload.projectId, sql: 'TEST_ONLY_ORIGINAL_READ_OUTCOME',
        dispatchBefore: new Date(outcomeCutoff - 25_000).toISOString(),
      } } };
  const port = { kind: 'TEST_ONLY_SYNTHETIC_PORT',
    async markIntent(input) {
      events.push('mark-wx');
      assert.equal(input.flag, 'wx');
      if (options.mark) return options.mark(input, clock);
      return { marked: true, exclusive: true, requestId: r.requestId, requestSha256: r.requestSha256 };
    },
    publish(input) {
      events.push('publish-TEST_ONLY');
      assert.equal(input.testOnly, true);
      return options.publish ? options.publish(input, clock) : pending.promise;
    },
    async writeResponseOnce(packet) {
      events.push('response-wx');
      assert.equal(packet.flag, 'wx');
      if (options.write) return options.write(packet, clock);
      return { written: true, exclusive: true, requestId: r.requestId,
        requestSha256: r.requestSha256, result: structuredClone(packet.result) };
    },
  };
  const config = { request: r, authorization, consumeAuthorization: consume,
    originalTerminalAuthority: terminals, readOutcomeAuthority: outcomes,
    mode: 'TEST_ONLY', testOnlyPort: port, now: clock.now, schedule: clock.schedule, cancel: clock.cancel };
  const observer = createDispatchObserver({ ...config, ...options.config });
  const attachBoth = async () => {
    await observer.observeOriginalTerminal(terminals.issue(terminalFact));
    await observer.observeReadOutcome(outcomes.issue(outcomeFact));
  };
  const succeed = async () => {
    await observer.dispatch(); pending.resolve(successfulRaw()); await observer.settlementPromise;
    clock.advance(START + 30);
  };
  return { observer, config, r, authorization, consume, clock, pending, events, port,
    terminals, outcomes, terminalFact, outcomeFact, expected, attachBoth, succeed };
}
function assertHeld(observer) {
  const state = observer.snapshot();
  assert.equal(state.testOnlyCompletionVerified, false);
  assert.equal(state.releaseEligible, false);
  assert.equal(state.newBatchAllowed, false);
  assert.equal(state.sourceHeld, true);
  return state;
}

test('default port is disabled and a mode string cannot activate a real connector', async () => {
  const f = fixture({ config: { mode: 'DISABLED' } });
  assert.equal(f.observer.snapshot().status, 'DISABLED');
  await assert.rejects(f.observer.dispatch(), /REAL_CONNECTOR_PORT_DISABLED/);
  assert.deepEqual(f.events, []);
  assert.throws(() => createDispatchObserver({ ...f.config, mode: 'LIVE' }), /REAL_CONNECTOR_PORT_DISABLED/);
  assert.throws(() => createDispatchObserver({ ...f.config, testOnlyPort: {} }), /TEST_ONLY_PORT_AND_GATE_REQUIRED/);
});

test('normal tool success alone cannot complete: original child and READ_OUTCOME are both required', async () => {
  const f = fixture(); await f.succeed();
  assert.equal(assertHeld(f.observer).tool, 'SUCCEEDED');
  await f.observer.observeOriginalTerminal(f.terminals.issue(f.terminalFact));
  assertHeld(f.observer);
  await f.observer.observeReadOutcome(f.outcomes.issue(f.outcomeFact));
  const state = f.observer.snapshot();
  assert.equal(state.status, 'TEST_ONLY_VERIFIED');
  assert.equal(state.testOnlyCompletionVerified, true);
  assert.equal(state.releaseEligible, false);
  assert.equal(state.newBatchAllowed, false);
  assert.equal(f.clock.pendingTimers(), 0);
  assert.deepEqual(f.events, ['consume', 'mark-wx', 'publish-TEST_ONLY', 'response-wx']);
});

test('READ_OUTCOME without original terminal holds even after normal success', async () => {
  const f = fixture(); await f.succeed();
  await f.observer.observeReadOutcome(f.outcomes.issue(f.outcomeFact));
  assert.equal(assertHeld(f.observer).terminal, 'MISSING');
});

test('expiry observes pending tool independently and retains the EXACT original Promise', async () => {
  const f = fixture(); await f.observer.dispatch();
  assert.equal(f.observer.liveToolPromise, f.pending.promise);
  f.clock.advance(START + 500);
  const state = assertHeld(f.observer);
  assert.equal(state.status, 'UNKNOWN');
  assert.equal(state.tool, 'PENDING');
  assert.equal(f.observer.liveToolPromise, f.pending.promise);
  assert.equal(f.observer.rawToolFact, null);
  assert.deepEqual(f.events, ['consume', 'mark-wx', 'publish-TEST_ONLY']);
  await assert.rejects(f.observer.dispatch(), /DISPATCH_ALREADY_CLAIMED/);
});

test('late success is retained as raw fact without a fabricated or late-started relay response', async () => {
  const f = fixture(); await f.observer.dispatch(); f.clock.advance(START + 501);
  const raw = successfulRaw([{ synthetic: true }]); f.pending.resolve(raw);
  await f.observer.settlementPromise;
  assert.equal(f.observer.rawToolFact.value, raw);
  assert.equal(f.observer.rawToolFact.type, 'FULFILLED');
  assert.equal(f.observer.liveToolPromise, f.pending.promise);
  assert.equal(assertHeld(f.observer).response, 'NOT_WRITTEN_EXPIRED');
  await f.attachBoth();
  assert.equal(assertHeld(f.observer).outcome, 'COMMITTED_EXACT');
  assert.equal(f.events.filter(x => x === 'response-wx').length, 0);
});

for (const disposition of ['reject', 'error-envelope', 'unparseable']) {
  test(`late ${disposition} retains fact, remains UNKNOWN, and cannot resend`, async () => {
    const f = fixture(); await f.observer.dispatch(); f.clock.advance(START + 600);
    const raw = disposition === 'reject' ? Error('TEST_ONLY_LOST_RESPONSE') :
      disposition === 'error-envelope' ? { isError: true, content: [] } : { result: 'unknown' };
    if (disposition === 'reject') f.pending.reject(raw); else f.pending.resolve(raw);
    await f.observer.settlementPromise;
    assert.equal(f.observer.rawToolFact.value, raw);
    assert.equal(assertHeld(f.observer).tool, 'FAILED_UNKNOWN');
    await assert.rejects(f.observer.dispatch(), /DISPATCH_ALREADY_CLAIMED/);
    assert.equal(f.events.filter(x => x === 'publish-TEST_ONLY').length, 1);
  });
}

test('concurrent dispatch calls seal before the async gate; one authorization cannot cross observers', async () => {
  const gateWait = deferred();
  const f = fixture({ consume: async grant => { await gateWait.promise; return grant; } });
  const first = f.observer.dispatch();
  await assert.rejects(f.observer.dispatch(), /DISPATCH_ALREADY_CLAIMED/);
  const second = createDispatchObserver(f.config); await second.dispatch();
  assert.equal(assertHeld(second).intent, 'NOT_ATTEMPTED');
  gateWait.resolve(); await first;
  assert.equal(f.events.filter(x => x === 'mark-wx').length, 1);
  assert.equal(f.events.filter(x => x === 'publish-TEST_ONLY').length, 1);
});

for (const authorization of [{}, { requestSha256: 'TEST_ONLY_HASH_IS_NOT_AUTHORIZATION' }, null]) {
  test(`JSON authorization cannot replace in-process gate token: ${JSON.stringify(authorization)}`, async () => {
    const f = fixture({ config: { authorization } }); await f.observer.dispatch();
    assert.equal(assertHeld(f.observer).intent, 'NOT_ATTEMPTED');
    assert.deepEqual(f.events, ['consume']);
  });
}

test('gate failure consumes authorization and prevents intent on retry or new observer', async () => {
  const f = fixture({ consume: async () => { throw Error('TEST_ONLY_PHYSICAL_RECHECK_FAILED'); } });
  await f.observer.dispatch(); await createDispatchObserver(f.config).dispatch();
  assert.deepEqual(f.events, ['consume', 'consume']);
  assertHeld(f.observer);
});

test('exclusive wx boundary rejects a second observer even if it has a separate valid permit', async () => {
  let markerPresent = false;
  const mark = async ({ request: r }) => {
    if (markerPresent) throw Object.assign(Error('TEST_ONLY_DUPLICATE_INTENT'), { code: 'EEXIST' });
    markerPresent = true;
    return { marked: true, exclusive: true, requestId: r.requestId, requestSha256: r.requestSha256 };
  };
  const first = fixture({ mark }), second = fixture({ mark });
  await first.observer.dispatch(); await second.observer.dispatch();
  assert.equal(first.events.filter(x => x === 'publish-TEST_ONLY').length, 1);
  assert.equal(second.events.filter(x => x === 'publish-TEST_ONLY').length, 0);
  assert.equal(assertHeld(second.observer).intent, 'FAILED_OR_UNCERTAIN');
});

for (const mutation of ['request', 'dispatchBefore', 'expiresAt', 'outerDeadline', 'mode', 'tuple']) {
  test(`gate grant ${mutation} mismatch is held before intent`, async () => {
    const f = fixture({ consume: async grant => ({ ...grant, [mutation]: null }) });
    await f.observer.dispatch();
    assert.equal(assertHeld(f.observer).intent, 'NOT_ATTEMPTED');
    assert.deepEqual(f.events, ['consume']);
  });
}

test('expiration while awaiting authorization prevents even mark-intent', async () => {
  const wait = deferred(), f = fixture({ consume: async grant => { await wait.promise; return grant; } });
  const start = f.observer.dispatch(); f.clock.advance(START + 600);
  assert.equal(assertHeld(f.observer).status, 'UNKNOWN');
  wait.resolve(); await start;
  assert.deepEqual(f.events, ['consume']);
});

test('original dispatch cutoff is rechecked AFTER asynchronous authorization', async () => {
  const f = fixture({ consume: async (grant, clock) => { clock.advance(START + 100); return grant; } });
  await f.observer.dispatch();
  assert.equal(assertHeld(f.observer).tool, 'NOT_INVOKED');
  assert.deepEqual(f.events, ['consume']);
});

for (const marker of ['throw', 'lost', 'duplicate', 'wrong-id', 'not-exclusive']) {
  test(`mark intent ${marker} is sealed and cannot retry`, async () => {
    const f = fixture({ mark: async ({ request: r }) => {
      if (marker === 'throw') throw Error('TEST_ONLY_DISK_FAILURE_OR_ACK_LOSS');
      if (marker === 'lost') return undefined;
      return { marked: marker !== 'duplicate', exclusive: marker !== 'not-exclusive',
        requestId: marker === 'wrong-id' ? 'OTHER' : r.requestId, requestSha256: r.requestSha256 };
    } });
    await f.observer.dispatch();
    assert.equal(assertHeld(f.observer).tool, 'NOT_INVOKED');
    await assert.rejects(f.observer.dispatch(), /DISPATCH_ALREADY_CLAIMED/);
    assert.deepEqual(f.events, ['consume', 'mark-wx']);
  });
}

test('pending wx intent can expire independently; late mark success never invokes publication', async () => {
  const wait = deferred(); const f = fixture({ mark: () => wait.promise });
  const start = f.observer.dispatch(); await flush(); f.clock.advance(START + 600);
  assert.equal(assertHeld(f.observer).intent, 'MAY_HAVE_BEEN_RECORDED');
  wait.resolve({ marked: true, exclusive: true, requestId: f.r.requestId, requestSha256: f.r.requestSha256 });
  await start;
  assert.equal(assertHeld(f.observer).tool, 'NOT_INVOKED');
  assert.deepEqual(f.events, ['consume', 'mark-wx']);
});

test('dispatchBefore is rechecked after confirmed wx marker', async () => {
  const f = fixture({ mark: async ({ request: r }, clock) => {
    clock.advance(START + 100);
    return { marked: true, exclusive: true, requestId: r.requestId, requestSha256: r.requestSha256 };
  } });
  await f.observer.dispatch();
  assert.equal(assertHeld(f.observer).tool, 'NOT_INVOKED');
});

test('earlier outerDeadline wins without extending the response deadline', async () => {
  const f = fixture({ outerDeadline: START + 200 }); await f.observer.dispatch();
  f.clock.advance(START + 200);
  const state = assertHeld(f.observer);
  assert.equal(state.expired, true);
  assert.equal(state.expiresAt, START + 500);
  assert.equal(state.outerDeadline, START + 200);
});

for (const behavior of ['throw', 'non-promise']) {
  test(`publication ${behavior} is ambiguous, sealed, and not retried`, async () => {
    const f = fixture({ publish: () => {
      if (behavior === 'throw') throw Error('TEST_ONLY_COULD_HAVE_SENT');
      return { result: 'not a live Promise' };
    } });
    await f.observer.dispatch(); assertHeld(f.observer);
    await assert.rejects(f.observer.dispatch(), /DISPATCH_ALREADY_CLAIMED/);
    assert.equal(f.events.filter(x => x === 'publish-TEST_ONLY').length, 1);
  });
}

for (const response of ['throw', 'lost', 'duplicate', 'wrong-id', 'wrong-result', 'not-exclusive']) {
  test(`response ${response} holds without publication or response retry`, async () => {
    const f = fixture({ write: async packet => {
      if (response === 'throw') throw Error('TEST_ONLY_RESPONSE_DISK_ERROR');
      if (response === 'lost') return undefined;
      return { written: response !== 'duplicate', exclusive: response !== 'not-exclusive',
        requestId: response === 'wrong-id' ? 'OTHER' : packet.request.requestId,
        requestSha256: packet.request.requestSha256,
        result: response === 'wrong-result' ? unknownResultFixture() : packet.result };
    } });
    await f.succeed(); await f.attachBoth();
    assertHeld(f.observer);
    await assert.rejects(f.observer.dispatch(), /DISPATCH_ALREADY_CLAIMED/);
    assert.equal(f.events.filter(x => x === 'response-wx').length, 1);
    assert.equal(f.events.filter(x => x === 'publish-TEST_ONLY').length, 1);
  });
}
function unknownResultFixture() { return { status: 'FAILED', outcome: 'UNKNOWN', code: 'UNKNOWN' }; }

test('lost pending response acknowledgement retains original Promise and late confirmed fact', async () => {
  const wait = deferred(); let packet;
  const f = fixture({ write: input => { packet = input; return wait.promise; } });
  await f.observer.dispatch(); f.pending.resolve(successfulRaw()); await flush();
  assert.equal(assertHeld(f.observer).response, 'WRITE_PENDING');
  // The port itself is async, so the exact returned wrapper Promise is retained.
  const originalResponse = f.observer.liveResponsePromise;
  assert.ok(originalResponse instanceof Promise);
  f.clock.advance(START + 600); assertHeld(f.observer);
  wait.resolve({ written: true, exclusive: true, requestId: packet.request.requestId,
    requestSha256: packet.request.requestSha256, result: packet.result });
  await f.observer.settlementPromise;
  assert.equal(f.observer.liveResponsePromise, originalResponse);
  assert.equal(assertHeld(f.observer).response, 'WRITTEN_EXACT_LATE');
});

test('non-Promise response adapter return is uncertain and cannot be used as a confirmed write', async () => {
  const f = fixture();
  const altered = { ...f.config, testOnlyPort: { ...f.port, writeResponseOnce: packet => ({
    written: true, exclusive: true, requestId: packet.request.requestId,
    requestSha256: packet.request.requestSha256, result: packet.result,
  }) } };
  const observer = createDispatchObserver(altered); await observer.dispatch();
  f.pending.resolve(successfulRaw()); await observer.settlementPromise;
  assert.equal(assertHeld(observer).response, 'WRITE_UNCERTAIN');
});

test('DEADLINE_REGRESSION: timely response preserves the original post-publication read and exit phases', async () => {
  const publicationCutoff = START + 165_500;
  const f = fixture({ expiresAt: publicationCutoff, dispatchBefore: publicationCutoff - 165_000,
    outerDeadline: publicationCutoff + 120_000, outcomePhaseEntryAt: publicationCutoff - 5 });
  await f.observer.dispatch();
  f.clock.advance(publicationCutoff - 10);
  f.pending.resolve(successfulRaw()); await f.observer.settlementPromise;
  f.clock.advance(publicationCutoff);
  assert.equal(assertHeld(f.observer).status, 'WAITING_ORIGINAL_EVIDENCE');
  f.outcomeFact.observedAt = publicationCutoff + 10;
  f.clock.advance(f.outcomeFact.observedAt);
  await f.observer.observeReadOutcome(f.outcomes.issue(f.outcomeFact));
  // Native final-read completed in its own window. Original wrapper/child may
  // still use the separate local-report/exit reserve after that read cutoff.
  f.terminalFact.observedAt = Date.parse(f.outcomeFact.originalRequest.expiresAt) + 10;
  f.clock.advance(f.terminalFact.observedAt);
  await f.observer.observeOriginalTerminal(f.terminals.issue(f.terminalFact));
  assert.equal(f.observer.snapshot().status, 'TEST_ONLY_VERIFIED');
  assert.equal(f.observer.snapshot().expired, false);
  assert.equal(f.events.filter(x => x === 'response-wx').length, 1);
});

test('original READ_OUTCOME request can be bound early and expires only its still-pending read', async () => {
  const f = fixture(); await f.succeed();
  await f.observer.observeReadOutcomeRequest(f.outcomes.issue({ kind: 'READ_OUTCOME_REQUEST',
    expected: f.expected, originalRequest: f.outcomeFact.originalRequest }));
  const cutoff = Date.parse(f.outcomeFact.originalRequest.expiresAt);
  assert.equal(f.observer.snapshot().outcomeDeadline, cutoff);
  f.clock.advance(START + 500);
  assert.equal(f.observer.snapshot().expired, false);
  f.clock.advance(cutoff);
  assert.equal(assertHeld(f.observer).status, 'UNKNOWN');
  assert.ok(f.observer.snapshot().faults.includes('ORIGINAL_READ_OUTCOME_DEADLINE_EXPIRED'));
});

test('timely READ_OUTCOME removes only its read timer, retaining the original outer deadline', async () => {
  const f = fixture(); await f.succeed();
  await f.observer.observeReadOutcomeRequest(f.outcomes.issue({ kind: 'READ_OUTCOME_REQUEST',
    expected: f.expected, originalRequest: f.outcomeFact.originalRequest }));
  await f.observer.observeReadOutcome(f.outcomes.issue(f.outcomeFact));
  f.clock.advance(Date.parse(f.outcomeFact.originalRequest.expiresAt));
  assert.equal(f.observer.snapshot().expired, false);
  assertHeld(f.observer);
  f.clock.advance(f.expected.outerDeadline);
  assert.ok(assertHeld(f.observer).faults.includes('ORIGINAL_OUTER_DEADLINE_EXPIRED'));
});

test('missing original read request never invents an outcome deadline or permits completion', async () => {
  const f = fixture(); await f.succeed(); f.clock.advance(START + 50_000);
  assert.equal(assertHeld(f.observer).outcomeDeadline, null);
  assert.equal(f.observer.snapshot().expired, false);
  f.clock.advance(f.expected.outerDeadline);
  assert.equal(assertHeld(f.observer).status, 'UNKNOWN');
});

for (const changed of ['requestId', 'requestSha256', 'sql', 'expiresAt']) {
  test(`original READ_OUTCOME cannot change ${changed} after being bound`, async () => {
    const f = fixture(); await f.succeed();
    await f.observer.observeReadOutcomeRequest(f.outcomes.issue({ kind: 'READ_OUTCOME_REQUEST',
      expected: f.expected, originalRequest: f.outcomeFact.originalRequest }));
    const oldCutoff = f.observer.snapshot().outcomeDeadline;
    const changedFact = structuredClone(f.outcomeFact);
    if (changed === 'sql') changedFact.originalRequest.payload.sql = 'TEST_ONLY_OTHER_READ';
    else if (changed === 'expiresAt') {
      changedFact.originalRequest.expiresAt = new Date(oldCutoff + 1).toISOString();
      changedFact.originalRequest.payload.dispatchBefore = new Date(oldCutoff + 1 - 25_000).toISOString();
    } else changedFact.originalRequest[changed] = 'TEST_ONLY_CHANGED';
    await f.observer.observeReadOutcome(f.outcomes.issue(changedFact));
    assert.equal(assertHeld(f.observer).outcomeDeadline, oldCutoff);
    assert.equal(f.observer.snapshot().outcome, 'MISSING_OR_UNVERIFIED');
  });
}

for (const changed of ['missing-request', 'outer-reserve', 'dispatch-reserve', 'wrong-project', 'wrong-kind', 'late-result']) {
  test(`original READ_OUTCOME ${changed} is held under its own original boundary`, async () => {
    const f = fixture(); await f.succeed(); const fact = structuredClone(f.outcomeFact);
    if (changed === 'missing-request') delete fact.originalRequest;
    if (changed === 'outer-reserve') {
      const cutoff = f.expected.outerDeadline - 60_000 + 1;
      fact.originalRequest.expiresAt = new Date(cutoff).toISOString();
      fact.originalRequest.payload.dispatchBefore = new Date(cutoff - 25_000).toISOString();
    }
    if (changed === 'dispatch-reserve') fact.originalRequest.payload.dispatchBefore = new Date(START + 1).toISOString();
    if (changed === 'wrong-project') fact.originalRequest.payload.projectId = 'OTHER';
    if (changed === 'wrong-kind') fact.originalRequest.kind = 'PUBLISH';
    if (changed === 'late-result') {
      fact.observedAt = Date.parse(fact.originalRequest.expiresAt);
      f.clock.advance(fact.observedAt);
    }
    await f.observer.observeReadOutcome(f.outcomes.issue(fact));
    assert.equal(assertHeld(f.observer).outcome, 'MISSING_OR_UNVERIFIED');
  });
}

test('saved READ_OUTCOME request JSON cannot bind or extend a phase deadline', async () => {
  const f = fixture(); await f.succeed();
  await f.observer.observeReadOutcomeRequest({ kind: 'READ_OUTCOME_REQUEST', expected: f.expected,
    originalRequest: f.outcomeFact.originalRequest });
  assert.equal(assertHeld(f.observer).outcomeDeadline, null);
});

test('duplicate resolutions of one original Promise cannot create a second response', async () => {
  const f = fixture(); await f.observer.dispatch();
  const first = successfulRaw([{ first: true }]); f.pending.resolve(first);
  f.pending.resolve({ isError: true }); f.pending.reject(Error('ignored second settlement'));
  await f.observer.settlementPromise;
  assert.equal(f.observer.rawToolFact.value, first);
  assert.equal(f.events.filter(x => x === 'response-wx').length, 1);
});

for (const problem of ['pending-child', 'nonzero-child', 'nonzero-wrapper', 'signal', 'not-reaped',
  'lost-session', 'lost-launch', 'wrong-session', 'wrong-launch', 'late-terminal', 'before-invocation',
  'future-terminal', 'wrong-tuple', 'json-forgery']) {
  test(`original child ${problem} keeps source held`, async () => {
    const f = fixture(); await f.succeed();
    const fact = structuredClone(f.terminalFact);
    if (problem === 'pending-child') fact.child.state = 'RUNNING';
    if (problem === 'nonzero-child') fact.child.exitCode = 1;
    if (problem === 'nonzero-wrapper') fact.wrapper.exitCode = 1;
    if (problem === 'signal') fact.child.signal = 'SIGKILL';
    if (problem === 'not-reaped') fact.child.reaped = false;
    if (problem === 'lost-session') fact.originalSessionId = null;
    if (problem === 'lost-launch') fact.originalLaunchSha256 = null;
    if (problem === 'wrong-session') fact.originalSessionId = 'OTHER';
    if (problem === 'wrong-launch') fact.originalLaunchSha256 = 'OTHER';
    if (problem === 'late-terminal') fact.observedAt = f.expected.outerDeadline;
    if (problem === 'before-invocation') fact.observedAt = START - 1;
    if (problem === 'future-terminal') fact.observedAt = START + 31;
    if (problem === 'wrong-tuple') fact.expected.tuple.batchId = 'OTHER';
    await f.observer.observeOriginalTerminal(problem === 'json-forgery' ? fact : f.terminals.issue(fact));
    await f.observer.observeReadOutcome(f.outcomes.issue(f.outcomeFact));
    assert.equal(assertHeld(f.observer).terminal, 'MISSING_FAILED_OR_IDENTITY_LOST');
  });
}

for (const problem of ['unknown', 'rollback', 'before-invocation', 'future-outcome', 'wrong-tuple', 'wrong-kind', 'json-forgery']) {
  test(`READ_OUTCOME ${problem} keeps source held`, async () => {
    const f = fixture(); await f.succeed();
    await f.observer.observeOriginalTerminal(f.terminals.issue(f.terminalFact));
    const fact = structuredClone(f.outcomeFact);
    if (problem === 'unknown') fact.state = 'UNKNOWN';
    if (problem === 'rollback') fact.state = 'ROLLED_BACK_EXACT';
    if (problem === 'before-invocation') fact.observedAt = START - 1;
    if (problem === 'future-outcome') fact.observedAt = START + 31;
    if (problem === 'wrong-tuple') fact.expected.tuple.batchId = 'OTHER';
    if (problem === 'wrong-kind') fact.kind = 'PUBLISH';
    await f.observer.observeReadOutcome(problem === 'json-forgery' ? fact : f.outcomes.issue(fact));
    assertHeld(f.observer);
  });
}

test('missing authority functions do not accept success-shaped JSON tokens', async () => {
  const f = fixture({ config: { originalTerminalAuthority: {}, readOutcomeAuthority: {} } });
  await f.succeed();
  await f.observer.observeOriginalTerminal(f.terminalFact);
  await f.observer.observeReadOutcome(f.outcomeFact);
  assertHeld(f.observer);
});

test('restart ignores saved success-shaped JSON and can only observe the original READ_OUTCOME', async () => {
  const f = fixture(); await f.succeed(); await f.attachBoth();
  const restored = restoreDispatchObserver({ request: f.r, expected: f.expected,
    readOutcomeAuthority: f.outcomes, now: f.clock.now,
    status: 'TEST_ONLY_VERIFIED', terminal: f.terminalFact, response: { written: true } });
  await assert.rejects(restored.dispatch(), /REAL_CONNECTOR_PORT_DISABLED/);
  await restored.observeOriginalTerminal(f.terminals.issue(f.terminalFact));
  await restored.observeReadOutcome(f.outcomes.issue(f.outcomeFact));
  const state = assertHeld(restored);
  assert.equal(state.status, 'UNKNOWN');
  assert.equal(state.mode, 'RESTORED_READ_ONLY');
  assert.equal(state.hasLiveToolPromise, false);
  assert.equal(state.outcome, 'COMMITTED_EXACT');
  assert.equal(f.events.filter(x => x === 'publish-TEST_ONLY').length, 1);
});

test('mutating caller request and port after construction cannot swap the retained call', async () => {
  const f = fixture(); f.r.payload.sql = 'OTHER';
  f.port.publish = () => { throw Error('MUTATED_PORT_MUST_NOT_RUN'); };
  await f.observer.dispatch();
  assert.equal(f.observer.liveToolPromise, f.pending.promise);
  assert.equal(f.events.filter(x => x === 'publish-TEST_ONLY').length, 1);
});

test('contradictory evidence after synthetic completion revokes completion and retains hold', async () => {
  const f = fixture(); await f.succeed(); await f.attachBoth();
  assert.equal(f.observer.snapshot().testOnlyCompletionVerified, true);
  await f.observer.observeOriginalTerminal({ exitCode: 0 });
  assertHeld(f.observer);
});

test('late tool failure cannot complete even with both positive independent evidence tokens', async () => {
  const f = fixture(); await f.observer.dispatch();
  f.pending.reject(Error('TEST_ONLY_AMBIGUOUS_TOOL_REJECTION')); await f.observer.settlementPromise;
  await f.attachBoth(); assertHeld(f.observer);
});

test('production connector, timers-as-renewal, retry, direct-PG and network code are absent', async () => {
  const source = await readFile(new URL('./dispatch-observer.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Promise\.race\s*\(|setInterval\s*\(|execute_sql|\bfetch\s*\(|node:(?:https?|net|tls|child_process)|from\s+['"]pg['"]/);
  assert.doesNotMatch(source, /process\.env|LEASE_RENEW|LEASE_ACQUIRE|CREATE_PENDING/);
});
