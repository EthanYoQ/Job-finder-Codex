import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {capturePfizerRenderedTraversal,replayPfizerRenderedRow} from '../src/crawler/pfizerRenderedTraversal.ts';
import {replayOfficialJsonRenderedTraversal} from '../src/crawler/officialJsonRenderedTraversalValidator.ts';
const origin='https://pfizer.wd1.myworkdayjobs.com',entry=origin+'/en-US/PfizerCareers',country='6cb77610a8a543aea2d6bc10457e35d4';
const id=n=>String(1234500+n),url=n=>entry+`/job/China/Role_${id(n)}?Location_Country=${country}`;
const cards=(from,to)=>Array.from({length:to-from+1},(_,i)=>from+i).map(n=>`<li><a data-automation-id="jobTitle" href="${url(n)}">Listing ${n}</a></li>`).join('');
const list=`<title>Search for Jobs</title><input><button>China clear filter</button><button>Clear All (1)</button><div data-automation-id="jobFoundText">21 JOBS FOUND</div><div data-automation-id="jobOutOfText">1 - 20 of 21 jobs</div><ul aria-label="Page 1 of 2">${cards(1,20)}</ul><button onclick='window.page2Visited=true;document.querySelector("ul").setAttribute("aria-label","Page 2 of 2");document.querySelector("ul").innerHTML=${JSON.stringify(cards(21,21))};document.querySelector("[data-automation-id=jobOutOfText]").textContent="21 - 21 of 21 jobs";this.remove()'>next</button>`;
function detail(n,wrong){return `<title>Official role</title><h1 data-automation-id="jobPostingHeader">Official ${n}</h1><button>Apply</button><div data-automation-id="job-posting-details"><dl data-automation-id="requisitionId"><dd>${wrong?'7654321':id(n)}</dd></dl><dl data-automation-id="locations"><dd>China - Shanghai</dd></dl></div><script type="application/ld+json">${JSON.stringify({'@type':'JobPosting',identifier:{value:id(n)},title:`Official ${n}`,jobLocation:{address:{addressCountry:'China',addressLocality:'CHN - Shanghai'}}})}</script>`;}
for(const mode of ['503','wrong-id','429','iframe-429','list-429'])test(`Pfizer native independent ${mode}: complete list first, isolate bad detail and settle its page`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'pfizer-independent-')),browser=await chromium.launch({executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium',headless:true,chromiumSandbox:true});
 try{
  const context=await browser.newContext({serviceWorkers:'block'}),requests=[],tabs=[];context.on('page',page=>tabs.push(page));
  const page=await context.newPage();
  await context.route('**/*',async route=>{
   const target=new URL(route.request().url());if(target.origin!==origin)return route.abort();
   if(target.pathname.startsWith('/wday/cxs/'))return route.fulfill({status:429,headers:{'retry-after':'120'},body:'Limited'});
   if(!target.pathname.includes('/job/'))return route.fulfill({contentType:'text/html; charset=utf-8',body:mode==='list-429'?`<title>Search for Jobs</title><input><button>China clear filter</button><button>Clear All (1)</button><div data-automation-id="jobFoundText">3 JOBS FOUND</div><div data-automation-id="jobOutOfText">1 - 3 of 3 jobs</div><ul aria-label="Page 1 of 1">${cards(1,3)}</ul><script>const r=new XMLHttpRequest();r.open("GET","${origin}/wday/cxs/pfizer/PfizerCareers/jobs",false);r.send();</script>`:list});
   assert.equal(await page.evaluate(()=>window.page2Visited),true,'Every list page must close before the first detail');
   const n=Number(target.pathname.match(/_(\d{7})$/u)?.[1])-1234500;requests.push(n);
   return route.fulfill({status:n===2&&['503','429'].includes(mode)?Number(mode):200,contentType:'text/html; charset=utf-8',body:n===2&&['503','429'].includes(mode)?'<title>Unavailable</title>':detail(n,n===2&&mode==='wrong-id')+(n===2&&mode==='iframe-429'?`<iframe src="${origin}/wday/cxs/pfizer/PfizerCareers/job/China/blocked"></iframe>`:'')});
  });
  if(mode==='list-429'){await assert.rejects(capturePfizerRenderedTraversal(page,undefined,{failureDirectory:directory}),/list access restricted/);assert.deepEqual(requests,[]);return;}
  const pages=await capturePfizerRenderedTraversal(page,undefined,{failureDirectory:directory}),replay=replayOfficialJsonRenderedTraversal('source-pfizer-china-social',pages);
  assert.equal(pages.length,2);assert.equal(replay.rawCount,21);assert.equal(replay.matchKeys.length,['429','iframe-429'].includes(mode)?1:20);
  assert.deepEqual(requests,['429','iframe-429'].includes(mode)?[1,2]:Array.from({length:21},(_,i)=>i+1));
  for(const p of pages)for(const [index,row]of p.rawRows.entries())replayPfizerRenderedRow(row,index);
  assert.equal(tabs.filter(tab=>tab!==page&&!tab.isClosed()).length,0,'All detail pages, including the failed operation, must finish');
 }finally{await browser.close();await rm(directory,{recursive:true,force:true});}
});
