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
  assert(value.observation.html.includes(marker));
  const diagnostic=sourceFetchDiagnostic(source,{error});assert.equal(diagnostic.privateCapture.file,files[0]);
  assert(!JSON.stringify(diagnostic).includes(marker));assert(!JSON.stringify(diagnostic).includes(directory));
  return {value,diagnostic};
}
for(const stage of ['SANOFI_PAGE_READ','SANOFI_PAGE_NEXT'])test(`${stage} keeps the original failure and saves the actual page privately`,async()=>{
  const failureDirectory=await mkdtemp(join(tmpdir(),'sanofi-private-'));
  const error=stage==='SANOFI_PAGE_READ'?new ReferenceError(marker):Object.assign(Error('locator.click: Timeout 30000ms exceeded.'),{name:'TimeoutError'});
  const tab={async getAXState(){},async close(){},async url(){return 'https://jobs.sanofi.cn/synthetic';},playwright:{
    locator:()=>({async waitFor(){if(stage==='SANOFI_PAGE_READ')throw error;},async evaluate(){return {nextDisabled:false,searchResultsHtml:'synthetic'};},async click(){throw error;}}),
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
