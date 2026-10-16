// GENERATED from contract.mjs, compare.mjs, machine.mjs, actual-ax.mjs, cua-port.mjs. No real tools bound.
(() => {

// contract.mjs
/** Public UI only. No tool, browser, database, fetch, filesystem, or session import. */
const TARGET = Object.freeze({
  key: 'takeda-china', websiteUrl: 'https://job.orz.md/',
  sourceId: 'source-takeda-china-social', companyId: 'company-takeda-china',
  companyName: '武田中国', directorySearch: '武田',
  officialEntry: 'https://jobs.takeda.com/location/china-jobs/1113/1814991/2',
});
const LIMITS = Object.freeze({ totalMs: 120_000, stepMs: 15_000,
  reloads: 1, waitsPerStage: 2, waitsTotal: 8, steps: 40, maxJobs: 1000 });
const ACTIONS = Object.freeze(['OPEN_HOME', 'CHECK_EXISTING_CONSENT',
  'ENTER_EXISTING_CONSENT', 'WAIT_VISIBLE', 'EXPAND_COMPANY', 'VIEW_ALL',
  'READ_LIST', 'OPEN_DIRECTORY', 'FILTER_COMPANY', 'READ_SOURCE_TIME', 'RELOAD']);
const UNBOUND_PORT = Object.freeze({ enabled: false, kind: 'UNBOUND' });
const EXISTING_CONSENT_LABEL = '我已阅读并同意 隐私政策 和 服务条款';
class VerificationHold extends Error {
  constructor(code) { super(code); this.name = 'VerificationHold'; this.code = code; }
}
class BrowserProtocolTimeout extends Error {
  constructor() { super('BROWSER_PROTOCOL_TIMEOUT'); this.name = 'BrowserProtocolTimeout'; }
}
function requireFact(value, code) { if (!value) throw new VerificationHold(code); }
function exactKeys(value, keys, code) {
  requireFact(value && typeof value === 'object' && !Array.isArray(value), code);
  const actual = Object.keys(value).sort();
  requireFact(actual.join('\0') === [...keys].sort().join('\0'), code);
}
function iso(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
const sha256Text = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const idText = value => typeof value === 'string' && /^\d{1,20}$/.test(value);
function officialJobUrl(value, id) {
  // Exact fixed public origin/path, without relying on a URL global in functions isolates.
  return typeof value === 'string' && /^https:\/\/jobs\.takeda\.com\/job\/[a-z0-9-]+\/[a-z0-9-]+\/1113\/\d+$/.test(value)
    && value.split('/').at(-1) === id;
}
function validateJob(job, rendered = false) {
  exactKeys(job, rendered ? ['sourceJobId','officialTitle','officialUrl','renderedOriginalTitle']
    : ['sourceJobId','officialTitle','officialUrl'], 'INVALID_JOB_FIELDS');
  requireFact(idText(job.sourceJobId), 'INVALID_JOB_ID');
  requireFact(typeof job.officialTitle === 'string' && job.officialTitle.length > 0
    && job.officialTitle.length <= 2000, 'INVALID_JOB_TITLE');
  requireFact(officialJobUrl(job.officialUrl, job.sourceJobId), 'INVALID_JOB_URL');
  if (rendered) requireFact(typeof job.renderedOriginalTitle === 'string'
    && job.renderedOriginalTitle.length > 0 && job.renderedOriginalTitle.length <= 2000,
  'INVALID_RENDERED_ORIGINAL_TITLE');
}
function validateExpected(expected) {
  exactKeys(expected, ['batchId','sourceId','companyId','observedAt','expectedFileSha256','jobs','removedIds'],
    'INVALID_EXPECTED_FIELDS');
  requireFact(typeof expected.batchId === 'string' && /^[a-zA-Z0-9_-]{1,120}$/.test(expected.batchId), 'INVALID_BATCH');
  requireFact(expected.sourceId === TARGET.sourceId && expected.companyId === TARGET.companyId, 'SOURCE_NOT_ALLOWED');
  requireFact(iso(expected.observedAt) && sha256Text(expected.expectedFileSha256), 'INVALID_EXPECTED_EVIDENCE');
  requireFact(Array.isArray(expected.jobs) && expected.jobs.length > 0 && expected.jobs.length <= LIMITS.maxJobs,
    'EXPECTED_EMPTY_OR_OVERSIZE');
  expected.jobs.forEach(j => validateJob(j));
  const ids = new Set(expected.jobs.map(j => j.sourceJobId));
  requireFact(ids.size === expected.jobs.length, 'DUPLICATE_EXPECTED_ID');
  requireFact(Array.isArray(expected.removedIds) && expected.removedIds.length <= LIMITS.maxJobs
    && expected.removedIds.every(idText) && new Set(expected.removedIds).size === expected.removedIds.length
    && expected.removedIds.every(id => !ids.has(id)), 'INVALID_REMOVED_IDS');
}

// The fields below are only public facts plus bounded protocol observations. Extra keys reject.
function validateObservation(o, request, startedAt, finishedAt) {
  exactKeys(o, ['schemaVersion','action','observedAt','websiteUrl','sourceId','companyId','companyName',
    'view','state','errorBanner','consent','ui','jobs','sourceTime'], 'INVALID_OBSERVATION_FIELDS');
  requireFact(o.schemaVersion === 1 && o.action === request.action, 'PROTOCOL_ACTION_MISMATCH');
  requireFact(iso(o.observedAt) && Date.parse(o.observedAt) >= Date.parse(startedAt)
    && Date.parse(o.observedAt) <= Date.parse(finishedAt), 'UNVERIFIED_OBSERVATION_TIME');
  requireFact(o.websiteUrl === TARGET.websiteUrl && o.sourceId === TARGET.sourceId
    && o.companyId === TARGET.companyId && o.companyName === TARGET.companyName, 'WRONG_TARGET_OR_SOURCE');
  requireFact(['jobs','directory','consent'].includes(o.view), 'UNKNOWN_VIEW');
  requireFact(['READY','LOADING','ERROR','DENIED'].includes(o.state), 'UNKNOWN_UI_STATE');
  requireFact(typeof o.errorBanner === 'boolean', 'UNKNOWN_ERROR_BANNER');
  requireFact(o.state !== 'DENIED', 'EXPLICIT_DENIAL');
  requireFact(o.state !== 'ERROR' && !o.errorBanner, 'ERROR_BANNER');
  exactKeys(o.consent, ['state','recognizedExistingFlow','materialChangeNotice','checkboxLabel',
    'checkboxChecked','entryEnabled'], 'INVALID_CONSENT_FIELDS');
  requireFact(['ACCEPTED','EXISTING_REQUIRED','CHANGED','UNKNOWN','DENIED'].includes(o.consent.state), 'UNKNOWN_CONSENT');
  requireFact(o.consent.state !== 'DENIED', 'EXPLICIT_DENIAL');
  requireFact(o.consent.state !== 'CHANGED' && o.consent.state !== 'UNKNOWN'
    && o.consent.recognizedExistingFlow === true && o.consent.materialChangeNotice === false,
  'CONSENT_CHANGED_OR_UNVERIFIED');
  requireFact(o.consent.checkboxLabel === null || o.consent.checkboxLabel === EXISTING_CONSENT_LABEL,
    'CONSENT_CHANGED_OR_UNVERIFIED');
  if (o.consent.state === 'EXISTING_REQUIRED') requireFact(o.consent.checkboxLabel === EXISTING_CONSENT_LABEL,
    'CONSENT_CHANGED_OR_UNVERIFIED');
  requireFact(typeof o.consent.checkboxChecked === 'boolean' && typeof o.consent.entryEnabled === 'boolean',
    'INVALID_CONSENT_CONTROLS');
  exactKeys(o.ui, ['companyExpanded','viewAllVisible','allJobsVisible','displayedCount','directoryFiltered'],
    'INVALID_UI_FIELDS');
  for (const key of ['companyExpanded','viewAllVisible','allJobsVisible','directoryFiltered'])
    requireFact(typeof o.ui[key] === 'boolean', 'UNKNOWN_UI_CONTROLS');
  requireFact(o.ui.displayedCount === null || (Number.isSafeInteger(o.ui.displayedCount)
    && o.ui.displayedCount >= 0 && o.ui.displayedCount <= LIMITS.maxJobs), 'INVALID_DISPLAYED_COUNT');
  requireFact(o.jobs === null || (request.action === 'READ_LIST' && Array.isArray(o.jobs)
    && o.jobs.length <= LIMITS.maxJobs), 'UNREQUESTED_LIST_DATA');
  if (o.jobs) o.jobs.forEach(j => validateJob(j, true));
  requireFact(o.sourceTime === null || request.action === 'READ_SOURCE_TIME', 'UNREQUESTED_SOURCE_TIME');
  if (o.sourceTime !== null) {
    exactKeys(o.sourceTime, ['companyId','companyName','officialEntry','label','text','precision','timezone','timezoneEvidence'], 'INVALID_SOURCE_TIME_FIELDS');
    requireFact(o.sourceTime.companyId === TARGET.companyId && o.sourceTime.companyName === TARGET.companyName
      && o.sourceTime.officialEntry === TARGET.officialEntry
      && o.sourceTime.label === '最近成功更新', 'WRONG_TIME_SOURCE');
    requireFact(typeof o.sourceTime.text === 'string' && o.sourceTime.text.length <= 80
      && typeof o.sourceTime.precision === 'string', 'INVALID_SOURCE_TIME');
    requireFact(o.sourceTime.precision === 'minute', 'SOURCE_TIME_PRECISION_INSUFFICIENT');
    // Validate before journaling: arbitrary objects cannot be treated as public timezone facts.
    requireFact(o.sourceTime.timezone === 'UTC'
      && o.sourceTime.timezoneEvidence === 'VISIBLE_UTC_LABEL', 'HOLD_TIME_UNKNOWN');
  }
}

// compare.mjs

/** Pure comparison. No normalization that could hide title/URL differences. */
function comparePublicList(expected, jobs, displayedCount) {
  validateExpected(expected);
  requireFact(Array.isArray(jobs) && jobs.length > 0 && jobs.length <= LIMITS.maxJobs, 'EMPTY_OR_INVALID_LIST');
  jobs.forEach(j => validateJob(j, true));
  const wanted = new Map(expected.jobs.map(j => [j.sourceJobId, j]));
  const actual = new Map(); const duplicateIds = [];
  for (const j of jobs) { if (actual.has(j.sourceJobId)) duplicateIds.push(j.sourceJobId); actual.set(j.sourceJobId, j); }
  const missingIds = [...wanted.keys()].filter(id => !actual.has(id)).sort();
  const extraIds = [...actual.keys()].filter(id => !wanted.has(id)).sort();
  const titleMismatches = [], urlMismatches = [], renderedTitleMismatches = [];
  for (const [id, j] of actual) {
    const e = wanted.get(id);
    if (e && e.officialTitle !== j.officialTitle) titleMismatches.push(id);
    if (e && e.officialUrl !== j.officialUrl) urlMismatches.push(id);
    if (j.renderedOriginalTitle !== j.officialTitle || (e && j.renderedOriginalTitle !== e.officialTitle))
      renderedTitleMismatches.push(id);
  }
  const removedVisibleIds = expected.removedIds.filter(id => actual.has(id)).sort();
  const structurallyExact = displayedCount === jobs.length && !duplicateIds.length && !missingIds.length
    && !titleMismatches.length && !urlMismatches.length && !renderedTitleMismatches.length;
  const exact = structurallyExact && !extraIds.length && !removedVisibleIds.length;
  // A known stale list permits one reload, never a pass. All current fields must already match.
  const knownStale = structurallyExact && expected.removedIds.length > 0
    && extraIds.join('\0') === [...expected.removedIds].sort().join('\0');
  return { status: exact ? 'EXACT' : knownStale ? 'KNOWN_STALE_REMOVALS' : 'MISMATCH',
    expectedCount: wanted.size, actualCount: jobs.length, uniqueActualCount: actual.size,
    displayedCount, duplicateIds: duplicateIds.sort(), missingIds, extraIds,
    titleMismatches: titleMismatches.sort(), urlMismatches: urlMismatches.sort(),
    renderedTitleMismatches: renderedTitleMismatches.sort(), removedVisibleIds };
}

function compareSourceMinute(expectedObservedAt, sourceTime) {
  requireFact(sourceTime !== null, 'SOURCE_TIME_MISSING');
  requireFact(iso(expectedObservedAt), 'INVALID_EXPECTED_TIME');
  requireFact(sourceTime.companyId === TARGET.companyId && sourceTime.companyName === TARGET.companyName
    && sourceTime.officialEntry === TARGET.officialEntry && sourceTime.label === '最近成功更新', 'WRONG_TIME_SOURCE');
  requireFact(sourceTime.timezone === 'UTC' && sourceTime.timezoneEvidence === 'VISIBLE_UTC_LABEL', 'HOLD_TIME_UNKNOWN');
  requireFact(sourceTime.precision === 'minute', 'SOURCE_TIME_PRECISION_INSUFFICIENT');
  requireFact(/^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/.test(sourceTime.text), 'SOURCE_TIME_PRECISION_INSUFFICIENT');
  const parsed = sourceTime.text.replace(' ', 'T').replace(' UTC', ':00.000Z');
  requireFact(Number.isFinite(Date.parse(parsed)) && new Date(parsed).toISOString() === parsed, 'INVALID_SOURCE_MINUTE');
  const expectedMinute = expectedObservedAt.slice(0, 16).replace('T', ' ') + ' UTC';
  return { status: sourceTime.text === expectedMinute ? 'EXACT_MINUTE' : 'MISMATCH',
    expectedObservedAt, expectedMinute, observedMinute: sourceTime.text, precision: 'minute',
    secondsOrMillisecondsVerified: false };
}

// machine.mjs

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
function createPublicVerifier({ expected, port = UNBOUND_PORT } = {}) {
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
  async function readList() {
    let o = await ready(await step('EXPAND_COMPANY')); accepted(o);
    requireFact(o.view === 'jobs' && o.ui.companyExpanded, 'COMPANY_NOT_EXPANDED');
    if (o.ui.viewAllVisible) { o = await ready(await step('VIEW_ALL')); accepted(o); }
    requireFact(o.view === 'jobs' && o.ui.companyExpanded && o.ui.allJobsVisible
      && !o.ui.viewAllVisible, 'ALL_JOBS_NOT_OBSERVED');
    o = await step('READ_LIST'); accepted(o);
    requireFact(o.state === 'READY' && o.view === 'jobs' && o.ui.companyExpanded
      && o.ui.allJobsVisible && !o.ui.viewAllVisible, 'LIST_NOT_READY');
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
      await enter(await step('OPEN_HOME'));
      let list = await readList();
      await readSourceTime(); // Directory may already be current while the list is still old.
      if (list.status === 'KNOWN_STALE_REMOVALS') {
        requireFact(reloadCount < LIMITS.reloads, 'RELOAD_BUDGET_EXHAUSTED');
        reloadCount++;
        await enter(await step('RELOAD'));
        list = await readList();
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
async function runPublicVerification(options) {
  requireFact(options?.port?.kind !== 'REVIEWED_PUBLIC_UI', 'RETAIN_CONTROLLER_FOR_REAL_PORT');
  return createPublicVerifier(options).run();
}

// actual-ax.mjs

// Grammar was observed on job.orz.md in the dot cloud browser on 2026-10-11.
// Full-state mode is mandatory; diffs/no-change strings cannot provide fresh controls.
const HEADER = /^Browser tab: \d+, Title: "Job-search \| 中国医药官方职位聚合", URL: "https:\/\/job\.orz\.md\/"\.$/;
const NODE = /^(\t*)(\d+) (AXWebArea|search text field|combo box|content list|definition list|checkbox|button|link|container|text|image|heading)(?: \(([^)]*)\))?(?: (.*))?$/;
const ROOT = 'Job-search | 中国医药官方职位聚合, URL: job.orz.md/';
const CONSENT_SURFACE_BASELINE = [{"depth":0,"role":"AXWebArea","flags":"","body":"Job-search | 中国医药官方职位聚合, URL: job.orz.md/"},{"depth":1,"role":"container","flags":"","body":"使用前确认"},{"depth":2,"role":"container","flags":"","body":""},{"depth":3,"role":"button","flags":"","body":"关闭确认弹窗"},{"depth":4,"role":"image","flags":"","body":""},{"depth":3,"role":"image","flags":"","body":""},{"depth":3,"role":"heading","flags":"","body":"使用前确认, Value: 2"},{"depth":4,"role":"text","flags":"","body":"使用前确认"},{"depth":2,"role":"text","flags":"","body":"先完成同意，前台才会请求职位搜索结果。"},{"depth":2,"role":"container","flags":"","body":""},{"depth":3,"role":"checkbox","flags":"settable, integer","body":"Description: 我已阅读并同意 隐私政策 和 服务条款, Value: 0"},{"depth":3,"role":"image","flags":"","body":""},{"depth":3,"role":"text","flags":"","body":"我已阅读并同意 "},{"depth":3,"role":"link","flags":"","body":"Description: 隐私政策, Value: job.orz.md/privacy"},{"depth":3,"role":"text","flags":"","body":" 和 "},{"depth":3,"role":"link","flags":"","body":"Description: 服务条款, Value: job.orz.md/terms"},{"depth":2,"role":"button","flags":"disabled","body":"进入 Job-search"},{"depth":3,"role":"text","flags":"","body":"进入 Job-search"},{"depth":3,"role":"image","flags":"","body":""}];
function requireExistingConsentSurface(nodes) {
  const checkbox=one(nodes,n=>n.role==='checkbox'&&n.name===EXISTING_CONSENT_LABEL,'CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
  const entry=one(nodes,n=>n.role==='button'&&n.name==='进入 Job-search','CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
  requireFact(['0','1'].includes(checkbox.value)&&entry.flags===(checkbox.value==='0'?'disabled':''),'CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
  const actual=nodes.map(n=>({depth:n.depth,role:n.role,flags:n.role==='button'&&n.name==='进入 Job-search'?'disabled':n.flags,
    body:n.role==='checkbox'&&n.name===EXISTING_CONSENT_LABEL?n.body.replace(/, Value: [01]$/,', Value: 0'):n.body}));
  // Exact observed visible wording, order and hierarchy. This is not a legal-document hash.
  requireFact(JSON.stringify(actual)===JSON.stringify(CONSENT_SURFACE_BASELINE),'CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED');
}
function bodyParts(body='') {
  const withoutActions=body.replace(/, Secondary Actions: (Expand|Collapse)$/,'');
  const split=withoutActions.indexOf(', Value: ');
  return {name:(split<0?withoutActions:withoutActions.slice(0,split)).replace(/^Description: /,''),
    value:split<0?null:withoutActions.slice(split+9)};
}
function one(nodes,predicate,code){const found=nodes.filter(predicate);requireFact(found.length===1,code);return found[0];}

function decodeActualAx(raw) {
  requireFact(typeof raw==='string'&&raw.length>0&&raw.length<=4_000_000,'UNKNOWN_ACTUAL_AX_FORMAT');
  const lines=raw.split('\n');requireFact(HEADER.test(lines[0]),'UNKNOWN_ACTUAL_AX_HEADER');
  const nodes=[],indices=new Set();
  for(const line of lines.slice(1)) {
    if(!line||line.startsWith('The focused UI element is '))continue;
    const m=line.match(NODE);requireFact(m,'UNKNOWN_ACTUAL_AX_LINE');
    const index=Number(m[2]);requireFact(Number.isSafeInteger(index)&&!indices.has(index),'DUPLICATE_ACTUAL_AX_INDEX');indices.add(index);
    const {name,value}=bodyParts(m[5]),role=m[3],flags=m[4]??'';
    // Only modifiers actually observed on actionable controls are supported.
    if(role==='button')requireFact(['','disabled','collapsed','expanded'].includes(flags),'AX_UNKNOWN_INTERACTIVE_FLAGS');
    if(role==='checkbox')requireFact(['','settable, integer'].includes(flags),'AX_UNKNOWN_INTERACTIVE_FLAGS');
    if(role==='search text field')requireFact(flags==='settable','AX_UNKNOWN_INTERACTIVE_FLAGS');
    if(role==='checkbox'&&name===EXISTING_CONSENT_LABEL)requireFact(flags==='settable, integer','AX_CONSENT_NOT_SETTABLE');
    nodes.push({index,role,flags,name,value,depth:m[1].length,body:m[5]??''});
  }
  one(nodes,n=>n.role==='AXWebArea'&&n.name===ROOT,'ACTUAL_AX_ROOT_MISMATCH');
  const consent=nodes.some(n=>n.role==='container'&&n.name==='使用前确认');
  const jobs=nodes.some(n=>n.role==='container'&&n.name==='公司职位列表');
  const directory=nodes.some(n=>n.role==='container'&&n.name==='公司目录');
  requireFact(Number(consent)+Number(jobs)+Number(directory)===1,'ACTUAL_AX_UNKNOWN_OR_AMBIGUOUS_VIEW');
  const view=consent?'consent':jobs?'jobs':'directory';
  const deny=/访问被拒绝|拒绝访问|access denied|captcha/i.test(raw);
  const error=/加载失败|请求失败|发生错误|无法加载|网络异常|服务不可用/.test(raw);
  const materialChange=/(新|更新|变更|修订).{0,12}(条款|协议)|(条款|协议).{0,12}(更新|变更|修订)/.test(raw);
  const loading=nodes.some(n=>n.role==='text'&&['正在加载官方职位…','正在加载公司目录…'].includes(n.name));
  let recognized=true;
  if(consent) {
    requireExistingConsentSurface(nodes);
    const checkbox=one(nodes,n=>n.role==='checkbox'&&n.name===EXISTING_CONSENT_LABEL,'ACTUAL_AX_EXISTING_CONSENT_UNRECOGNIZED');
    requireFact(['0','1'].includes(checkbox.value),'ACTUAL_AX_CHECKBOX_UNKNOWN');
    one(nodes,n=>n.role==='button'&&n.name==='进入 Job-search','ACTUAL_AX_ENTRY_UNRECOGNIZED');
    for(const [name,path] of [['隐私政策','privacy'],['服务条款','terms']]) {
      const link=one(nodes,n=>n.role==='link'&&n.name===name,'ACTUAL_AX_LEGAL_LINK_UNRECOGNIZED');
      recognized &&= [`job.orz.md/${path}`,`https://job.orz.md/${path}`].includes(link.value);
    }
  } else {
    one(nodes,n=>n.role==='button'&&n.name==='官方招聘目录','ACTUAL_AX_NAV_UNRECOGNIZED');
    if(jobs)one(nodes,n=>n.role==='search text field'&&n.name==='职位关键词','ACTUAL_AX_JOBS_UNRECOGNIZED');
    if(directory)one(nodes,n=>n.role==='search text field'&&n.name==='搜索已覆盖公司','ACTUAL_AX_DIRECTORY_UNRECOGNIZED');
  }
  const company=nodes.filter(n=>n.role==='button'&&/^E5\s+武田中国\s+\d+\s+个职位$/.test(n.name));
  requireFact(company.length<=1,'AX_COMPANY_NOT_UNIQUE');
  if(jobs&&!loading)requireFact(company.length===1,'ACTUAL_AX_TARGET_COMPANY_MISSING');
  if(company.length)requireFact(['collapsed','expanded'].includes(company[0].flags),'ACTUAL_AX_EXPANSION_UNKNOWN');
  const expanded=jobs&&company.length===1&&company[0].flags==='expanded';
  const allVisible=expanded&&nodes.some(n=>n.role==='container'&&n.name==='jobs-company-takeda-china')
    &&!nodes.some(n=>n.role==='button'&&/^查看全部 \d+ 个职位$/.test(n.name));
  const search=nodes.find(n=>n.role==='search text field'&&n.name==='搜索已覆盖公司');
  const companyRows=nodes.filter(n=>n.role==='container'&&n.name.startsWith('row-company-'));
  const filtered=directory&&search?.value==='武田'&&companyRows.length===1&&companyRows[0].name==='row-company-takeda-china';
  const controls=[];
  for(const n of nodes)if(['button','checkbox','link','search text field'].includes(n.role)) {
    if(n.role==='checkbox')requireFact(['0','1'].includes(n.value),'ACTUAL_AX_CHECKBOX_UNKNOWN');
    controls.push({index:n.index,role:n.role==='search text field'?'searchbox':n.role,name:n.name,
      disabled:n.flags.split(',').map(s=>s.trim()).includes('disabled'),
      checked:n.role==='checkbox'?n.value==='1':null,value:n.value});
  }
  return {websiteUrl:TARGET.websiteUrl,view,state:deny?'DENIED':error?'ERROR':loading?'LOADING':'READY',
    errorBanner:error,consentAccepted:!consent,materialChangeNotice:materialChange,
    recognizedExistingFlow:recognized,companyExpanded:expanded,allJobsVisible:allVisible,directoryFiltered:filtered,controls};
}
function assertActualStartupResult(result) {
  requireFact(result&&result.isError===false&&Array.isArray(result.content)&&result.content.length===1
    &&result.content[0]?.type==='text'&&typeof result.content[0].text==='string','UNKNOWN_CUA_STARTUP_FORMAT');
  const text=result.content[0].text;
  const pos=text.lastIndexOf('\nBrowser tab: ');const state=pos>=0?text.slice(pos+1):text;
  decodeActualAx(state); // Handles the observed first-use documentation prefix, not arbitrary success claims.
}
const ACTUAL_PUBLIC_UI_DECODER=Object.freeze({kind:'REVIEWED_ACTUAL_AX_DECODER',
  evidence:'2026-10-11 bounded dot-cloud public UI shape sample; still requires parent independent review',
  decodeAx:decodeActualAx,assertStartupResult:assertActualStartupResult});

// cua-port.mjs

const TAB = '__jobfinder_public_ui_v2_tab';
const PREFIX = 'JOBFINDER_PUBLIC_UI_V2';
const packet = (action, expression) => `nodeRepl.write(JSON.stringify({kind:${JSON.stringify(PREFIX)},action:${JSON.stringify(action)},payload:${expression}}));`;
const fixedScripts = Object.freeze({
  OPEN_HOME: `var ${TAB} = await cua.createBrowserTab("cdp", "https://job.orz.md");`,
  OBSERVE_AX: packet('OBSERVE_AX', `await ${TAB}.getAXState({emit:false,disableDiffing:true})`),
  OPEN_DIRECTORY: `await ${TAB}.playwright.getByRole('button',{name:'官方招聘目录',exact:true}).click();`,
  FILTER_COMPANY: `await ${TAB}.playwright.getByRole('searchbox',{name:'搜索已覆盖公司'}).fill('武田');`,
  RELOAD: `await ${TAB}.reload();`,
  READ_LIST: packet('READ_LIST', `await ${TAB}.playwright.evaluate(() => ({
    anchorJobs: Array.from(document.querySelectorAll('a'))
      .filter(a => a.href.startsWith('https://jobs.takeda.com/job/') && a.getClientRects().length)
      .map(a => ({ officialUrl:a.href, officialTitle:(a.getAttribute('aria-label')||a.textContent||'').replace(/^查看官方职位\\s*/, '').trim(), sourceJobId:a.href.split('/').filter(Boolean).pop() })),
    visibleTitles: Array.from(document.querySelectorAll('#jobs-company-takeda-china .job'))
      .filter(e => e.getClientRects().length)
      .map(e => ({ sourceJobId:e.querySelector('a').href.split('/').filter(Boolean).pop(), renderedOriginalTitle:e.querySelector('p').innerText }))
  }))`),
  READ_SOURCE_TIME: packet('READ_SOURCE_TIME', `await ${TAB}.playwright.evaluate(() => {
    const e = document.getElementById('row-company-takeda-china');
    return e && e.getClientRects().length ? {text:e.innerText, officialEntry:e.querySelector('a').href} : null;
  })`),
});

/** Closed tool-call builder. No arbitrary JS, URL, selectors, source, or tab symbol parameter. */
function buildCuaCall(operation, { index = null, timeoutMs = 15_000 } = {}) {
  requireFact(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15_000, 'INVALID_CUA_TIMEOUT');
  let code = fixedScripts[operation];
  if (operation === 'CLICK_FRESH_INDEX') {
    requireFact(Number.isSafeInteger(index) && index >= 0 && index <= 1_000_000, 'INVALID_AX_INDEX');
    code = `await ${TAB}.click(${index});`;
  } else requireFact(index === null, 'UNEXPECTED_AX_INDEX');
  requireFact(typeof code === 'string', 'CUA_OPERATION_NOT_ALLOWED');
  // Initialization must remain exactly its one supported CUA entry call.
  if (!['OPEN_HOME','OBSERVE_AX','READ_LIST','READ_SOURCE_TIME'].includes(operation))
    code += '\n' + packet(operation, '{completed:true}');
  return Object.freeze({ code, timeout_ms: timeoutMs, title: 'Verify the approved public JobFinder UI' });
}

/** Parse only the envelope emitted by our fixed nodeRepl.write call.
 * Exact one JSON text block is deliberately conservative. Unknown actual wrappers HOLD.
 */
function parseCuaPacket(result, action) {
  requireFact(result && typeof result === 'object' && result.isError !== true, 'CUA_TOOL_ERROR_OR_DENIAL');
  requireFact(Array.isArray(result.content) && result.content.length === 1
    && result.content[0]?.type === 'text' && typeof result.content[0].text === 'string', 'UNKNOWN_CUA_RESULT_FORMAT');
  const text = result.content[0].text;
  requireFact(text.length <= 4_000_000, 'CUA_RESULT_TOO_LARGE');
  let data;
  try { data = JSON.parse(text); } catch { throw new VerificationHold('UNKNOWN_CUA_RESULT_FORMAT'); }
  exactKeys(data, ['kind','action','payload'], 'UNKNOWN_CUA_PACKET_FIELDS');
  requireFact(data.kind === PREFIX && data.action === action, 'CUA_PACKET_ACTION_MISMATCH');
  return data.payload;
}

/** Internal normalized snapshot, NOT a claim about the proprietary getAXState return shape. */
function validateDecodedAx(s) {
  exactKeys(s, ['websiteUrl','view','state','errorBanner','consentAccepted','materialChangeNotice',
    'recognizedExistingFlow','companyExpanded','allJobsVisible','directoryFiltered','controls'], 'UNKNOWN_AX_DECODER_SCHEMA');
  requireFact(s.websiteUrl === TARGET.websiteUrl, 'AX_WRONG_WEBSITE');
  requireFact(['jobs','directory','consent'].includes(s.view)
    && ['READY','LOADING','ERROR','DENIED'].includes(s.state), 'AX_UNKNOWN_VISIBLE_STATE');
  for (const key of ['errorBanner','consentAccepted','materialChangeNotice','recognizedExistingFlow',
    'companyExpanded','allJobsVisible','directoryFiltered']) requireFact(typeof s[key] === 'boolean', 'AX_UNKNOWN_VISIBLE_STATE');
  requireFact(Array.isArray(s.controls) && s.controls.length <= 2000, 'AX_INVALID_CONTROLS');
  const indices = new Set();
  for (const c of s.controls) {
    exactKeys(c, ['index','role','name','disabled','checked','value'], 'AX_UNKNOWN_CONTROL_FIELDS');
    requireFact(Number.isSafeInteger(c.index) && c.index >= 0 && c.index <= 1_000_000 && !indices.has(c.index), 'AX_INVALID_CONTROL_INDEX');
    indices.add(c.index);
    requireFact(['button','checkbox','searchbox','link'].includes(c.role)
      && typeof c.name === 'string' && c.name.length <= 2000 && typeof c.disabled === 'boolean'
      && (c.checked === null || typeof c.checked === 'boolean')
      && (c.value === null || (typeof c.value === 'string' && c.value.length <= 2000)), 'AX_INVALID_CONTROL');
  }
  return s;
}
function unique(s, predicate, code) {
  const matches = s.controls.filter(predicate); requireFact(matches.length === 1, code); return matches[0];
}
function companyControl(s) {
  return unique(s, c => c.role === 'button' && /^E5\s+武田中国\s+\d+\s+个职位$/.test(c.name), 'AX_COMPANY_NOT_UNIQUE');
}
function companyCount(s) {
  const c = companyControl(s), n = Number(c.name.match(/武田中国\s+(\d+)\s+个职位$/)[1]);
  requireFact(Number.isSafeInteger(n) && n > 0 && n <= 1000, 'AX_COMPANY_COUNT_INVALID'); return n;
}
function assertConsent(s) {
  requireFact(s.recognizedExistingFlow && !s.materialChangeNotice, 'CONSENT_CHANGED_OR_UNVERIFIED');
  if (s.view === 'consent') {
    unique(s, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE');
    for (const [name, path] of [['隐私政策','privacy'],['服务条款','terms']]) {
      const c = unique(s, c => c.role === 'link' && c.name === name, 'AX_LEGAL_LINK_NOT_UNIQUE');
      requireFact([`job.orz.md/${path}`,`https://job.orz.md/${path}`].includes(c.value), 'CONSENT_CHANGED_OR_UNVERIFIED');
    }
    requireFact(!s.consentAccepted, 'AX_CONSENT_STATE_CONFLICT');
  } else requireFact(s.consentAccepted, 'AX_CONSENT_NOT_ACCEPTED');
}
function resolveFreshControl(snapshot, action) {
  validateDecodedAx(snapshot); assertConsent(snapshot);
  requireFact(snapshot.state === 'READY' && !snapshot.errorBanner, 'AX_UI_NOT_READY');
  let c;
  if (action === 'CHECK_EXISTING_CONSENT') {
    requireFact(snapshot.view === 'consent', 'AX_CONSENT_VIEW_REQUIRED');
    c = unique(snapshot, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE');
    requireFact(c.checked === false, 'AX_CONSENT_CHECK_ALREADY_SET');
  } else if (action === 'ENTER_EXISTING_CONSENT') {
    requireFact(snapshot.view === 'consent', 'AX_CONSENT_VIEW_REQUIRED');
    const check = unique(snapshot, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE');
    requireFact(check.checked === true, 'AX_CONSENT_NOT_CHECKED');
    c = unique(snapshot, c => c.role === 'button' && c.name === '进入 Job-search', 'AX_ENTRY_NOT_UNIQUE');
  } else if (action === 'EXPAND_COMPANY') {
    requireFact(snapshot.view === 'jobs' && !snapshot.companyExpanded, 'AX_COMPANY_EXPANSION_STATE');
    c = companyControl(snapshot);
  } else if (action === 'VIEW_ALL') {
    requireFact(snapshot.view === 'jobs' && snapshot.companyExpanded && !snapshot.allJobsVisible, 'AX_VIEW_ALL_STATE');
    const count = companyCount(snapshot);
    c = unique(snapshot, c => c.role === 'button' && c.name === `查看全部 ${count} 个职位`, 'AX_VIEW_ALL_NOT_UNIQUE');
  } else if (action === 'OPEN_DIRECTORY') {
    c = unique(snapshot, c => c.role === 'button' && c.name === '官方招聘目录', 'AX_DIRECTORY_NOT_UNIQUE');
  } else if (action === 'FILTER_COMPANY') {
    requireFact(snapshot.view === 'directory', 'AX_DIRECTORY_VIEW_REQUIRED');
    c = unique(snapshot, c => c.role === 'searchbox' && c.name === '搜索已覆盖公司', 'AX_SEARCHBOX_NOT_UNIQUE');
  } else throw new VerificationHold('AX_ACTION_NOT_ALLOWED');
  requireFact(!c.disabled, 'AX_CONTROL_DISABLED'); return c.index;
}

function mergeRenderedList(payload) {
  exactKeys(payload, ['anchorJobs','visibleTitles'], 'INVALID_RENDERED_COLLECTION_FIELDS');
  requireFact(Array.isArray(payload.anchorJobs) && Array.isArray(payload.visibleTitles)
    && payload.anchorJobs.length > 0 && payload.anchorJobs.length <= 1000
    && payload.anchorJobs.length === payload.visibleTitles.length, 'RENDERED_COLLECTION_COUNT_MISMATCH');
  const anchors = new Map(), titles = new Map();
  for (const j of payload.anchorJobs) {
    validateJob(j); requireFact(!anchors.has(j.sourceJobId), 'DUPLICATE_RENDERED_ANCHOR_ID'); anchors.set(j.sourceJobId, j);
  }
  for (const t of payload.visibleTitles) {
    exactKeys(t, ['sourceJobId','renderedOriginalTitle'], 'INVALID_RENDERED_TITLE_FIELDS');
    requireFact(typeof t.sourceJobId === 'string' && anchors.has(t.sourceJobId)
      && !titles.has(t.sourceJobId), 'RENDERED_TITLE_BIJECTION_FAILED');
    requireFact(typeof t.renderedOriginalTitle === 'string' && t.renderedOriginalTitle.length > 0
      && t.renderedOriginalTitle.length <= 2000, 'INVALID_RENDERED_ORIGINAL_TITLE'); titles.set(t.sourceJobId, t.renderedOriginalTitle);
  }
  return [...anchors.values()].map(j => ({ ...j, renderedOriginalTitle: titles.get(j.sourceJobId) }));
}
function parseVisibleSourceCard(payload) {
  requireFact(payload !== null, 'SOURCE_TIME_MISSING'); exactKeys(payload, ['text','officialEntry'], 'INVALID_SOURCE_CARD_FIELDS');
  requireFact(typeof payload.text === 'string' && payload.text.length <= 4096
    && payload.officialEntry === TARGET.officialEntry, 'WRONG_TIME_SOURCE');
  requireFact(payload.text.split(/\r?\n/).map(s => s.trim()).includes(TARGET.companyName), 'WRONG_TIME_SOURCE');
  const matches = [...payload.text.matchAll(/^[ \t]*最近成功更新[ \t]+(\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC)[ \t\r]*$/gm)];
  requireFact(matches.length === 1, 'HOLD_TIME_UNKNOWN');
  return { companyId: TARGET.companyId, companyName: TARGET.companyName, officialEntry: TARGET.officialEntry,
    label: '最近成功更新', text: matches[0][1], precision: 'minute', timezone: 'UTC', timezoneEvidence: 'VISIBLE_UTC_LABEL' };
}
function observation(action, s, jobs = null, sourceTime = null) {
  validateDecodedAx(s); assertConsent(s);
  const checkbox = s.view === 'consent' ? unique(s, c => c.role === 'checkbox' && c.name === EXISTING_CONSENT_LABEL, 'AX_CONSENT_NOT_UNIQUE') : null;
  const entry = s.view === 'consent' ? unique(s, c => c.role === 'button' && c.name === '进入 Job-search', 'AX_ENTRY_NOT_UNIQUE') : null;
  const count = s.view === 'jobs' && s.state === 'READY' ? companyCount(s) : null;
  return { schemaVersion: 1, action, observedAt: new Date().toISOString(), websiteUrl: s.websiteUrl,
    sourceId: TARGET.sourceId, companyId: TARGET.companyId, companyName: TARGET.companyName,
    view: s.view, state: s.state, errorBanner: s.errorBanner,
    consent: {state:s.consentAccepted?'ACCEPTED':'EXISTING_REQUIRED',recognizedExistingFlow:s.recognizedExistingFlow,
      materialChangeNotice:s.materialChangeNotice,checkboxLabel:checkbox?.name??null,
      checkboxChecked:checkbox?.checked??false,entryEnabled:entry?!entry.disabled:false},
    ui:{companyExpanded:s.companyExpanded,viewAllVisible:s.view==='jobs' && s.companyExpanded && !s.allJobsVisible,
      allJobsVisible:s.allJobsVisible,displayedCount:count,directoryFiltered:s.directoryFiltered},jobs,sourceTime };
}

const UNBOUND_AX_DECODER = Object.freeze({kind:'UNBOUND_ACTUAL_AX_AND_STARTUP_FORMAT'});
/** No tool module import. The actual hosted tool is injected only after separate review.
 * The default actual decoder uses the separately sampled grammar. Real tool execution stays disabled.
 */
function createCuaBrowserPort({enabled=false,toolCall=null,decoder=ACTUAL_PUBLIC_UI_DECODER}={}) {
  let opened=false, serial=0, lastUsedSerial=0, reloads=0, busy=false, halted=false;
  let originalToolOperation=null,toolOperationPending=false;
  const toolReceipts=[];
  const configured=enabled===true && typeof toolCall==='function'
    && decoder?.kind==='REVIEWED_ACTUAL_AX_DECODER' && typeof decoder.decodeAx==='function'
    && typeof decoder.assertStartupResult==='function';
  return Object.freeze({enabled:configured,kind:configured?'REVIEWED_PUBLIC_UI':'UNBOUND',targetKey:TARGET.key,
    bindingStatus:configured?'REQUIRES_INDEPENDENT_LIVE_QUALIFICATION':'REAL_CUA_TOOL_DISABLED',
    get originalToolOperation(){return originalToolOperation;},
    get toolOperationPending(){return toolOperationPending;},
    get toolReceipts(){return JSON.parse(JSON.stringify(toolReceipts));},
    invalidateForTimeout(){halted=true;},
    async execute(request) {
      requireFact(configured,'CUA_PORT_DISABLED');
      requireFact(!halted && !busy,'CUA_PORT_HALTED_OR_BUSY'); busy=true;
      try {
      exactKeys(request,['schemaVersion','action','target','timeoutMs','deadlineAtMs'],'INVALID_CUA_REQUEST');
      requireFact(request.schemaVersion===1 && ACTIONS.includes(request.action)
        && JSON.stringify(request.target)===JSON.stringify(TARGET),'CUA_REQUEST_TARGET_NOT_ALLOWED');
      requireFact(Number.isSafeInteger(request.timeoutMs)&&request.timeoutMs>0&&request.timeoutMs<=15000,'INVALID_CUA_TIMEOUT');
      requireFact(Number.isSafeInteger(request.deadlineAtMs),'INVALID_CUA_ABSOLUTE_DEADLINE');
      const action=request.action, deadline=request.deadlineAtMs;
      async function call(operation,index=null) {
        const remaining=Math.floor(deadline-Date.now()); if(halted||remaining<=0||remaining>request.timeoutMs)throw new BrowserProtocolTimeout();
        requireFact(toolReceipts.length<160,'CUA_TOOL_CALL_BUDGET_EXHAUSTED');
        const receipt={sequence:toolReceipts.length+1,operation,startedAt:new Date().toISOString(),finishedAt:null,outcome:'PENDING'};
        toolReceipts.push(receipt);
        let response;
        try {
          originalToolOperation=toolCall(buildCuaCall(operation,{index,timeoutMs:Math.min(remaining,15000)}));
          requireFact(originalToolOperation && typeof originalToolOperation.then==='function','CUA_TOOL_DID_NOT_RETURN_PROMISE');
          toolOperationPending=true;response=await originalToolOperation;receipt.outcome='SETTLED';
        }
        catch(error){receipt.outcome=error instanceof BrowserProtocolTimeout?'TIMEOUT_UNKNOWN':'ERROR';throw error;}
        finally {toolOperationPending=false;receipt.finishedAt=new Date().toISOString();}
        if(halted||Date.now()>=deadline)throw new BrowserProtocolTimeout();
        return response;
      }
      async function fresh() {
        const raw=parseCuaPacket(await call('OBSERVE_AX'),'OBSERVE_AX');
        const s=decoder.decodeAx(raw); validateDecodedAx(s); serial++;
        requireFact(s.state!=='DENIED','EXPLICIT_DENIAL'); requireFact(s.state!=='ERROR'&&!s.errorBanner,'ERROR_BANNER');
        assertConsent(s); return s;
      }
      let snapshot;
      if(action==='OPEN_HOME') {
        requireFact(!opened,'CUA_ALREADY_OPENED'); opened=true;
        // The first call contains exactly createBrowserTab. Its actual native result
        // must be recognized by the reviewed decoder, not an invented success packet.
        decoder.assertStartupResult(await call('OPEN_HOME'));
        snapshot=await fresh();
      } else {
        requireFact(opened,'CUA_HOME_NOT_OPENED');
        if(action==='WAIT_VISIBLE') snapshot=await fresh();
        else if(action==='READ_LIST'||action==='READ_SOURCE_TIME') {
          snapshot=await fresh();
          if(action==='READ_LIST')requireFact(snapshot.state==='READY'&&snapshot.view==='jobs'&&snapshot.companyExpanded&&snapshot.allJobsVisible,'LIST_NOT_READY');
          else requireFact(snapshot.state==='READY'&&snapshot.view==='directory'&&snapshot.directoryFiltered,'SOURCE_TIME_NOT_READY');
          const payload=parseCuaPacket(await call(action),action);
          const jobs=action==='READ_LIST'?mergeRenderedList(payload):null;
          const sourceTime=action==='READ_SOURCE_TIME'?parseVisibleSourceCard(payload):null;
          const after=await fresh();
          requireFact(after.state==='READY'&&after.view===snapshot.view,'AX_CHANGED_DURING_PUBLIC_READ');
          if(action==='READ_LIST')requireFact(after.companyExpanded&&after.allJobsVisible,'AX_CHANGED_DURING_PUBLIC_READ');
          else requireFact(after.directoryFiltered,'AX_CHANGED_DURING_PUBLIC_READ');
          return observation(action,after,jobs,sourceTime);
        } else if(action==='RELOAD') {
          requireFact(reloads++ === 0,'RELOAD_BUDGET_EXHAUSTED');
          const payload=parseCuaPacket(await call('RELOAD'),'RELOAD'); exactKeys(payload,['completed'],'CUA_ACTION_NOT_CONFIRMED');
          requireFact(payload.completed===true,'CUA_ACTION_NOT_CONFIRMED');snapshot=await fresh();
        } else {
          snapshot=await fresh();const index=resolveFreshControl(snapshot,action);
          requireFact(serial>lastUsedSerial,'STALE_AX_INDEX');lastUsedSerial=serial;
          const operation=['OPEN_DIRECTORY','FILTER_COMPANY'].includes(action)?action:'CLICK_FRESH_INDEX';
          const payload=parseCuaPacket(await call(operation,operation==='CLICK_FRESH_INDEX'?index:null),operation);
          exactKeys(payload,['completed'],'CUA_ACTION_NOT_CONFIRMED');requireFact(payload.completed===true,'CUA_ACTION_NOT_CONFIRMED');
          snapshot=await fresh();
        }
      }
      return observation(action,snapshot);
      } catch(error) { halted=true; throw error; } finally { busy=false; }
    }
  });
}

return Object.freeze({TARGET, LIMITS, UNBOUND_PORT, BrowserProtocolTimeout, createPublicVerifier, runPublicVerification, comparePublicList, compareSourceMinute, createCuaBrowserPort, buildCuaCall, parseCuaPacket, validateDecodedAx, resolveFreshControl, mergeRenderedList, parseVisibleSourceCard, UNBOUND_AX_DECODER, ACTUAL_PUBLIC_UI_DECODER, decodeActualAx, assertActualStartupResult});
})()
