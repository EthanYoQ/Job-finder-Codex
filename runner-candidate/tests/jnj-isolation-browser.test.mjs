import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright-core';
import {fixture} from './jnj-observation-fixture.mjs';
import {createChromiumDom} from '../src/crawler/local-browser/chromium-dom.mjs';
import {captureOfficialDom} from '../src/crawler/local-browser/official-dom.mjs';
import {createJnjCareersDomSourceFetch} from '../src/crawler/jnjCareersDomEvidence.ts';
import {loadDirectPlans} from '../scripts/direct-round.ts';
import {runSourceCrawl} from '../src/crawler/runSourceCrawl.ts';

for(const mode of ['identity','429'])test(`synthetic JNJ browser capture isolates ${mode} and respects later requests`,async()=>{
 const input=fixture(3),requests=[],directory=await mkdtemp(join(tmpdir(),'jnj-browser-isolation-')),oldRoot=process.env.JOBFINDER_STATE_ROOT;
 process.env.JOBFINDER_STATE_ROOT=directory;let cua;
 const confined={async launch(options){assert.equal(options.chromiumSandbox,true);const browser=await chromium.launch(options);return {
  close:()=>browser.close(),async newContext(){const context=await browser.newContext({serviceWorkers:'block'});
   // All traffic is fulfilled from fabricated observations; no external request is allowed.
   await context.route('**/*',async route=>{
    const url=route.request().url();
    if(url===input.list.url.split('#')[0]){
     const filters=input.list.filters.map(f=>`<select id="${f.id}" name="${f.name}">${f.name==='country'?'<option value="China" selected>China</option>':''}</select>`).join('');
     return route.fulfill({status:200,contentType:'text/html',body:`<h1>${input.list.heading}</h1>${filters}${input.list.fragment.html}<a aria-label="Page 1" href="${input.list.url}">1</a>`});
    }
    const index=input.details.findIndex(d=>d.url===url);if(index<0)return route.abort();requests.push(url);
    if(mode==='429'&&index===1)return route.fulfill({status:429,headers:{'retry-after':'120'},contentType:'text/html',body:'<h1>Rate limited</h1>'});
    const detail=input.details[index];return route.fulfill({status:200,contentType:'text/html',body:`<h1>${index===1?'Different role':detail.heading}</h1>${detail.body.html}<a href="${detail.applyLinks[0].href}">Apply now</a>`});
   });return context;}};}};
 try{
  cua=await createChromiumDom({chromium:confined,executablePath:process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium'});
  const sourceId='source-johnson-innovative-medicine-social',capture=await captureOfficialDom(sourceId,cua);
  assert.equal(capture.details.length,3);assert.equal(JSON.parse(capture.details[1]).kind,'JNJ_DETAIL_CAPTURE_UNAVAILABLE');assert.deepEqual(requests,input.details.slice(0,mode==='429'?2:3).map(d=>d.url));
  if(mode==='429'){assert.equal(JSON.parse(capture.details[1]).retryAfterMs,120000);assert.equal(JSON.parse(capture.details[2]).code,'JNJ_DETAIL_ACCESS_STOPPED');}
  const plan=(await loadDirectPlans()).find(row=>row.sourceId===sourceId).plan;
  const result=await runSourceCrawl(plan,{fetch:createJnjCareersDomSourceFetch(capture),isBaseline:false});
  assert.equal(result.truth.completenessVerified,true,JSON.stringify(result.observation));assert.deepEqual(result.jobs.map(j=>j.sourceJobId),mode==='429'?['r-000001']:['r-000001','r-000003']);assert.equal(result.fetchEvidence.jobQuarantines[0].sourceJobId,'r-000002');
 }finally{await cua?.close();if(oldRoot===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=oldRoot;await rm(directory,{recursive:true,force:true});}
});
