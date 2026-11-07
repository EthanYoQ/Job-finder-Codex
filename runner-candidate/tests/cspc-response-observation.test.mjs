import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createChromiumDom} from '../src/crawler/local-browser/chromium-dom.mjs';

const endpoint='https://ehr.e-cspc.com:8081/RedseaPlatform/zhaopin/zpChannelQrCode/queryPostList.mob';
const tick=()=>new Promise(setImmediate);
async function fixture(){
 const page=new EventEmitter(),context=new EventEmitter(),frame={};let current='about:blank',closed=0;
 page.mainFrame=()=>frame;page.url=()=>current;page.close=async()=>page.emit('close');
 page.goto=async url=>{current=url;const response={url:()=>url,status:()=>200,headers:()=>({}),headerValue:async()=>null,
  request:()=>({isNavigationRequest:()=>true}),frame:()=>frame};page.emit('response',response);return response;};
 context.newPage=async()=>{context.emit('page',page);return page;};
 const chromium={async launch(options){assert.equal(options.chromiumSandbox,true);return {newContext:async()=>context,async close(){closed++;await page.close();}};}};
 const cua=await createChromiumDom({chromium}),tab=await cua.createBrowserTab('cdp');
 await tab.goto('https://example.invalid/root');
 const emit=(json,url=endpoint,method='POST')=>page.emit('response',{url:()=>url,status:()=>200,frame:()=>frame,
  request:()=>({isNavigationRequest:()=>false,method:()=>method,postData:()=> 'channelQrId=channel&root_id=cspc&recruit_way=4&keyword=&peopleId=PRIVATE_PERSON&access_token=PRIVATE_TOKEN'}),json});
 return {tab,cua,emit,closed:()=>closed};
}

test('CSPC native response result is diagnostic only and excludes personal/request/response bodies',async()=>{
 const f=await fixture();
 try{
  let reads=0;f.emit(async()=>{reads++;throw Error('Unrelated response must not be read');},'https://other.invalid/list');
  f.emit(async()=>{reads++;throw Error('GET must not be read');},endpoint,'GET');
  assert.equal(reads,0);assert.deepEqual(await f.tab.navigationInfo(),{httpStatus:200,retryAfter:null});
  for(const rows of [[],[{id:'job',description:'PRIVATE_BODY'}]]){
   let complete;const body=new Promise(resolve=>{complete=resolve;});f.emit(()=>body);
   assert.equal((await f.tab.navigationInfo()).cspcListResponse.result,undefined,'Observation never waits for a pending body');
   complete({state:'1',total:'',jsonList:rows});await tick();
   const nav=await f.tab.navigationInfo();assert.equal(nav.httpStatus,200);
   assert.deepEqual(nav.cspcListResponse,{httpStatus:200,scope:{channelQrId:'channel',root_id:'cspc',recruit_way:'4',keyword:''},otherNonEmptyFieldCount:2,result:{state:'1',total:'',jsonListCount:rows.length}});
   assert(!/PRIVATE_PERSON|PRIVATE_TOKEN|PRIVATE_BODY/.test(JSON.stringify(nav)));
  }
  await f.tab.goto('https://example.invalid/new');
  assert.deepEqual(await f.tab.navigationInfo(),{httpStatus:200,retryAfter:null},'Navigation clears the old observation');
 }finally{await f.cua.close();}
 assert.equal(f.closed(),1);
});

test('CSPC unreadable JSON preserves navigation and records unavailable result',async()=>{
 const f=await fixture();
 try{
  f.emit(async()=>{throw Error('PRIVATE_BODY_FAILURE');});await tick();
  const nav=await f.tab.navigationInfo();assert.equal(nav.httpStatus,200);assert.equal(nav.cspcListResponse.resultUnavailable,true);
  assert.equal(nav.cspcListResponse.result,undefined);assert(!JSON.stringify(nav).includes('PRIVATE_BODY_FAILURE'));
 }finally{await f.cua.close();}
 assert.equal(f.closed(),1);
});
