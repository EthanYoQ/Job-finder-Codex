import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {createChromiumDom} from '../src/crawler/local-browser/chromium-dom.mjs';

test('ready job DOM does not wait for a stalled image; explicit load waits still apply', {timeout:20000}, async()=>{
  const server=createServer((request,response)=>{
    if(request.url==='/slow-image')return;
    if(request.url==='/rate'){response.statusCode=429;response.setHeader('retry-after','120');}
    response.setHeader('content-type','text/html');
    response.end('<h1>Jobs ready</h1><img src="/slow-image">');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const netLogPath=join(await mkdtemp(join(tmpdir(),'chromium-netlog-')),'network.json');
  let cua;
  try {
    const confined={async launch(options){
      assert.equal(options.chromiumSandbox,true);
      assert.deepEqual(options.args,[`--log-net-log=${netLogPath}`,'--net-log-max-size-mb=10','--net-log-duration=60']);
      const browser=await chromium.launch(options);
      return {close:()=>browser.close(),async newContext(){
        const context=await browser.newContext({serviceWorkers:'block'});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
        return context;
      }};
    }};
    cua=await createChromiumDom({chromium:confined,netLogPath,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'});
    const tab=await cua.createBrowserTab('cdp');
    await tab.goto(base,{timeoutMs:5000});
    await tab.playwright.getByRole('heading',{name:'Jobs ready'}).waitFor({timeoutMs:1000});
    assert.equal((await tab.navigationInfo()).httpStatus,200);
    await assert.rejects(tab.playwright.waitForLoadState({state:'load',timeoutMs:250}),{name:'TimeoutError'});
    await assert.rejects(tab.goto(base+'/rate',{waitUntil:'load',timeoutMs:500}),{name:'TimeoutError'});
    assert.deepEqual(await tab.navigationInfo(),{httpStatus:429,retryAfter:'120'});
  } finally {
    await cua?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
  const netlog=JSON.parse(await readFile(netLogPath,'utf8'));
  assert(netlog.events.length>0);assert(netlog.constants.logEventTypes);
});
