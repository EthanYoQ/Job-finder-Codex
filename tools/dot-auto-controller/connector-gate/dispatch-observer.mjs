/** Inactive offline contract. This module has no official connector, network,
 * credential, child-launch, durable-ledger, or source-release implementation. */
const TEST_PORT = 'TEST_ONLY_SYNTHETIC_PORT';
// Preserved cloudSourcePilotRelay.PILOT_BUDGET values, not renewed budgets.
const ORIGINAL_CONTROL_MS = 60_000;
const ORIGINAL_CONTROL_COMPLETION_MS = 25_000;

/** Evidence is JSON-shaped data plus actual undefined values. Do not clone
 * authority tokens, Promises, errors, functions, host objects, or prototypes.
 * Accessors are rejected without invoking them. Array holes and custom array
 * properties are outside the original JSON contract and fail closed. */
export function cloneEvidenceData(value) {
  const active = new WeakSet();
  function clone(item) {
    if (item === null || item === undefined || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw Error('EVIDENCE_NUMBER_NOT_FINITE');
      return item;
    }
    if (typeof item !== 'object') throw Error('EVIDENCE_NON_DATA_VALUE');
    const array = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (prototype !== (array ? Array.prototype : Object.prototype)) throw Error('EVIDENCE_PROTOTYPE');
    if (active.has(item)) throw Error('EVIDENCE_CYCLE');
    active.add(item);
    try {
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => typeof key !== 'string')) throw Error('EVIDENCE_SYMBOL_KEY');
      if (array && (keys.length !== item.length + 1 ||
          keys.some(key => key !== 'length' && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)))) {
        throw Error('EVIDENCE_ARRAY_SHAPE');
      }
      const result = array ? [] : {};
      for (const key of keys) {
        if (array && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value') || !descriptor.enumerable) {
          throw Error('EVIDENCE_PROPERTY_DESCRIPTOR');
        }
        // defineProperty safely retains an own "__proto__" data property.
        Object.defineProperty(result, key, { value: clone(descriptor.value),
          enumerable: true, configurable: true, writable: true });
      }
      return result;
    } finally { active.delete(item); }
  }
  return clone(value);
}

/** Validate both sides before comparison, including even identical references.
 * Object key order is irrelevant. undefined and absent, and -0 and 0, differ. */
export function equalEvidenceData(left, right) {
  const a = cloneEvidenceData(left), b = cloneEvidenceData(right);
  function equal(x, y) {
    if (Object.is(x, y)) return true;
    if (x === null || y === null || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) !== Array.isArray(y)) return false;
    const xKeys = Object.keys(x), yKeys = Object.keys(y);
    return xKeys.length === yKeys.length && xKeys.every(key =>
      Object.prototype.hasOwnProperty.call(y, key) && equal(x[key], y[key]));
  }
  return equal(a, b);
}
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const copy = value => freeze(cloneEvidenceData(value));
const time = value => {
  const n = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(n)) throw Error('ORIGINAL_DEADLINE_REQUIRED');
  return n;
};
const unknownResult = () => ({ status: 'FAILED', outcome: 'UNKNOWN', code: 'UNKNOWN' });

// Mirrors only the original successful response envelope. An exception or
// error envelope is never proof of cancellation, non-dispatch, or rollback.
function resultFromRaw(raw) {
  try {
    if (!raw || raw.isError) return unknownResult();
    const text = raw.structuredContent?.result ??
      JSON.parse(raw.content.find(item => item.type === 'text').text).result;
    if (typeof text !== 'string') return unknownResult();
    const match = text.match(/\n<untrusted-data-[^>]+>\n([\s\S]*?)\n<\/untrusted-data-/);
    const rows = match && JSON.parse(match[1]);
    return Array.isArray(rows) ? { status: 'SUCCEEDED', rows } : unknownResult();
  } catch {
    return unknownResult();
  }
}

/** consumeAuthorization must be a trusted composition-root closure, e.g. the
 * deterministic gate's private WeakMap consumer, not a configurable predicate.
 * The two authority.accept functions likewise validate in-process opaque
 * tokens. No JSON digest is an authorization or original-child capability.
 *
 * TEST_ONLY callbacks are synthetic, trusted test code, not a security sandbox.
 * No mode in this module enables a real publication port. */
export function createDispatchObserver({
  request,
  authorization,
  consumeAuthorization,
  originalTerminalAuthority,
  readOutcomeAuthority,
  mode = 'DISABLED',
  testOnlyPort,
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  restored = false,
  restoredExpected,
} = {}) {
  const fixedRequest = copy(request);
  if (!fixedRequest || fixedRequest.kind !== 'PUBLISH') throw Error('PUBLISH_REQUEST_REQUIRED');
  const expiresAt = time(fixedRequest.expiresAt);
  const dispatchBefore = time(fixedRequest.payload?.dispatchBefore);
  if (dispatchBefore > expiresAt) throw Error('ORIGINAL_DEADLINE_ORDER');
  const enabled = mode === 'TEST_ONLY' && !restored;
  if (!['DISABLED', 'TEST_ONLY'].includes(mode)) throw Error('REAL_CONNECTOR_PORT_DISABLED');
  if (enabled && (testOnlyPort?.kind !== TEST_PORT ||
      ['markIntent', 'publish', 'writeResponseOnce'].some(key => typeof testOnlyPort[key] !== 'function') ||
      typeof consumeAuthorization !== 'function')) throw Error('TEST_ONLY_PORT_AND_GATE_REQUIRED');
  // Capture function identity once. Mutating the caller's port object later
  // cannot swap its publication callback or authority verifier.
  const markIntent = testOnlyPort?.markIntent;
  const publish = testOnlyPort?.publish;
  const writeResponseOnce = testOnlyPort?.writeResponseOnce;
  const acceptTerminal = originalTerminalAuthority?.accept;
  const acceptOutcome = readOutcomeAuthority?.accept;
  let claimed = restored;
  let stage = restored ? 'RESTORED' : 'READY';
  let expected = restored ? copy(restoredExpected) : null;
  let outerDeadline = restoredExpected?.outerDeadline ?? null;
  let originalOutcomeRequest = null;
  let outcomeDeadline = null;
  let expired = restored;
  let timer;
  let intent = 'NOT_ATTEMPTED';
  let tool = 'NOT_INVOKED';
  let response = 'NOT_ATTEMPTED';
  let terminal = 'MISSING';
  let outcome = 'MISSING';
  let terminalFact = null;
  let outcomeFact = null;
  let rawToolFact = null;
  let invokedAt = null;
  let originalToolPromise = null;
  let originalResponsePromise = null;
  let observationPromise = null;
  let completionVerified = false;
  const faults = [];
  if (restored) faults.push('RESTART_LOST_LIVE_AUTHORITY');

  const fault = code => {
    completionVerified = false;
    if (!faults.includes(code)) faults.push(code);
  };
  const clearTimer = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  const observeDeadline = () => {
    if (!completionVerified && claimed && !restored) {
      const at = now();
      // PUBLISH expiresAt bounds only publication/response. A timely completed
      // response leaves the original READ_OUTCOME and wrapper-exit reserves.
      if (response !== 'WRITTEN_EXACT' && at >= expiresAt) {
        expired = true;
        fault('ORIGINAL_PUBLICATION_RESPONSE_DEADLINE_EXPIRED');
      }
      if (outcomeDeadline !== null && outcome !== 'COMMITTED_EXACT' && at >= outcomeDeadline) {
        expired = true;
        fault('ORIGINAL_READ_OUTCOME_DEADLINE_EXPIRED');
      }
      if (outerDeadline !== null && at >= outerDeadline) {
        expired = true;
        fault('ORIGINAL_OUTER_DEADLINE_EXPIRED');
      }
      if (expired) clearTimer();
    }
    return snapshot();
  };
  const nextDeadline = () => Math.min(
    response !== 'WRITTEN_EXACT' ? expiresAt : Infinity,
    outcomeDeadline !== null && outcome !== 'COMMITTED_EXACT' ? outcomeDeadline : Infinity,
    outerDeadline ?? Infinity,
  );
  const armTimer = () => {
    clearTimer();
    if (expired || completionVerified || restored) return;
    const left = nextDeadline() - now();
    if (left <= 0) { observeDeadline(); return; }
    // Independent one-shot deadline observation. Never races, replaces,
    // cancels, retries, or extends the original publication Promise.
    timer = schedule(() => {
      timer = undefined;
      observeDeadline();
      // A monotonic scheduler may fire early relative to a wall-clock value.
      // Re-arm only to the SAME absolute deadline, never a renewed budget.
      if (!expired && !completionVerified) armTimer();
    }, Math.min(left, 2 ** 31 - 1));
    timer?.unref?.();
  };
  const snapshot = () => copy({
    mode: restored ? 'RESTORED_READ_ONLY' : mode,
    status: restored || expired || faults.length ? 'UNKNOWN' :
      !enabled ? 'DISABLED' : completionVerified ? 'TEST_ONLY_VERIFIED' : stage,
    requestId: fixedRequest.requestId,
    requestSha256: fixedRequest.requestSha256,
    dispatchBefore, expiresAt, outcomeDeadline, outerDeadline, expired,
    intent, tool, response, terminal, outcome,
    hasLiveToolPromise: originalToolPromise !== null,
    hasLiveResponsePromise: originalResponsePromise !== null,
    testOnlyCompletionVerified: completionVerified,
    // This contract never releases a source, even after synthetic success.
    sourceHeld: true, releaseEligible: false, newBatchAllowed: false,
    faults: [...faults],
  });
  const checkCompletion = () => {
    observeDeadline();
    if (!restored && !expired && !faults.length && tool === 'SUCCEEDED' &&
        response === 'WRITTEN_EXACT' && terminal === 'VERIFIED_SUCCESS' && outcome === 'COMMITTED_EXACT') {
      completionVerified = true;
      stage = 'TEST_ONLY_VERIFIED';
      clearTimer();
    } else armTimer();
  };

  // Authority provenance supplies the actual immutable READ_OUTCOME request
  // emitted by the original worker. Never derive a new cutoff from observer
  // now(): the worker already chose min(outer-60s, its phase-entry time+60s).
  const bindOriginalOutcomeRequest = fact => {
    const read = fact.originalRequest;
    if (!read || read.schemaVersion !== 1 || read.kind !== 'READ_OUTCOME' ||
        typeof read.requestId !== 'string' || !read.requestId ||
        typeof read.requestSha256 !== 'string' || !read.requestSha256 ||
        read.payload?.projectId !== fixedRequest.payload.projectId ||
        typeof read.payload.sql !== 'string' || !read.payload.sql) {
      throw Error('ORIGINAL_READ_OUTCOME_REQUEST_REQUIRED');
    }
    const cutoff = time(read.expiresAt);
    if (!Number.isSafeInteger(outerDeadline) || cutoff > outerDeadline - ORIGINAL_CONTROL_MS ||
        time(read.payload.dispatchBefore) !== cutoff - ORIGINAL_CONTROL_COMPLETION_MS ||
        (!restored && (invokedAt === null || cutoff <= invokedAt)) ||
        (originalOutcomeRequest !== null && !equalEvidenceData(read, originalOutcomeRequest))) {
      throw Error('ORIGINAL_READ_OUTCOME_DEADLINE_OR_IDENTITY');
    }
    originalOutcomeRequest ??= copy(read);
    outcomeDeadline ??= cutoff;
  };
  const stillBeforeDispatch = () => {
    observeDeadline();
    if (expired || now() >= dispatchBefore || now() >= outerDeadline) {
      expired = true;
      fault('ORIGINAL_DISPATCH_DEADLINE_EXPIRED');
      clearTimer();
      return false;
    }
    return true;
  };

  async function settleTool(type, value) {
    rawToolFact = Object.freeze({ type, value, observedAt: now() });
    const result = type === 'FULFILLED' ? resultFromRaw(value) : unknownResult();
    tool = result.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED_UNKNOWN';
    if (tool !== 'SUCCEEDED') fault(type === 'REJECTED' ? 'TOOL_REJECTED_UNKNOWN' : 'TOOL_RESULT_UNKNOWN');
    observeDeadline();
    if (expired) {
      response = 'NOT_WRITTEN_EXPIRED';
      return snapshot();
    }
    // This is a response to the real, settled synthetic invocation. There is
    // no synthesized timeout response and no write after observed expiry.
    response = 'WRITE_PENDING';
    stage = 'RESPONSE_PENDING';
    const packet = Object.freeze({ request: fixedRequest, result: copy(result), rawToolFact, flag: 'wx' });
    try {
      originalResponsePromise = writeResponseOnce(packet);
      if (!(originalResponsePromise instanceof Promise)) {
        originalResponsePromise = null;
        response = 'WRITE_UNCERTAIN';
        fault('ORIGINAL_RESPONSE_PROMISE_REQUIRED');
        return snapshot();
      }
      const receipt = await originalResponsePromise;
      observeDeadline();
      if (!receipt || receipt.written !== true || receipt.exclusive !== true ||
          receipt.requestId !== fixedRequest.requestId ||
          receipt.requestSha256 !== fixedRequest.requestSha256 ||
          !equalEvidenceData(receipt.result, result)) {
        response = 'WRITE_UNCERTAIN';
        fault('RESPONSE_NOT_CONFIRMED_EXACT');
      } else {
        response = expired ? 'WRITTEN_EXACT_LATE' : 'WRITTEN_EXACT';
        stage = 'WAITING_ORIGINAL_EVIDENCE';
      }
    } catch {
      response = 'WRITE_FAILED_OR_UNCERTAIN';
      fault('RESPONSE_WRITE_FAILED_OR_UNCERTAIN');
    }
    checkCompletion();
    return snapshot();
  }

  async function start() {
    stage = 'AUTHORIZING';
    armTimer();
    let grant;
    try {
      grant = await consumeAuthorization(authorization, fixedRequest);
      if (!grant || grant.mode !== 'OFFLINE_REVIEW_ONLY' ||
          !equalEvidenceData(grant.request, fixedRequest) ||
          grant.dispatchBefore !== dispatchBefore || grant.expiresAt !== expiresAt ||
          !Number.isSafeInteger(grant.outerDeadline) ||
          !grant.tuple || typeof grant.tuple !== 'object' || Array.isArray(grant.tuple)) {
        throw Error('GATE_GRANT_BINDING');
      }
      outerDeadline = grant.outerDeadline;
      expected = copy({ requestId: fixedRequest.requestId, requestSha256: fixedRequest.requestSha256,
        tuple: grant.tuple, outerDeadline });
      armTimer();
    } catch {
      fault('AUTHORIZATION_INVALID_OR_CONSUMED');
      stage = 'HELD';
      return snapshot();
    }
    if (!stillBeforeDispatch()) return snapshot();
    // Seal before entering the wx boundary: a failed/missing result may mean
    // its exclusive intent file was created. This observer never tries again.
    intent = 'MAY_HAVE_BEEN_RECORDED';
    stage = 'INTENT_PENDING';
    try {
      const receipt = await markIntent(Object.freeze({ request: fixedRequest, expected, flag: 'wx' }));
      if (!receipt || receipt.marked !== true || receipt.exclusive !== true ||
          receipt.requestId !== fixedRequest.requestId ||
          receipt.requestSha256 !== fixedRequest.requestSha256) {
        intent = 'UNCERTAIN';
        fault('DISPATCH_INTENT_UNCERTAIN');
        return snapshot();
      }
      intent = 'RECORDED_EXCLUSIVE';
    } catch {
      intent = 'FAILED_OR_UNCERTAIN';
      fault('DISPATCH_INTENT_FAILED_OR_UNCERTAIN');
      return snapshot();
    }
    if (!stillBeforeDispatch()) return snapshot();
    tool = 'MAY_HAVE_BEEN_INVOKED';
    stage = 'TOOL_PENDING';
    invokedAt = now();
    try {
      const promise = publish(Object.freeze({ request: fixedRequest, expected, testOnly: true }));
      if (!(promise instanceof Promise)) {
        fault('ORIGINAL_NATIVE_PROMISE_REQUIRED');
        tool = 'CALL_UNCERTAIN';
        return snapshot();
      }
      originalToolPromise = promise; // Exact Promise identity, not a race/wrapper.
      tool = 'PENDING';
      observationPromise = originalToolPromise.then(
        raw => settleTool('FULFILLED', raw),
        error => settleTool('REJECTED', error),
      ).catch(() => {
        fault('OBSERVER_SETTLEMENT_FAILED');
        return snapshot();
      });
    } catch (error) {
      // A callback can throw after dispatch. Never assume it did not dispatch.
      rawToolFact = Object.freeze({ type: 'THREW', value: error, observedAt: now() });
      tool = 'CALL_UNCERTAIN';
      fault('TOOL_CALL_THROW_UNKNOWN');
    }
    return snapshot();
  }

  return Object.freeze({
    dispatch() {
      if (!enabled || restored) return Promise.reject(Error('REAL_CONNECTOR_PORT_DISABLED'));
      if (claimed) return Promise.reject(Error('DISPATCH_ALREADY_CLAIMED'));
      claimed = true; // Synchronous seal, before authorization can await.
      return start();
    },
    snapshot() { observeDeadline(); return snapshot(); },
    observeDeadline,
    // Exact live objects for the owning observer only. None is serialized by
    // snapshot(); no external "accept a response" method can forge settlement.
    get liveToolPromise() { return originalToolPromise; },
    get liveResponsePromise() { return originalResponsePromise; },
    get settlementPromise() { return observationPromise; },
    get rawToolFact() { return rawToolFact; },
    get originalEvidence() { return copy({ terminal: terminalFact, outcome: outcomeFact }); },
    async observeReadOutcomeRequest(token) {
      try {
        if (!expected || typeof acceptOutcome !== 'function') throw Error('ORIGINAL_READ_OUTCOME_AUTHORITY_REQUIRED');
        const fact = await acceptOutcome(token, expected);
        if (!fact || fact.kind !== 'READ_OUTCOME_REQUEST' || !equalEvidenceData(fact.expected, expected)) {
          throw Error('ORIGINAL_READ_OUTCOME_REQUEST_NOT_BOUND');
        }
        bindOriginalOutcomeRequest(fact);
      } catch {
        fault('ORIGINAL_READ_OUTCOME_REQUEST_NOT_VERIFIED');
      }
      checkCompletion();
      return snapshot();
    },
    async observeOriginalTerminal(token) {
      if (restored) { fault('RESTART_CANNOT_RECREATE_ORIGINAL_CHILD'); return snapshot(); }
      try {
        if (!expected || typeof acceptTerminal !== 'function') throw Error('LIVE_TERMINAL_AUTHORITY_REQUIRED');
        const fact = await acceptTerminal(token, expected);
        if (!fact || fact.kind !== 'ORIGINAL_CHILD_TERMINAL' || !equalEvidenceData(fact.expected, expected) ||
            invokedAt === null || !Number.isSafeInteger(fact.observedAt) || fact.observedAt < invokedAt ||
            fact.observedAt > now() || fact.observedAt >= outerDeadline ||
            !fact.originalSessionId || !fact.originalLaunchSha256 ||
            (expected.tuple.originalSessionId !== undefined && fact.originalSessionId !== expected.tuple.originalSessionId) ||
            (expected.tuple.originalLaunchSha256 !== undefined && fact.originalLaunchSha256 !== expected.tuple.originalLaunchSha256) ||
            ['wrapper', 'child'].some(key => fact[key]?.state !== 'TERMINATED' ||
              fact[key].exitCode !== 0 || fact[key].signal != null || fact[key].reaped !== true)) {
          throw Error('ORIGINAL_CHILD_NOT_SUCCESSFULLY_TERMINAL');
        }
        terminalFact = copy(fact);
        terminal = 'VERIFIED_SUCCESS';
      } catch {
        terminal = 'MISSING_FAILED_OR_IDENTITY_LOST';
        fault('ORIGINAL_CHILD_TERMINAL_NOT_VERIFIED');
      }
      checkCompletion();
      return snapshot();
    },
    async observeReadOutcome(token) {
      try {
        if (!expected || typeof acceptOutcome !== 'function') throw Error('ORIGINAL_READ_OUTCOME_AUTHORITY_REQUIRED');
        const fact = await acceptOutcome(token, expected);
        if (!fact || fact.kind !== 'READ_OUTCOME' || !equalEvidenceData(fact.expected, expected) ||
            !Number.isSafeInteger(fact.observedAt) || fact.observedAt > now() ||
            (!restored && (invokedAt === null || fact.observedAt < invokedAt)) ||
            !['COMMITTED_EXACT', 'ROLLED_BACK_EXACT', 'UNKNOWN'].includes(fact.state)) {
          throw Error('READ_OUTCOME_NOT_BOUND');
        }
        bindOriginalOutcomeRequest(fact);
        if (fact.observedAt >= outcomeDeadline) throw Error('ORIGINAL_READ_OUTCOME_NOT_TIMELY');
        outcomeFact = copy(fact);
        outcome = fact.state;
        if (outcome !== 'COMMITTED_EXACT') fault('READ_OUTCOME_NOT_COMMITTED_EXACT');
      } catch {
        outcome = 'MISSING_OR_UNVERIFIED';
        fault('READ_OUTCOME_NOT_VERIFIED');
      }
      checkCompletion();
      return snapshot();
    },
  });
}

/** Recovery data is context only, never a live capability or dispatch permit.
 * No caller-supplied status, response, terminal JSON, or hash is restored. */
export function restoreDispatchObserver({ request, expected, readOutcomeAuthority, now } = {}) {
  return createDispatchObserver({ request, restoredExpected: expected,
    readOutcomeAuthority, now, restored: true, mode: 'DISABLED' });
}
