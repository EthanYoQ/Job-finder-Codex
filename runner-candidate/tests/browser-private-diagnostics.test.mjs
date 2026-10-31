import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSanofiDomRuntime} from '../src/crawler/local-browser/sanofi-browser-runtime.mjs';
import {capturePfizerRenderedTraversal} from '../src/crawler/pfizerRenderedTraversal.ts';
import {sourceFetchDiagnostic} from '../src/crawler/sourceFetchDiagnostics.ts';
const marker='PRIVATE_CAPTURE_SYNTHETIC_MARKER';
async function saved(directory,error,source) {
  const files=await readdir(directory);assert.equal(files.length,1);
  const value=JSON.parse(await readFile(join(directory,files[0]),'utf8'));
  assert((value.observation.html??value.observation.list?.html).includes(marker));
  const diagnostic=sourceFetchDiagnostic(source,{error});assert.equal(diagnostic.privateCapture.file,files[0]);
  assert(!JSON.stringify(diagnostic).includes(marker));assert(!JSON.stringify(diagnostic).includes(directory));
  return {value,diagnostic};
}
for(const stage of ['SANOFI_PAGE_READ','SANOFI_PAGE_NEXT'])test(`${stage} keeps the original failure and saves the actual page privately`,async()=>{
  const failureDirectory=await mkdtemp(join(tmpdir(),'sanofi-private-'));
  const error=stage==='SANOFI_PAGE_READ'?new ReferenceError(marker):Object.assign(Error('locator.click: Timeout 30000ms exceeded.'),{name:'TimeoutError'});
  const tab={async getAXState(){},async close(){},async url(){return 'https://jobs.sanofi.cn/synthetic';},playwright:{
    locator:()=>({async isVisible(){return false;},async waitFor(){if(stage==='SANOFI_PAGE_READ')throw error;},async evaluate(){return {nextDisabled:false,searchResultsHtml:'synthetic'};},async click(){throw error;}}),
    async waitForLoadState(){},async evaluate(){return {html:'<html>'+marker+'</html>',nextLinks:[{display:'none'}]};}}};
  const runtime=createSanofiDomRuntime({async createBrowserTab(){return tab;}},{failureDirectory});await runtime.start();
  await assert.rejects(stage==='SANOFI_PAGE_READ'?runtime.readPage():runtime.advance(),actual=>actual===error);
  const {value,diagnostic}=await saved(failureDirectory,error,'source-sanofi-china-social');
  assert.equal(value.pageNumber,1);assert.equal(diagnostic.page,1);assert.equal(diagnostic.stage,stage);
});
const entry='https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers?Location_Country=6cb77610a8a543aea2d6bc10457e35d4';
test('Pfizer navigation diagnostics retain status/redirect evidence without accepting non-200, changed URL or absent response',async()=>{
  for(const kind of ['status','url','null']) {
    const failureDirectory=await mkdtemp(join(tmpdir(),'pfizer-private-'));
    const page={locator:()=>({}),async goto(){return kind==='null'?null:{status:()=>kind==='status'?403:200,url:()=>entry};},
      url:()=>kind==='url'?entry+'&unexpected=1':entry,async evaluate(){return {html:marker};}};
    let error;try{await capturePfizerRenderedTraversal(page,undefined,{failureDirectory});assert.fail('must fail');}catch(value){error=value;}
    assert.equal(error.message,'Pfizer UI entry navigation failed');
    const {value,diagnostic}=await saved(failureDirectory,error,'source-pfizer-china-social');
    assert.equal(diagnostic.stage,'PFIZER_ENTRY_NAVIGATION');assert.equal(value.navigationStatus,kind==='null'?undefined:kind==='status'?403:200);
  }
});
for(const stage of ['PFIZER_CARDS_READY','PFIZER_COUNTRY_READY'])test(`${stage} preserves readiness error after a valid navigation`,async()=>{
  const failureDirectory=await mkdtemp(join(tmpdir(),'pfizer-private-'));
  const error=Object.assign(Error('locator.waitFor: Timeout 60000ms exceeded.'),{name:'TimeoutError'});
  const cards={first(){return this;},async waitFor(){if(stage==='PFIZER_CARDS_READY')throw error;}};
  const page={locator:()=>cards,async goto(){return {status:()=>200,url:()=>entry};},url:()=>entry,
    getByRole:()=>({async waitFor(){throw error;}}),async evaluate(){return {html:marker};}};
  await assert.rejects(capturePfizerRenderedTraversal(page,undefined,{failureDirectory}),actual=>actual===error);
  const {diagnostic}=await saved(failureDirectory,error,'source-pfizer-china-social');assert.equal(diagnostic.stage,stage);
});
for(const stage of ['PFIZER_DETAIL_CREATE','PFIZER_LIST_READ','PFIZER_DETAIL_READ'])test(`${stage} captures dynamic traversal errors and both page contexts`,async()=>{
  const failureDirectory=await mkdtemp(join(tmpdir(),'pfizer-traversal-private-'));
  const error=Error('Synthetic dynamic browser error '+marker),href='https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers/job/China/Synthetic_1234567';
  let closed=false;
  const detail={async goto(){throw error;},async evaluate(){assert.equal(closed,false);return {html:marker+' detail'};},async close(){closed=true;}};
  const page={url:()=>entry,async goto(){return {status:()=>200,url:()=>entry};},getByRole:()=>({async waitFor(){}}),
    context:()=>({async newPage(){if(stage==='PFIZER_DETAIL_CREATE')throw error;return detail;}}),
    locator:selector=>({first(){return this;},filter(){return this;},async waitFor(){if(stage==='PFIZER_LIST_READ'&&selector.includes('jobFoundText'))throw error;},
      async getAttribute(){return 'Page 1 of 1';},async innerText(){return selector.includes('jobFoundText')?'1 JOBS FOUND':'1 - 1 of 1 jobs';},
      async evaluateAll(){return [{href,title:'Synthetic role'}];}}),async evaluate(){return {html:marker+' list'};}};
  await assert.rejects(capturePfizerRenderedTraversal(page,undefined,{failureDirectory}),actual=>actual===error);
  const {value,diagnostic}=await saved(failureDirectory,error,'source-pfizer-china-social');
  assert.equal(diagnostic.stage,stage);assert.equal(value.error.message,error.message);
  assert.equal(value.currentPage,stage==='PFIZER_DETAIL_CREATE'?undefined:1);
  assert.equal(closed,stage!=='PFIZER_DETAIL_CREATE');
  if(stage==='PFIZER_DETAIL_READ'){assert.equal(value.currentRecord,0);assert.equal(value.currentCard.href,href);assert.equal(value.observation.detail.html,marker+' detail');}
});
