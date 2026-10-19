import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const channel = '0beb3022-3214-4333-a2e7-20786c4916d5';
const entry = `https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/${channel}/officeWebsite.mob`;
const navigationError = Error(`Timed out waiting for tab 66 to navigate to ${entry}.`);
const cappedError = Error('Runtime.evaluate timed out\nlocator.waitFor(visible) timed out');
const epoch = Date.parse('2026-10-19T02:00:00Z');
const helperUrl = new URL('../inactive-cspc-login-wait-20261019T0145Z/after/cspc-dom-runtime-functions.js', import.meta.url);
const helper = fs.readFileSync(helperUrl, 'utf8');
async function start(folder, {gotoElapsed = 20000, error = navigationError, failures = 2, sourceMs = 120000} = {}) {
  let now = epoch, creates = 0, navigations = 0, waits = 0, loads = 0, observations = 0, closes = 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const locator = {waitFor: async ({state, timeoutMs}) => {
    assert.equal(state, 'visible'); assert(timeoutMs > 0);
    waits++; now += Math.min(3000, timeoutMs);
    if (waits <= failures) throw cappedError;
  }};
  const tab = {id: '66',
    goto: async url => {assert.equal(url, entry); navigations++; now += gotoElapsed; if (error) throw error;},
    close: async () => {closes++;}, url: async () => entry, getAXState: async () => {},
    playwright: {
      frameLocator: selector => {assert.equal(selector, '#recruit-content-iframe'); return {locator: selector => {assert.equal(selector, '.vxe-table--body tbody tr a'); return {first: () => locator};}};},
      waitForLoadState: async ({state, timeoutMs}) => {assert.equal(state, 'load'); assert(timeoutMs > 0); loads++;},
      domSnapshot: async () => 'original list snapshot'
    }
  };
  const context = vm.createContext({Date: Clock, URL,
    cua: {createBrowserTab: async (...args) => {
      creates++; assert.equal(args[0], 'cdp');
      if (args.length === 2) {assert.equal(args[1], entry); now += gotoElapsed; if (error) throw error;}
      return tab;
    }},
    readCspcListObservation: async actual => {
      assert.equal(actual, tab); observations++;
      return {url: entry, listFilters: {keyword: '', selectedFilters: []}, rows: [{title: '岗位'}], terminal: {disabledNextCount: 1, disabledJumpNextCount: 1, enabledNextCount: 0, loadMoreCount: 0, rowCount: 1}};
    }
  });
  const observe = context.readCspcListObservation;
  vm.runInContext(helper, context);
  context.readCspcListObservation = observe;
  vm.runInContext(fs.readFileSync(new URL(`./${folder}/cspc-browser-runtime.js`, import.meta.url), 'utf8'), context);
  let result, failure;
  try { result = await context.cspcDomRuntime.start({runStartedAt: new Date(epoch).toISOString(), dispatchBefore: new Date(epoch + sourceMs).toISOString()}); } catch (caught) { failure = caught; }
  const failureState = await context.cspcDomRuntime.failureState();
  await context.cspcDomRuntime.close();
  return {result, failure, failureState, creates, navigations, waits, loads, observations, closes, elapsed: now - epoch};
}

const before = await start('before');
assert.equal(before.failure, navigationError);
assert.equal(before.failureState.readError, 'CSPC_LIST_HANDLE_UNAVAILABLE_AFTER_START_FAILURE');
assert.equal(before.creates, 1); assert.equal(before.waits, 0); assert.equal(before.closes, 0);
const after = await start('after');
assert.equal(after.failure, undefined); assert.equal(after.result.rowCount, 1);
assert.equal(after.creates, 1); assert.equal(after.navigations, 1); assert.equal(after.waits, 3);
assert.equal(after.elapsed, 29000); assert.equal(after.observations, 1); assert.equal(after.closes, 1);
assert.equal(after.failureState.url, entry); assert.equal(after.failureState.domSnapshot, 'original list snapshot');
for (const [gotoElapsed, sourceMs, expected, expectedWaits] of [[50000, 120000, 60000, 4], [20000, 25000, 25000, 2], [60000, 120000, 60000, 0]]) {
  const exhausted = await start('after', {gotoElapsed, sourceMs, failures: Infinity});
  assert.match(String(exhausted.failure), /CSPC_DOM_LOADING_TIMEOUT/);
  assert.equal(exhausted.elapsed, expected); assert.equal(exhausted.waits, expectedWaits);
  assert.equal(exhausted.creates, 1); assert.equal(exhausted.navigations, 1); assert.equal(exhausted.observations, 0);
  assert.equal(exhausted.failureState.url, entry); assert.equal(exhausted.closes, 1);
}
for (const error of [Error('Access denied'), Error('net::ERR_CERT_AUTHORITY_INVALID'), Error('Runtime.evaluate timed out'), Error(`Timed out waiting for tab 67 to navigate to ${entry}.`)]) {
  const rejected = await start('after', {error});
  assert.equal(rejected.failure, error); assert.equal(rejected.waits, 0); assert.equal(rejected.loads, 0);
  assert.equal(rejected.creates, 1); assert.equal(rejected.navigations, 1); assert.equal(rejected.observations, 0);
  assert.equal(rejected.failureState.url, entry); assert.equal(rejected.closes, 1);
}
console.log('PASS: actual before loses the handle on navigation timeout; actual after keeps the same handle, navigates once, and completes readiness after capped waits.');
console.log('PASS: navigation time counts toward the original 60s budget and earlier source deadline; exhausted budget never receives another readiness window.');
console.log('PASS: access denial, certificate warning, non-navigation timeout and another tab timeout propagate without readiness retry; retained handles remain readable and close once.');
console.log('Offline mocks only. No real browser, network, database or active file was changed.');
