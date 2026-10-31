import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {createChromiumDom} from '../src/crawler/local-browser/chromium-dom.mjs';
import {createJnjDomRuntime} from '../src/crawler/local-browser/jnj-browser-runtime.mjs';
import {withLocalOfficialDom} from '../src/crawler/localOfficialSourceFetch.ts';
import {createSourceFetchRouter} from '../src/crawler/sourceFetchRouter.ts';
import {transportFailureDiagnosticBundle} from '../src/crawler/sourceFailureDiagnostics.ts';
import {createSourceFetchAttemptTracker} from '../src/crawler/runSourceCrawl.ts';

test('local JNJ navigation recognizes 429/managed challenge before selector waits and preserves Retry-After',async()=>{
  const server=createServer((request,response)=>{
    response.statusCode=request.url==='/rate'?429:request.url==='/challenge'?403:200;
    if(request.url==='/rate')response.setHeader('retry-after','120');
    response.setHeader('content-type','text/html; charset=utf-8');
    response.end(`<title>Just a moment...</title><script>window._cf_chl_opt={synthetic:true}</script>${request.url==='/normal'?'<h1>Displaying 1 to 1 of 1 matching jobs</h1><ul id="js-job-search-results"><li><a href="https://www.careers.jnj.com/en/jobs/r-123456/synthetic/">Synthetic</a></li></ul>':'<p>synthetic managed verification page</p>'}`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,directory=await mkdtemp(join(tmpdir(),'jnj-access-'));
  let cua;
  try {
    const confined={async launch(options){assert.equal(options.chromiumSandbox,true);const browser=await chromium.launch(options);return {
      close:()=>browser.close(),async newContext(){const context=await browser.newContext({serviceWorkers:'block'});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());return context;}};}};
    cua=await createChromiumDom({chromium:confined,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'});
    for(const path of ['/rate','/challenge','/normal']) {
      let waits=0;
      const runtime=createJnjDomRuntime({async createBrowserTab(name,url){const tab=await cua.createBrowserTab(name,url===undefined?undefined:base+path);
        const goto=tab.goto;tab.goto=(_url,options)=>goto(base+path,options);
        const locator=tab.playwright.locator;tab.playwright.locator=(...args)=>{const result=locator(...args),wait=result.waitFor;result.waitFor=async options=>{waits++;return wait(options);};return result;};return tab;}},{failureDirectory:directory});
      await runtime.start();const result=await runtime.readList();
      if(path==='/normal'){assert.equal(result.error?.transportFailure,undefined);assert.equal(waits,1);}
      else {assert.equal(waits,0);assert.equal(result.error.transportFailure.code,path==='/rate'?'OFFICIAL_HTTP_429':'OFFICIAL_BROWSER_SESSION_ERROR');
        assert.equal(result.error.transportFailure.retryAfterMs,path==='/rate'?120000:undefined);assert(result.error.privateCapture);}
      await runtime.close();
    }
  } finally {await cua?.close();await new Promise(resolve=>server.close(resolve));}
});

test('JNJ access failure uses temporary transport semantics without HTTP fallback or same-attempt retry',async()=>{
  let captures=0,httpCalls=0,delays=0;
  const error=Object.assign(Error('JNJ_HTTP_429'),{transportFailure:{code:'OFFICIAL_HTTP_429',retryable:true,retryAfterMs:120000}});
  const fetch=withLocalOfficialDom(async()=>{httpCalls++;throw Error('NO_HTTP_FALLBACK');},async()=>{captures++;throw error;});
  const router=createSourceFetchRouter({moka:fetch,profileBoundSource:fetch,fallback:fetch,delay:async()=>{delays++;}});
  const plan={source:{id:'source-johnson-innovative-medicine-social',atsKind:'OFFICIAL_JSON'},profileBoundSource:{kind:'jnj-careers-china'},transientRetryPolicy:{maxRetries:2,backoffMs:1000}};
  const tracker=createSourceFetchAttemptTracker(),old=console.error,lines=[];console.error=value=>lines.push(value);
  let result;try{result=await router(plan,tracker);}finally{console.error=old;}
  assert.equal(result.ok,false);assert.equal(result.sourceRetryExhausted,true);assert.equal(result.transportFailure.retryAfterMs,120000);
  assert.deepEqual({captures,httpCalls,delays},{captures:1,httpCalls:0,delays:0});
  assert.equal(transportFailureDiagnosticBundle(result.transportFailure,tracker).failureCategory,'TEMPORARY_OFFICIAL_SOURCE_FAILURE');
  assert.equal(tracker.retryCount,0);assert.equal(lines.length,1);
});
