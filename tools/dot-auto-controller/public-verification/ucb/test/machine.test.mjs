import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicVerifier, runPublicVerification } from '../machine.mjs';
import { TARGET, LIMITS, BrowserProtocolTimeout, VerificationHold } from '../contract.mjs';
import { comparePublicList, compareSourceMinute } from '../compare.mjs';
import { expected, fakePort, rendered, job, sourceTime, clone } from './synthetic.mjs';

const execute = async (options = {}, e = expected()) => {
  const port = fakePort(e, options), controller = createPublicVerifier({ expected: e, port });
  return { result: await controller.run(), port, controller };
};
test('unbound by default; zero browser tools or network imported', async () => {
  const r = await runPublicVerification({ expected: expected() });
  assert.equal(r.reason, 'BROWSER_PORT_UNBOUND'); assert.equal(r.events.length, 0);
});
test('current exact set passes without reload, narrow assertions only', async () => {
  const { result: r, port } = await execute();
  assert.equal(r.status, 'PASS_LIST_AND_SOURCE_TIME_ONLY'); assert.equal(r.ordinaryReloadCount, 0);
  assert.equal(r.detailVerification, 'UNKNOWN'); assert.equal(r.applicationVerification, 'NOT_TESTED');
  for (const k of ['releaseEligible','newBatchAllowed','allSourcesVerified','productionQualified']) assert.equal(r[k], false);
  assert.equal(r.stabilityDaysVerified, 0); assert.deepEqual(port.calls.map(c => c.action),
    ['OPEN_HOME','EXPAND_COMPANY','VIEW_ALL','READ_LIST','OPEN_DIRECTORY','FILTER_COMPANY','READ_SOURCE_TIME']);
});
test('synthetic 119 to 116; directory already new before the only reload', async () => {
  const { result: r } = await execute({ staleBefore: true, consent: true }, expected(116));
  assert.equal(r.status, 'PASS_LIST_AND_SOURCE_TIME_ONLY'); assert.equal(r.ordinaryReloadCount, 1);
  assert.deepEqual(r.comparisons.map(c => [c.kind,c.reloadCount,c.status]), [
    ['LIST',0,'KNOWN_STALE_REMOVALS'],['SOURCE_TIME',0,'EXACT_MINUTE'],['LIST',1,'EXACT'],['SOURCE_TIME',1,'EXACT_MINUTE']]);
  assert.equal(r.comparisons[0].actualCount, 119); assert.equal(r.comparisons[2].actualCount, 116);
  assert.equal(r.events.filter(e => e.action === 'CHECK_EXISTING_CONSENT').length, 2);
});
test('stale after reload holds and never refreshes twice', async () => {
  const { result: r, port } = await execute({ staleBefore: true, staleAfter: true });
  assert.equal(r.reason, 'PUBLIC_LIST_STILL_STALE'); assert.equal(port.calls.filter(c => c.action === 'RELOAD').length, 1);
});
test('all already visible does not invent View all click', async () => {
  const { result: r, port } = await execute({ allInitiallyVisible: true });
  assert.equal(r.status, 'PASS_LIST_AND_SOURCE_TIME_ONLY'); assert(!port.calls.some(c => c.action === 'VIEW_ALL'));
});
test('one normal observation wait after loading', async () => {
  const { result: r, port } = await execute({ loadingAt: 'OPEN_HOME' });
  assert.equal(r.status, 'PASS_LIST_AND_SOURCE_TIME_ONLY'); assert.equal(port.calls.filter(c => c.action === 'WAIT_VISIBLE').length, 1);
});
test('empty loading remains inconclusive and exhausts bounded waits', async () => {
  const { result: r, port } = await execute({ loadingAt: 'OPEN_HOME', loadingForever: true });
  assert.equal(r.reason, 'VISIBLE_LOADING_BUDGET_EXHAUSTED');
  assert.equal(port.calls.filter(c => c.action === 'WAIT_VISIBLE').length, LIMITS.waitsPerStage);
  assert(!port.calls.some(c => c.action === 'RELOAD'));
});
const mutationCases = [
  ['duplicate ID', 'READ_LIST', o => o.jobs.push(clone(o.jobs[0])), 'PUBLIC_LIST_MISMATCH'],
  ['missing ID', 'READ_LIST', o => o.jobs.pop(), 'PUBLIC_LIST_MISMATCH'],
  ['unexpected ID', 'READ_LIST', o => { o.jobs.push(rendered(job(9999))); o.ui.displayedCount++; }, 'PUBLIC_LIST_MISMATCH'],
  ['partially old removed set', 'READ_LIST', o => { o.jobs.push(rendered(job(9001))); o.ui.displayedCount++; }, 'PUBLIC_LIST_MISMATCH'],
  ['title differs', 'READ_LIST', o => o.jobs[0].officialTitle += ' changed', 'PUBLIC_LIST_MISMATCH'],
  ['URL differs', 'READ_LIST', o => o.jobs[0].officialUrl = o.jobs[0].officialUrl.replace('careers.ucb.com','evil.test'), 'INVALID_JOB_URL'],
  ['rendered original differs', 'READ_LIST', o => o.jobs[0].renderedOriginalTitle += ' changed', 'PUBLIC_LIST_MISMATCH'],
  ['count differs', 'READ_LIST', o => o.ui.displayedCount++, 'PUBLIC_LIST_MISMATCH'],
  ['ready empty', 'READ_LIST', o => { o.jobs = []; o.ui.displayedCount = 0; }, 'PUBLIC_LIST_MISMATCH'],
  ['error banner', 'OPEN_HOME', o => o.errorBanner = true, 'ERROR_BANNER'],
  ['explicit UI denial', 'OPEN_HOME', o => o.state = 'DENIED', 'EXPLICIT_DENIAL'],
  ['explicit consent denial', 'OPEN_HOME', o => o.consent.state = 'DENIED', 'EXPLICIT_DENIAL'],
  ['changed consent', 'OPEN_HOME', o => o.consent.state = 'CHANGED', 'CONSENT_CHANGED_OR_UNVERIFIED'],
  ['unknown consent structure', 'OPEN_HOME', o => o.consent.state = 'UNKNOWN', 'CONSENT_CHANGED_OR_UNVERIFIED'],
  ['new agreement notice', 'OPEN_HOME', o => o.consent.materialChangeNotice = true, 'CONSENT_CHANGED_OR_UNVERIFIED'],
  ['unknown existing flow', 'OPEN_HOME', o => o.consent.recognizedExistingFlow = false, 'CONSENT_CHANGED_OR_UNVERIFIED'],
  ['wrong source', 'READ_LIST', o => o.sourceId = 'source-other', 'WRONG_TARGET_OR_SOURCE'],
  ['wrong company', 'READ_SOURCE_TIME', o => o.sourceTime.companyId = 'company-other', 'WRONG_TIME_SOURCE'],
  ['wrong official source', 'READ_SOURCE_TIME', o => o.sourceTime.officialEntry = 'https://example.com/', 'WRONG_TIME_SOURCE'],
  ['global time substituted', 'READ_SOURCE_TIME', o => o.sourceTime.label = '全站最近更新', 'WRONG_TIME_SOURCE'],
  ['no company time', 'READ_SOURCE_TIME', o => o.sourceTime = null, 'SOURCE_TIME_MISSING'],
  ['timezone unknown', 'READ_SOURCE_TIME', o => o.sourceTime.timezone = 'UNKNOWN', 'HOLD_TIME_UNKNOWN'],
  ['browser locale alone is not timezone evidence', 'READ_SOURCE_TIME', o => o.sourceTime.timezoneEvidence = 'RUNTIME_TZ', 'HOLD_TIME_UNKNOWN'],
  ['day-only precision', 'READ_SOURCE_TIME', o => { o.sourceTime.precision = 'day'; o.sourceTime.text = '2026-10-11'; }, 'SOURCE_TIME_PRECISION_INSUFFICIENT'],
  ['unmarked minute precision', 'READ_SOURCE_TIME', o => o.sourceTime.precision = 'unknown', 'SOURCE_TIME_PRECISION_INSUFFICIENT'],
  ['fake seconds unsupported', 'READ_SOURCE_TIME', o => o.sourceTime.text = '2026-10-11 15:23:18 UTC', 'SOURCE_TIME_PRECISION_INSUFFICIENT'],
  ['old company minute', 'READ_SOURCE_TIME', o => o.sourceTime.text = '2026-10-11 12:10 UTC', 'SOURCE_MINUTE_MISMATCH'],
  ['future minute', 'READ_SOURCE_TIME', o => o.sourceTime.text = '2026-10-11 15:24 UTC', 'SOURCE_MINUTE_MISMATCH'],
  ['invalid minute', 'READ_SOURCE_TIME', o => o.sourceTime.text = '2026-02-30 15:23 UTC', 'INVALID_SOURCE_MINUTE'],
  ['wrong target domain', 'OPEN_HOME', o => o.websiteUrl = 'https://example.com/', 'WRONG_TARGET_OR_SOURCE'],
  ['query URL on target', 'OPEN_HOME', o => o.websiteUrl = TARGET.websiteUrl + '?secret=1', 'WRONG_TARGET_OR_SOURCE'],
  ['wrong protocol action', 'OPEN_HOME', o => o.action = 'RELOAD', 'PROTOCOL_ACTION_MISMATCH'],
  ['made-up observed time', 'OPEN_HOME', o => o.observedAt = '2000-01-01T00:00:00.000Z', 'UNVERIFIED_OBSERVATION_TIME'],
  ['unrequested raw DOM', 'OPEN_HOME', o => o.rawDOM = '<private />', 'INVALID_OBSERVATION_FIELDS'],
  ['hidden API job field', 'READ_LIST', o => o.jobs[0].detail = 'not allowed', 'INVALID_JOB_FIELDS'],
  ['official URL foreign domain', 'READ_LIST', o => o.jobs[0].officialUrl = 'https://example.com/1000', 'INVALID_JOB_URL'],
  ['receipt-bound ID disagreement', 'READ_LIST', o => o.jobs[0].sourceJobId = job(9999).sourceJobId, 'PUBLIC_LIST_MISMATCH'],
  ['company not expanded', 'EXPAND_COMPANY', o => o.ui.companyExpanded = false, 'COMPANY_NOT_EXPANDED'],
  ['view all never completed', 'VIEW_ALL', o => o.ui.allJobsVisible = false, 'ALL_JOBS_NOT_OBSERVED'],
  ['directory wrong view', 'OPEN_DIRECTORY', o => o.view = 'jobs', 'DIRECTORY_NOT_OPEN'],
  ['directory filter not applied', 'FILTER_COMPANY', o => o.ui.directoryFiltered = false, 'DIRECTORY_NOT_FILTERED'],
];
for (const [name, at, mutate, reason] of mutationCases) test(name + ' fails closed without reload', async () => {
  const { result: r, port } = await execute({ mutate(o, ctx) { if (ctx.action === at) mutate(o); } });
  assert.equal(r.status, 'HOLD'); assert.equal(r.reason, reason); assert.equal(r.ordinaryReloadCount, 0);
  assert(!port.calls.some(c => c.action === 'RELOAD'));
  assert(!JSON.stringify(r.events).includes('<private />'));
});
test('consent checkbox result checked before entry', async () => {
  const { result: r, port } = await execute({ consent: true, mutate(o, c) {
    if (c.action === 'CHECK_EXISTING_CONSENT') o.consent.entryEnabled = false;
  } });
  assert.equal(r.reason, 'CONSENT_ENTER_DISABLED'); assert(!port.calls.some(c => c.action === 'ENTER_EXISTING_CONSENT'));
});
test('consent change after one reload immediately holds', async () => {
  const { result: r, port } = await execute({ staleBefore: true, mutate(o,c) {
    if (c.action === 'RELOAD') o.consent.materialChangeNotice = true;
  } });
  assert.equal(r.reason, 'CONSENT_CHANGED_OR_UNVERIFIED'); assert.equal(port.calls.at(-1).action, 'RELOAD');
});
test('protocol timeout held once without any retry', async () => {
  const { result: r, port, controller } = await execute({ throwsAt: 'OPEN_HOME', error: new BrowserProtocolTimeout() });
  assert.equal(r.reason, 'BROWSER_PROTOCOL_TIMEOUT'); assert.equal(port.calls.length, 1);
  assert.equal(r.pendingActionOutcome, 'UNKNOWN'); assert.equal(controller.pendingOperation, null);
});
test('non-timeout error propagates original identity with retained event', async () => {
  const e = expected(), error = new Error('ordinary failure, not a timeout');
  const controller = createPublicVerifier({ expected: e, port: fakePort(e, { throwsAt: 'OPEN_HOME', error }) });
  await assert.rejects(controller.run(), actual => actual === error);
  assert.equal(controller.events.at(-1).outcome, 'NON_TIMEOUT_EXCEPTION_PROPAGATED');
});
test('errors with Timeout in their message are not reclassified', async () => {
  const e = expected(), error = new TypeError('Timeout text is not protocol classification');
  await assert.rejects(runPublicVerification({ expected: e, port: fakePort(e, { throwsAt: 'OPEN_HOME', error }) }),
    actual => actual === error);
});
test('same controller and port cannot be reused', async () => {
  const { result, port, controller } = await execute(); assert.match(result.status, /^PASS/);
  await assert.rejects(controller.run(), e => e instanceof VerificationHold && e.code === 'RUN_ALREADY_STARTED');
  const r = await runPublicVerification({ expected: expected(), port }); assert.equal(r.reason, 'PORT_ALREADY_USED');
});
test('unsupported source input prevents opening browser', async () => {
  const e = expected(); e.sourceId = 'source-gsk'; const port = fakePort(e);
  const r = await runPublicVerification({ expected: e, port }); assert.equal(r.reason, 'SOURCE_NOT_ALLOWED'); assert.equal(port.calls.length, 0);
});
test('unsupported port target prevents browser calls', async () => {
  const e = expected(), port = fakePort(e); port.targetKey = 'anywhere';
  const r = await runPublicVerification({ expected: e, port }); assert.equal(r.reason, 'PORT_TARGET_NOT_ALLOWED'); assert.equal(port.calls.length, 0);
});
test('real port cannot discard controller through synthetic convenience helper', async () => {
  const e = expected(), port = fakePort(e); port.kind = 'REVIEWED_PUBLIC_UI';
  await assert.rejects(runPublicVerification({ expected: e, port }), /RETAIN_CONTROLLER_FOR_REAL_PORT/);
  assert.equal(port.calls.length, 0);
});
test('expected duplicate IDs rejected before any action', async () => {
  const e = expected(); e.jobs.push(clone(e.jobs[0])); const port = fakePort(e);
  const r = await runPublicVerification({ expected: e, port }); assert.equal(r.reason, 'DUPLICATE_EXPECTED_ID'); assert.equal(port.calls.length, 0);
});
test('bidirectional comparison does not depend on row order', () => {
  const e = expected(); assert.equal(comparePublicList(e, e.jobs.map(rendered).reverse(), 2).status, 'EXACT');
});
test('minute precision never claims seconds or exact database time', () => {
  const r = compareSourceMinute(expected().observedAt, sourceTime()); assert.equal(r.status, 'EXACT_MINUTE');
  assert.equal(r.secondsOrMillisecondsVerified, false);
});
test('pure time comparator rejects another company', () => {
  const t = sourceTime(); t.companyId = 'company-other';
  assert.throws(() => compareSourceMinute(expected().observedAt, t), /WRONG_TIME_SOURCE/);
});
test('requests immutable and bound to only approved domain/flow', async () => {
  const { port, result } = await execute(); assert.match(result.status, /^PASS/);
  for (const request of port.calls) {
    assert(Object.isFrozen(request)); assert(Object.isFrozen(request.target)); assert.equal(request.target.websiteUrl, TARGET.websiteUrl);
    assert(request.timeoutMs > 0 && request.timeoutMs <= LIMITS.stepMs);
  }
});
test('real event timestamps retained with sequential observations', async () => {
  const { result: r } = await execute();
  for (const [n, e] of r.events.entries()) {
    assert.equal(e.sequence, n+1); assert(Date.parse(e.startedAt) <= Date.parse(e.observation.observedAt));
    assert(Date.parse(e.observation.observedAt) <= Date.parse(e.finishedAt));
  }
});
for (const field of ['timezone','timezoneEvidence','precision']) test(`untrusted ${field} object never reaches journal`, async () => {
  const marker = 'SYNTHETIC_PRIVATE_OBJECT_SHOULD_NOT_BE_JOURNALED';
  const { result: r } = await execute({ mutate(o,c) {
    if (c.action === 'READ_SOURCE_TIME') o.sourceTime[field] = { rawDOM: marker };
  } });
  assert.equal(r.status, 'HOLD'); assert(!JSON.stringify(r.events).includes(marker));
  assert.equal(r.events.at(-1).outcome, 'REJECTED_OBSERVATION');
});
