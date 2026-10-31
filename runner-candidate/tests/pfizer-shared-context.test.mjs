import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
import {captureOfficialJsonRenderedTraversal} from '../src/crawler/officialJsonRenderedTraversalValidator.ts';

test('actual Pfizer validator caller creates one explicit sandboxed context for list and detail pages',async()=>{
  const country='6cb77610a8a543aea2d6bc10457e35d4',title='Synthetic scientific role';
  const detailUrl=`https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers/job/China/Synthetic_1234567?Location_Country=${country}`;
  const list=`<title>Search for Jobs</title><input><button>China clear filter</button><button>Clear All (1)</button><div data-automation-id="jobFoundText">1 JOBS FOUND</div><div data-automation-id="jobOutOfText">1 - 1 of 1 jobs</div><ul aria-label="Page 1 of 1"><li><a data-automation-id="jobTitle" href="${detailUrl}">${title}</a></li></ul>`;
  const detail=`<title>Synthetic job</title><h1 data-automation-id="jobPostingHeader">${title}</h1><button>Apply</button><div data-automation-id="job-posting-details"><dl data-automation-id="requisitionId"><dd>1234567</dd></dl><dl data-automation-id="locations"><dd>China - Beijing</dd></dl></div><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:{value:'1234567'},title,datePosted:'2026-10-01',jobLocation:{address:{addressCountry:'China',addressLocality:'CHN - Beijing'}}})}</script>`;
  const requests=[];
  const server=createServer((req,res)=>{requests.push(req.url);res.setHeader('content-type','text/html; charset=utf-8');res.end(req.url==='/detail'?detail:list);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`,contexts=[],pages=[];
  let browser;
  try {
    const result=await captureOfficialJsonRenderedTraversal({sourceId:'source-pfizer-china-social',entryUrl:'https://pfizer.wd1.myworkdayjobs.com/PfizerCareers',
      launchBrowser:async()=>{
        browser=await chromium.launch({executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium',headless:true,chromiumSandbox:true});
        return {close:()=>browser.close(),async newContext(options){
          const context=await browser.newContext({...options,serviceWorkers:'block'});contexts.push(context);context.on('page',page=>pages.push(page));
          await context.route('**/*',async route=>{
            const url=new URL(route.request().url());if(url.origin!=='https://pfizer.wd1.myworkdayjobs.com')return route.abort();
            const response=await fetch(base+(url.pathname.includes('/job/')?'/detail':'/list'));
            return route.fulfill({contentType:'text/html; charset=utf-8',body:await response.text()});
          });return context;
        }};
      }});
    assert.equal(contexts.length,1);assert.equal(pages.length,2);assert(pages.every(page=>page.context()===contexts[0]&&page.isClosed()));
    assert.equal(browser.isConnected(),false);assert.equal(result.pages.length,1);assert.equal(result.pages[0].rawRows.length,1);
    assert.equal(result.pages[0].rawRows[0].rawPayload.officialId,'1234567');assert.deepEqual(requests,['/list','/detail']);
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
