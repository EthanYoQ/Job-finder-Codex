import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
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
      addLocatorHandler: async () => {},
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
              getAttribute:()=> '16',querySelectorAll:()=>Array.from({length:page===1?15:1}),
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

test('Sanofi captures complete rendered lists and handles cookies through the normal UI',async t=>{
  const list=(number,count=number===1?15:1)=>`<section id="search-results" data-location="中国" data-keywords="" data-location-path="1814991" data-organization-ids="2649" data-current-page="${number}" data-total-pages="2" data-total-job-results="16" data-records-per-page="15"><ul id="search-results-list">${Array.from({length:count},(_,index)=>{
    const id=(number-1)*15+index+1;
    return `<li><a data-job-id="${id}" href="/job/synthetic/3036/${id}"><h2>Synthetic role ${id}</h2></a></li>`;
  }).join('')}</ul><input class="pagination-current" value="${number}" max="2"><a class="next${number===2?' disabled':''}" href="#">下一页</a></section>`;
  const server=createServer((request,response)=>{response.setHeader('content-type','text/html; charset=utf-8');
    const cookie=['/cookie','/late-cookie'].includes(request.url),late=request.url==='/late-cookie',lateRows=request.url==='/late-rows';
    response.end(`${list(1,lateRows||request.url==='/incomplete-rows'?0:15)}${cookie?`<div id="cookie-banner" ${late?'hidden':''}><div class="onetrust-pc-dark-filter ot-fade-in" style="position:fixed;inset:0;background:#3338;z-index:10"></div><button id="onetrust-reject-all-handler" style="position:fixed;top:30px;left:30px;z-index:11" onclick="window.cookieChoice='rejected';document.querySelector('#cookie-banner').remove()">全部拒絕</button></div>`:''}<script>
      const next=document.querySelector('a.next');
      next.style.visibility=${JSON.stringify(late?'hidden':'visible')};
      next.onclick=event=>{event.preventDefault();window.nextClicks=(window.nextClicks||0)+1;document.querySelector('#search-results').outerHTML=${JSON.stringify(list(2,lateRows?0:1))};${lateRows?`setTimeout(()=>document.querySelector('#search-results').outerHTML=${JSON.stringify(list(2))},100);`:''}};
      window.populateRows=()=>document.querySelector('#search-results-list').innerHTML=${JSON.stringify(list(1).match(/<ul id="search-results-list">([\s\S]*?)<\/ul>/)[1])};
      window.showCookieBanner=()=>{document.querySelector('#cookie-banner').hidden=false;next.style.visibility='visible'};
    </script>`);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,cache=join(process.cwd(),'.runtime','.cache');
  await mkdir(cache,{recursive:true});
  const directory=await mkdtemp(join(cache,'sanofi-cookie-test-'));
  let cua;
  try {
    const confined={async launch(options){assert.equal(options.chromiumSandbox,true);const browser=await chromium.launch(options);return {
      close:()=>browser.close(),async newContext(){const context=await browser.newContext({serviceWorkers:'block'});
        context.setDefaultTimeout(1500);
        await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());return context;}};}};
    cua=await createChromiumDom({chromium:confined,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'});
    for(const path of ['/cookie','/plain','/late-cookie','/late-rows','/incomplete-rows'])await t.test(path,async()=>{
      const tab=await cua.createBrowserTab('cdp',base+path);
      const runtime=createSanofiDomRuntime({async createBrowserTab(){return tab;}},{failureDirectory:directory});
      await runtime.start(path==='/incomplete-rows'?Date.now()+1000:undefined);
      if(path==='/incomplete-rows'){
        await assert.rejects(runtime.readPage(),error=>error.message==='SANOFI_CN_DOM_LOADING_TIMEOUT'&&error.sourceFetchStage==='SANOFI_PAGE_READ'&&!!error.privateCapture);
        assert.equal(await tab.playwright.evaluate(()=>window.nextClicks??0),0);
        await runtime.close();return;
      }
      const reading=runtime.readPage();
      if(path==='/late-rows')await tab.playwright.evaluate(()=>setTimeout(window.populateRows,100));
      const first=await reading;assert.equal(first.nextDisabled,false);
      const advancing=runtime.advance();
      if(path==='/late-cookie')await tab.playwright.evaluate(()=>setTimeout(window.showCookieBanner,100));
      await advancing;
      const last=await runtime.readPage();assert.equal(last.nextDisabled,true);
      assert.equal(validateSanofiChineseDom({schemaVersion:'sanofi-cn-cua-dom-list-v1',observedAt:first.page.capturedAt,
        pages:[first.page,last.page].map(page=>({...page,url:SANOFI_CN_ENTRY}))}).total,16);
      const state=await tab.playwright.evaluate(()=>({choice:window.cookieChoice??null,clicks:window.nextClicks,page:document.querySelector('#search-results').dataset.currentPage}));
      assert.deepEqual(state,{choice:['/cookie','/late-cookie'].includes(path)?'rejected':null,clicks:1,page:'2'});await runtime.close();
    });
  } finally {await cua?.close();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
