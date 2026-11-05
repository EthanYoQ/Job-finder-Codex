import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {createChromiumDom} from '../src/crawler/local-browser/chromium-dom.mjs';
import {createSanofiDomRuntime} from '../src/crawler/local-browser/sanofi-browser-runtime.mjs';
import {validateSanofiChineseDom} from '../src/crawler/sanofiChineseRenderedTraversal.ts';
import {SANOFI_CN_ENTRY} from '../src/crawler/sanofiChineseNative.ts';

test('Sanofi waits for each current page and captures complete DOM without document load or ARIA snapshots', async () => {
  const events = [];
  let page = 1;
  const html = number => `<section id="search-results" data-location="中国" data-keywords="" data-location-path="1814991" data-organization-ids="2649" data-current-page="${number}" data-total-pages="2" data-total-job-results="16" data-records-per-page="15"><ul id="search-results-list">${Array.from({length:number===1?15:1},(_,index)=>{
    const id=(number-1)*15+index+1;
    return `<li><button class="js-save-job-btn" data-job-id="${id}"></button><a data-job-id="${id}" href="/job/synthetic/3036/${id}"><h2>Synthetic role ${id}</h2></a></li>`;
  }).join('')}</ul><input class="pagination-current" value="${number}" max="2"><a class="next${number===2?' disabled':''}">Next</a></section>`;
  const tab = {
    url: async () => SANOFI_CN_ENTRY,
    close: async () => events.push('close'),
    playwright: {
      waitForLoadState: async () => assert.fail('Complete current-page DOM must not wait for document load'),
      locator(selector) {
        if(selector === '#onetrust-reject-all-handler')return {isVisible:async()=>false};
        if(selector === '#search-results a.next')return {click:async()=>{events.push(`next:${page}`);page++;}};
        assert.equal(selector, `#search-results[data-current-page="${page}"]`);
        return {
          waitFor:async ({state})=>events.push(`root:${state}:${page}`),
          evaluate:async callback=>{
            events.push(`capture:${page}`);
            return callback({outerHTML:html(page),
              querySelector:()=>({classList:{contains:()=>page===2}})});
          }
        };
      }
    }
  };
  const runtime=createSanofiDomRuntime({createBrowserTab:async()=>tab});
  try {
    await runtime.start();
    const first=await runtime.readPage();
    assert.equal(first.nextDisabled,false);
    assert.deepEqual(await runtime.advance(),{pageNumber:2});
    const last=await runtime.readPage();
    assert.equal(last.nextDisabled,true);
    assert.equal(last.page.searchResultsHtml,html(2));
    assert.equal(validateSanofiChineseDom({schemaVersion:'sanofi-cn-cua-dom-list-v1',
      observedAt:first.page.capturedAt,pages:[first.page,last.page]}).total,16);
  } finally {await runtime.close();}
  assert.deepEqual(events,['root:visible:1','capture:1','next:1',
    'root:visible:2','capture:2','close']);
});

test('Sanofi normally rejects optional cookies then clicks next through the original UI',async()=>{
  const server=createServer((request,response)=>{response.setHeader('content-type','text/html; charset=utf-8');
    const cookie=request.url==='/cookie';
    response.end(`<section id="search-results" data-current-page="1"><p>Synthetic jobs</p><a class="next" href="#" onclick="event.preventDefault();window.nextClicks=(window.nextClicks||0)+1;document.querySelector('#search-results').dataset.currentPage='2'">下一页</a></section>${cookie?`<div class="onetrust-pc-dark-filter" style="position:fixed;inset:0;background:#3338;z-index:10"></div><button id="onetrust-reject-all-handler" style="position:fixed;top:30px;left:30px;z-index:11" onclick="window.cookieChoice='rejected';document.querySelector('.onetrust-pc-dark-filter').remove();this.remove()">全部拒絕</button>`:''}`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,directory=await mkdtemp(join(tmpdir(),'sanofi-cookie-test-'));
  let cua;
  try {
    const confined={async launch(options){assert.equal(options.chromiumSandbox,true);const browser=await chromium.launch(options);return {
      close:()=>browser.close(),async newContext(){const context=await browser.newContext({serviceWorkers:'block'});
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());return context;}};}};
    cua=await createChromiumDom({chromium:confined,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'});
    for(const path of ['/cookie','/plain']) {
      let tab;
      const runtime=createSanofiDomRuntime({async createBrowserTab(name){return tab=await cua.createBrowserTab(name,base+path);}},{failureDirectory:directory});
      await runtime.start();assert.equal((await runtime.readPage()).nextDisabled,false);await runtime.advance();
      const state=await tab.playwright.evaluate(()=>({choice:window.cookieChoice??null,clicks:window.nextClicks,page:document.querySelector('#search-results').dataset.currentPage}));
      assert.deepEqual(state,{choice:path==='/cookie'?'rejected':null,clicks:1,page:'2'});await runtime.close();
    }
  } finally {await cua?.close();await new Promise(resolve=>server.close(resolve));}
});
