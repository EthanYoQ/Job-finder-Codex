import { TARGET, LIMITS, ACTIONS, UNBOUND_PORT, VerificationHold, BrowserProtocolTimeout,
  requireFact, validateExpected, validateObservation } from './contract.mjs';
import { comparePublicList, compareSourceMinute } from './compare.mjs';

const usedPorts = new WeakSet();
const wallIso = () => new Date().toISOString();
// functions isolates expose Date, not Node performance or structuredClone.
// Detect a backwards wall-clock jump rather than extending a deadline silently.
const clone = value => JSON.parse(JSON.stringify(value));
function rejectedObservationFacts(o) {
  // Never persist unknown extra fields, arbitrary URLs, raw DOM, error bodies, or session objects.
  return { receivedObject: o !== null && typeof o === 'object',
    websiteMatched: o?.websiteUrl === TARGET.websiteUrl, sourceMatched: o?.sourceId === TARGET.sourceId,
    companyMatched: o?.companyId === TARGET.companyId,
    state: ['READY','LOADING','ERROR','DENIED'].includes(o?.state) ? o.state : 'UNKNOWN',
    errorBanner: typeof o?.errorBanner === 'boolean' ? o.errorBanner : null,
    consentState: ['ACCEPTED','EXISTING_REQUIRED','CHANGED','UNKNOWN','DENIED'].includes(o?.consent?.state)
      ? o.consent.state : 'UNKNOWN',
    receivedJobCount: Array.isArray(o?.jobs) ? o.jobs.length : null };
}

/** Construct once per reviewed invocation. No automatic retry or restart/resume. */
export function createPublicVerifier({ expected, port = UNBOUND_PORT } = {}) {
  const events = [], comparisons = [];
  let runStarted = false, reloadCount = 0, waitsTotal = 0, stepCount = 0;
  let deadline, pendingOperation = null, lateError = null, inFlight = null;
  let actionOutcomeUnknown = false;
  let lastClock = -Infinity;
  const clockNow = () => {
    const now = Date.now();
    requireFact(now >= lastClock, 'HOST_CLOCK_MOVED_BACKWARD'); lastClock = now; return now;
  };
  const baseResult = () => ({ schemaVersion: 1, batchId: expected?.batchId ?? null,
    sourceId: TARGET.sourceId, companyId: TARGET.companyId, websiteUrl: TARGET.websiteUrl,
    expectedFileSha256: expected?.expectedFileSha256 ?? null, ordinaryReloadCount: reloadCount,
    scope: 'PUBLIC_LIST_AND_SOURCE_MINUTE_ONLY', detailVerification: 'UNKNOWN',
    applicationVerification: 'NOT_TESTED', allSourcesVerified: false, stabilityDaysVerified: 0,
    releaseEligible: false, newBatchAllowed: false, productionQualified: false,
    comparisons: clone(comparisons), events: clone(events) });
  const append = event => { events.push({ sequence: events.length + 1, ...event }); };

  async function step(action) {
    requireFact(ACTIONS.includes(action), 'ACTION_NOT_ALLOWED');
    requireFact(++stepCount <= LIMITS.steps, 'STEP_BUDGET_EXHAUSTED');
    const stepStartedMs = clockNow();
    const remaining = Math.floor(deadline - stepStartedMs);
    requireFact(remaining > 0, 'TOTAL_DEADLINE_EXPIRED');
    const timeoutMs = Math.min(LIMITS.stepMs, remaining);
    const stepDeadline = stepStartedMs + timeoutMs;
    const request = Object.freeze({ schemaVersion: 1, action, target: TARGET, timeoutMs, deadlineAtMs: stepDeadline });
    const startedAt = wallIso();
    let timer, expired = false, rawOperation = null;
    // Retain the original promise. A deadline does not cancel, replace, or repeat a browser action.
    inFlight = Promise.resolve().then(() => {
      rawOperation = port.execute(request);
      requireFact(rawOperation && typeof rawOperation.then === 'function', 'PORT_DID_NOT_RETURN_PROMISE');
      return rawOperation;
    });
    const original = inFlight;
    const observed = original.then(value => {
      if (expired) {
        const finishedAt = wallIso();
        try {
          validateObservation(value, request, startedAt, finishedAt);
          append({ action, startedAt, finishedAt, outcome: 'LATE_OBSERVATION_NO_CONTINUATION', observation: clone(value) });
        } catch (error) {
          lateError = error;
          append({ action, startedAt, finishedAt, outcome: 'LATE_INVALID_OBSERVATION', code:
            error instanceof VerificationHold ? error.code : 'NON_TIMEOUT_EXCEPTION' });
        }
      }
      return value;
    }, error => {
      if (expired) {
        lateError = error;
        append({ action, startedAt, finishedAt: wallIso(), outcome: 'LATE_ERROR_NO_CONTINUATION',
          code: error instanceof BrowserProtocolTimeout ? 'BROWSER_PROTOCOL_TIMEOUT' : 'NON_TIMEOUT_EXCEPTION' });
      }
      throw error;
    });
    try {
      const value = await Promise.race([observed, new Promise((_, reject) => {
        timer = setTimeout(() => {
          expired = true;
          try { port.invalidateForTimeout?.(); } catch (error) { reject(error); return; }
          reject(new BrowserProtocolTimeout());
        }, timeoutMs);
      })]);
      const finishedAt = wallIso();
      try { validateObservation(value, request, startedAt, finishedAt); }
      catch (error) {
        append({ action, startedAt, finishedAt, outcome: 'REJECTED_OBSERVATION', observedFacts: rejectedObservationFacts(value), code:
          error instanceof VerificationHold ? error.code : 'NON_TIMEOUT_EXCEPTION' });
        throw error;
      }
      // Timers can be delayed behind a tool settlement. Recheck the absolute deadline
      // before accepting its result or taking any next action, even if the timer lost.
      const settledAtMs = clockNow();
      if (settledAtMs >= stepDeadline) {
        append({ action, startedAt, finishedAt, deadlineAt: new Date(stepDeadline).toISOString(),
          outcome: 'SETTLED_AFTER_DEADLINE_NO_CONTINUATION', observation: clone(value) });
        throw new VerificationHold(settledAtMs >= deadline ? 'TOTAL_DEADLINE_EXPIRED' : 'STEP_DEADLINE_EXPIRED');
      }
      append({ action, startedAt, finishedAt, outcome: 'OBSERVED', observation: clone(value) });
      requireFact(clockNow() <= deadline, 'TOTAL_DEADLINE_EXPIRED');
      return value;
    } catch (error) {
      if (error instanceof BrowserProtocolTimeout) {
        port.invalidateForTimeout?.();
        actionOutcomeUnknown = true;
        pendingOperation = expired ? rawOperation : null;
        append({ action, startedAt, finishedAt: wallIso(), outcome: 'TIMEOUT_UNKNOWN_NO_RETRY',
          pendingOperation: expired });
        throw new VerificationHold('BROWSER_PROTOCOL_TIMEOUT');
      }
      if (!(error instanceof VerificationHold)) {
        append({ action, startedAt, finishedAt: wallIso(), outcome: 'NON_TIMEOUT_EXCEPTION_PROPAGATED' });
      }
      throw error;
    } finally { clearTimeout(timer); inFlight = null; }
  }

  function accepted(o) {
    requireFact(o.consent.state === 'ACCEPTED' && o.view !== 'consent', 'UNEXPECTED_CONSENT');
  }
  async function ready(o) {
    let stageWaits = 0;
    while (o.state === 'LOADING') {
      requireFact(stageWaits++ < LIMITS.waitsPerStage && waitsTotal++ < LIMITS.waitsTotal,
        'VISIBLE_LOADING_BUDGET_EXHAUSTED');
      o = await step('WAIT_VISIBLE');
    }
    requireFact(o.state === 'READY', 'UI_NOT_READY');
    return o;
  }
  async function enter(o) {
    o = await ready(o);
    if (o.consent.state === 'EXISTING_REQUIRED') {
      requireFact(o.view === 'consent', 'CONSENT_VIEW_MISMATCH');
      if (!o.consent.checkboxChecked) {
        o = await step('CHECK_EXISTING_CONSENT');
        requireFact(o.state === 'READY' && o.view === 'consent'
          && o.consent.state === 'EXISTING_REQUIRED' && o.consent.checkboxChecked,
        'CONSENT_CHECK_NOT_OBSERVED');
      }
      requireFact(o.consent.entryEnabled, 'CONSENT_ENTER_DISABLED');
      o = await ready(await step('ENTER_EXISTING_CONSENT'));
    }
    accepted(o);
    requireFact(o.view === 'jobs', 'HOME_VIEW_MISMATCH');
    return o;
  }
  async function readList(home) {
    let o=home; accepted(o);
    requireFact(o.state==='READY'&&o.view==='jobs','LIST_NOT_READY');
    // Search omits verified-empty sources. Do not invent a zero-job company card
    // or reject the native total0 result. Still read the actual visible list and
    // verify the independent source directory minute before accepting it.
    if(o.ui.displayedCount!==0){
      o = await ready(await step('EXPAND_COMPANY')); accepted(o);
      requireFact(o.view === 'jobs' && o.ui.companyExpanded, 'COMPANY_NOT_EXPANDED');
      if (o.ui.viewAllVisible) { o = await ready(await step('VIEW_ALL')); accepted(o); }
      requireFact(o.view === 'jobs' && o.ui.companyExpanded && o.ui.allJobsVisible
        && !o.ui.viewAllVisible, 'ALL_JOBS_NOT_OBSERVED');
    }
    o = await step('READ_LIST'); accepted(o);
    requireFact(o.state === 'READY' && o.view === 'jobs' && (o.ui.displayedCount===0||o.ui.companyExpanded
      && o.ui.allJobsVisible && !o.ui.viewAllVisible), 'LIST_NOT_READY');
    const comparison = comparePublicList(expected, o.jobs, o.ui.displayedCount);
    comparisons.push({ kind: 'LIST', reloadCount, observationSequence: events.at(-1).sequence, ...comparison });
    requireFact(comparison.status !== 'MISMATCH', 'PUBLIC_LIST_MISMATCH');
    return comparison;
  }
  async function readSourceTime() {
    let o = await ready(await step('OPEN_DIRECTORY')); accepted(o);
    requireFact(o.view === 'directory', 'DIRECTORY_NOT_OPEN');
    o = await ready(await step('FILTER_COMPANY')); accepted(o);
    requireFact(o.view === 'directory' && o.ui.directoryFiltered, 'DIRECTORY_NOT_FILTERED');
    o = await step('READ_SOURCE_TIME'); accepted(o);
    requireFact(o.state === 'READY' && o.view === 'directory' && o.ui.directoryFiltered, 'SOURCE_TIME_NOT_READY');
    const comparison = compareSourceMinute(expected.observedAt, o.sourceTime);
    comparisons.push({ kind: 'SOURCE_TIME', reloadCount, observationSequence: events.at(-1).sequence, ...comparison });
    requireFact(comparison.status === 'EXACT_MINUTE', 'SOURCE_MINUTE_MISMATCH');
    return comparison;
  }
  async function run() {
    requireFact(!runStarted, 'RUN_ALREADY_STARTED'); runStarted = true;
    try {
      validateExpected(expected); expected = clone(expected);
      requireFact(port && port.enabled === true && ['SYNTHETIC','REVIEWED_PUBLIC_UI'].includes(port.kind)
        && typeof port.execute === 'function', 'BROWSER_PORT_UNBOUND');
      requireFact(port.targetKey === TARGET.key, 'PORT_TARGET_NOT_ALLOWED');
      requireFact(!usedPorts.has(port), 'PORT_ALREADY_USED'); usedPorts.add(port);
      deadline = clockNow() + LIMITS.totalMs;
      const home=await enter(await step('OPEN_HOME'));
      let list = await readList(home);
      await readSourceTime(); // Directory may already be current while the list is still old.
      if (list.status === 'KNOWN_STALE_REMOVALS') {
        requireFact(reloadCount < LIMITS.reloads, 'RELOAD_BUDGET_EXHAUSTED');
        reloadCount++;
        const reloaded=await enter(await step('RELOAD'));
        list = await readList(reloaded);
        await readSourceTime();
      }
      requireFact(list.status === 'EXACT', 'PUBLIC_LIST_STILL_STALE');
      return { ...baseResult(), status: 'PASS_LIST_AND_SOURCE_TIME_ONLY', reason: null };
    } catch (error) {
      if (!(error instanceof VerificationHold)) throw error; // Never disguise ordinary tool/programming errors.
      return { ...baseResult(), status: 'HOLD', reason: error.code,
        pendingActionOutcome: actionOutcomeUnknown ? 'UNKNOWN' : null };
    }
  }
  return Object.freeze({ run, get events() { return clone(events); },
    get pendingOperation() { return pendingOperation; }, get lateError() { return lateError; } });
}

/** Synthetic/unbound convenience only. A real host must retain the controller for late settlements. */
export async function runPublicVerification(options) {
  requireFact(options?.port?.kind !== 'REVIEWED_PUBLIC_UI', 'RETAIN_CONTROLLER_FOR_REAL_PORT');
  return createPublicVerifier(options).run();
}
