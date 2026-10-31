import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from '../five-source-sequence-source-candidate-20261016T1235Z/tools/dot-auto-controller/vendor/c60-source/node_modules/playwright-core/index.mjs';
import {createChromiumDom} from './chromium-dom.mjs';

test('local sandboxed Chromium: iframe locators, real click popup, ARIA, timeouts and tab lifecycle', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('content-type', 'text/html; charset=utf-8');
    if (request.url === '/frame') response.end('<h2>Frame jobs</h2><a target="_blank" href="/detail">Local detail</a><label><input type="checkbox">Local checkbox</label>');
    else if (request.url === '/detail') response.end('<h1>Local job detail</h1><p>This is synthetic local fixture data.</p>');
    else response.end('<h1>Local list</h1><input aria-label="Search"><iframe title="Recruitment frame" id="recruit-content-iframe" src="/frame"></iframe>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let cua;
  try {
    // Explicit sandbox; never retry with --no-sandbox.
    cua = await createChromiumDom({chromium});
    assert.equal(cua.transport, 'LOCAL_CHROMIUM');
    const tab = await cua.createBrowserTab('cdp', base);
    await tab.playwright.waitForLoadState({state: 'load', timeoutMs: 3000});
    await tab.playwright.getByRole('textbox', {name: 'Search'}).fill('fixture', {timeoutMs: 3000});
    assert.equal(await tab.playwright.getByRole('textbox').evaluate(element => element.value), 'fixture');
    const frame = tab.playwright.frameLocator('#recruit-content-iframe');
    await frame.getByText('Frame jobs', {exact: true}).waitFor({state: 'visible', timeoutMs: 3000});
    await frame.getByRole('checkbox', {name: 'Local checkbox'}).check({timeoutMs: 3000});
    assert.equal(await frame.locator('input').evaluate(element => element.checked), true);
    assert.deepEqual(await frame.locator('a').evaluateAll(elements => elements.map(element => element.textContent)), ['Local detail']);
    const before = await cua.listTabs({browser: 'cdp', emit: false});
    await frame.locator('a').first().click({timeoutMs: 3000});
    await tab.getAXState({emit: false});
    const after = await cua.listTabs({browser: 'cdp', emit: false});
    const added = after.filter(item => !before.some(previous => previous.id === item.id));
    assert.equal(added.length, 1);
    const popup = await cua.getTab(added[0].id, {browser: 'cdp'});
    await popup.playwright.getByRole('heading', {name: 'Local job detail'}).waitFor({timeoutMs: 3000});
    assert.equal(await popup.url(), base + '/detail');
    const snapshot = JSON.parse(await tab.playwright.domSnapshot());
    assert.equal(snapshot.kind, 'LOCAL_CHROMIUM_ARIA_SNAPSHOT');
    assert.equal(snapshot.networkCapture, false);
    assert(snapshot.frames.some(item => item.url === base + '/frame' && item.aria.includes('Frame jobs')));
    await assert.rejects(tab.playwright.locator('#missing').waitFor({state: 'visible', timeoutMs: 20}), /Timeout/);
    await popup.close();
    await assert.rejects(cua.getTab(popup.id), /TAB_NOT_FOUND/);
    assert.equal((await cua.getState()).tabs.length, 1);
    assert(requests.includes('/frame') && requests.includes('/detail'));
    await tab.close();
  } finally {
    if (cua) await cua.close();
    await new Promise(resolve => server.close(resolve));
  }
});

// This contract test does not substitute for the real-browser fixture above.
test('offline adapter mapping preserves locator chains and maps timeoutMs without relabelling evidence', async () => {
 const calls=[];
 const native={first(){calls.push('first');return this;},nth(n){calls.push(['nth',n]);return this;},
  locator(selector){calls.push(['locator',selector]);return this;},
  async waitFor(config){calls.push(['waitFor',config]);},
  async evaluate(fn,arg){return fn({textContent:'synthetic'},arg);}};
 const page={url:()=> 'about:blank',once(){},locator:selector=>native,frameLocator:selector=>native,
  async goto(){},async close(){},async waitForLoadState(state,config){calls.push(['load',state,config]);}};
 const context={on(){},async newPage(){return page;},pages:()=>[page]};
 const fakeChromium={async launch(config){assert.equal(config.chromiumSandbox,true);assert(!Object.hasOwn(config.env,'JOBFINDER_POSTGRES_PASSWORD'));return {async newContext(){return context;},async close(){}};}};
 const cua=await createChromiumDom({chromium:fakeChromium});
 try{
  const tab=await cua.createBrowserTab('cdp');
  await tab.playwright.frameLocator('#fixture').locator('a').nth(2).first().waitFor({state:'visible',timeoutMs:123});
  assert.deepEqual(calls.slice(0,4),[['locator','a'],['nth',2],'first',['waitFor',{state:'visible',timeout:123}]]);
  assert.equal(await tab.playwright.locator('a').evaluate(element=>element.textContent),'synthetic');
  await tab.playwright.waitForLoadState({state:'domcontentloaded',timeoutMs:321});
  assert.deepEqual(calls.at(-1),['load','domcontentloaded',{timeout:321}]);
  assert.equal((await cua.getState()).transport,'LOCAL_CHROMIUM');
 }finally{await cua.close();}
});
