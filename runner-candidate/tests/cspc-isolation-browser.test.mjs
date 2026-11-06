import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {createChromiumDom} from '../src/crawler/local-browser/chromium-dom.mjs';
import {captureOfficialDom} from '../src/crawler/local-browser/official-dom.mjs';
const channel='0beb3022-3214-4333-a2e7-20786c4916d5',origin='https://ehr.e-cspc.com:8081',entry=origin+'/RedseaPlatform/zhaopin/zpChannelQrCode/'+channel+'/officeWebsite.mob',id=n=>`${n}1111111-1111-4111-8111-111111111111`;
for(const mode of ['empty-detail','iframe-429'])test(`CSPC browser ${mode} settles failed tabs before continuing`,{timeout:45000},async t=>{
 const temp=await mkdtemp(join(tmpdir(),'cspc-isolation-')),previous=process.env.JOBFINDER_STATE_ROOT;process.env.JOBFINDER_STATE_ROOT=temp;
 t.after(async()=>{if(previous===undefined)delete process.env.JOBFINDER_STATE_ROOT;else process.env.JOBFINDER_STATE_ROOT=previous;await rm(temp,{recursive:true,force:true});});
 const calls=[];let browser,context;
 const isolated={launch:async options=>{assert.equal(options.chromiumSandbox,true);browser=await chromium.launch(options);return {newContext:async config=>{context=await browser.newContext(config);await context.route('**/*',async route=>{
  const u=new URL(route.request().url());assert.equal(u.origin,origin);calls.push(u.href);const native=u.searchParams.get('detailRequestId'),n=native?Number(native[0]):undefined,frame=u.pathname.endsWith('/officePage.mob');
  let body,status=200;
  if(!frame){const params=new URLSearchParams({pageId:n?'detail':'list',...(native?{detailRequestId:native}:{})});body=`<iframe id="recruit-content-iframe" src="/RedseaPlatform/zhaopin/zpChannelQrCode/officePage.mob?${params}"></iframe>`;}
  else if(!n){body=`<input placeholder="请输入岗位名称" value=""><table class="vxe-table--body"><tbody>${[1,2,3].map(n=>`<tr><td><a target="_blank" href="${entry}?${new URLSearchParams({jumpPageId:'detail',detailRequestId:id(n),rootId:'cspc',configId:channel,recruitWay:'e264521b-64fa-4e3b-aec7-720913ac635d'})}">Role ${n}</a></td></tr>`).join('')}</tbody></table><div class="vxe-pager"><button class="vxe-pager--next-btn is--disabled">Next</button><button class="vxe-pager--jump-next is--disabled">Last</button></div>`;}
  else{status=n===2&&mode==='iframe-429'?429:200;body=`<div class="school-recruit-detail-head-L-h1"><span>Role ${n}</span></div><div class="school-recruit-detail-textBox">岗位职责 Research</div><div class="school-recruit-detail-textBox" style="width:100px;height:20px">${n===2?'':'Requirements'}</div>`;}
  await route.fulfill({status,contentType:'text/html; charset=utf-8',headers:status===429?{'retry-after':'120'}:{},body});
 });return context;},close:()=>browser.close()};}};
 const cua=await createChromiumDom({chromium:isolated,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{const captured=await captureOfficialDom('source-cspc-social',cua);assert.equal(captured.dom.rows.length,3);assert.equal(captured.dom.rows[0].captureFailure,undefined,JSON.stringify(captured.dom.rows));assert.equal(captured.dom.rows[1].captureFailure,true);
  if(mode==='empty-detail'){assert.equal(captured.dom.rows[2].captureFailure,undefined);assert(calls.some(url=>url.includes(id(3))));}
  else{assert.equal(captured.dom.rows[2].captureFailure,true);assert.equal(calls.some(url=>url.includes(id(3))),false);assert.equal(captured.dom.accessStopped,true);}
  assert.equal(context.pages().length,0,'Collector releases list and detail pages');
 }finally{await cua.close();}
 assert.equal(browser.isConnected(),false);
});
