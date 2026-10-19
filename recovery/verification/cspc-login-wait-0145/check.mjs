import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = folder => fs.readFileSync(new URL(`./${folder}/cspc-dom-runtime-functions.js`, import.meta.url), 'utf8');
const cappedError = 'Timed out after 3000ms: Runtime.evaluate timed out\nlocator.waitFor(visible) timed out';
const epoch = Date.parse('2026-10-19T01:00:00Z');
async function capture(folder, {failures = 2, deadline = Infinity, otherError} = {}) {
  let now = epoch, clicks = 0, waits = 0, loads = 0, reads = 0;
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const heading = {waitFor: async ({state, timeoutMs}) => {
    assert.equal(state, 'visible'); waits++; now += Math.min(3000, timeoutMs);
    if (otherError) throw otherError;
    if (waits <= failures) throw Error(cappedError);
  }};
  const tab = {
    getAXState: async () => {}, url: async () => 'https://example.test/detail',
    playwright: {
      frameLocator: selector => {
        assert.equal(selector, '#recruit-content-iframe');
        return {getByRole: (role, options) => {
          assert.equal(role, 'button'); assert.equal(options.name, '投递'); assert.equal(options.exact, true);
          return {first: () => ({click: async () => {clicks++;}})};
        }, locator: () => ({evaluate: async () => '<html>detail</html>'})};
      },
      getByRole: (role, options) => {
        assert.equal(role, 'heading'); assert.equal(options.name, '登录'); assert.equal(options.exact, true);
        return heading;
      },
      waitForLoadState: async ({state, timeoutMs}) => {assert.equal(state, 'load'); assert(timeoutMs > 0); loads++;},
      domSnapshot: async () => {reads++; return '登录 密码';},
      evaluate: async () => '<html>登录 密码</html>'
    }
  };
  const context = vm.createContext({Date: Clock});
  vm.runInContext(source(folder), context);
  let result, error;
  try { result = await context.captureCspcApplicationEntry(tab, deadline); } catch (caught) { error = caught; }
  return {result, error, clicks, waits, loads, reads, elapsed: now - epoch};
}

const before = await capture('before');
assert.match(String(before.error), /Runtime.evaluate timed out/);
assert.equal(before.waits, 1); assert.equal(before.clicks, 1); assert.equal(before.reads, 0);
const after = await capture('after');
assert.equal(after.error, undefined); assert.equal(after.waits, 3); assert.equal(after.loads, 3);
assert.equal(after.clicks, 1); assert.equal(after.reads, 1); assert.equal(after.elapsed, 9000);
assert.equal(after.result.applicationState, 'LOGIN_REQUIRED_POST_LOGIN_STATUS_UNVERIFIED');
for (const key of ['personalDataEntered', 'loginPerformed', 'applicationSubmitted']) assert.equal(after.result[key], false);
assert.deepEqual(Object.keys(after.result).sort(), ['url', 'clickStartedAt', 'clickCompletedAt', 'readStartedAt', 'readCompletedAt', 'snapshot', 'rootHtml', 'frameHtml', 'applicationState', 'personalDataEntered', 'loginPerformed', 'applicationSubmitted'].sort());
for (const [deadline, expected] of [[Infinity, 30000], [epoch + 5000, 5000]]) {
  const bounded = await capture('after', {failures: Infinity, deadline});
  assert.match(String(bounded.error), /CSPC_DOM_LOADING_TIMEOUT/);
  assert.equal(bounded.elapsed, expected); assert.equal(bounded.clicks, 1); assert.equal(bounded.reads, 0);
}
const denied = Error('permission denied');
const stopped = await capture('after', {otherError: denied});
assert.equal(stopped.error, denied); assert.equal(stopped.waits, 1); assert.equal(stopped.clicks, 1);

// Execute the actual sole consumer with only its browser dependencies stubbed.
const channel = '0beb3022-3214-4333-a2e7-20786c4916d5';
const entry = `https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/${channel}/officeWebsite.mob`;
const id = '031486db-cc49-4e3c-b15f-9ddb30f62fb6';
const url = `${entry}?jumpPageId=detail&detailRequestId=${id}&rootId=cspc&recruitWay=e264521b-64fa-4e3b-aec7-720913ac635d&configId=${channel}`;
const deadline = Date.now() + 5000;
let receivedDeadline;
const tab = {close: async () => {}, getAXState: async () => {}, playwright: {frameLocator: () => ({locator: () => ({first: () => ({})})})}};
const row = {title: '临床药理经理', text: '临床药理经理'};
const context = vm.createContext({Date, URL,
  cua: {createBrowserTab: async () => tab, getTab: async () => tab},
  waitCspcDomReady: async () => {},
  readCspcListObservation: async () => ({url: entry, listFilters: {keyword: '', selectedFilters: []}, rows: [row], terminal: {disabledNextCount: 1, disabledJumpNextCount: 1, enabledNextCount: 0, loadMoreCount: 0, rowCount: 1}}),
  captureCspcDomBatch: async () => [{tabId: '62'}],
  readCspcCompletedDetails: async () => [{row, tabId: '62', url, detailSections: ['1', '1']}],
  captureCspcApplicationEntry: async (actualTab, actualDeadline) => {assert.equal(actualTab, tab); receivedDeadline = actualDeadline; return {url};}
});
vm.runInContext(fs.readFileSync(new URL('./after/cspc-browser-runtime.js', import.meta.url), 'utf8'), context);
await context.cspcDomRuntime.start({runStartedAt: new Date().toISOString(), dispatchBefore: new Date(deadline).toISOString()});
await context.cspcDomRuntime.readRow(0);
assert.equal(receivedDeadline, deadline);
console.log('PASS: real before fails after one capped 3s wait; real after continues the same heading wait and clicks only once.');
console.log('PASS: original 30s budget and earlier source deadline remain bounded; unrelated errors propagate; evidence fields and login-only status remain unchanged.');
console.log('PASS: actual readRow consumer forwards the existing source deadline. Offline mocks only; no browser, network, database or active file was changed.');
