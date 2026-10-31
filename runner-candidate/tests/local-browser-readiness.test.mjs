import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCspcDomRuntime} from '../src/crawler/local-browser/cspc-browser-runtime.mjs';
import {createSanofiDomRuntime} from '../src/crawler/local-browser/sanofi-browser-runtime.mjs';

const timeout=()=>Object.assign(Error('page.waitForLoadState: Timeout 10000ms exceeded.'),{name:'TimeoutError'});
const failureDirectory=await mkdtemp(join(tmpdir(),'readiness-private-diagnostic-'));
function fixture(kind,{waitError=timeout(),navigationError,onWait=()=>{}}={}) {
  let waitCalls=0,navigations=0,url,bodyReads=0;
  const terminal={rowCount:1,disabledNextCount:1,disabledJumpNextCount:1,enabledNextCount:0,loadMoreCount:0};
  const locator={first(){return this;},async waitFor(options){assert(options.timeoutMs>0&&options.timeoutMs<=10000);},
    async evaluate(){return kind==='sanofi'?{searchResultsHtml:'<section>synthetic</section>',nextDisabled:false}:
      ++bodyReads===1?{keyword:'',selectedFilters:[]}:bodyReads===2?terminal:'<html>synthetic</html>';},
    async evaluateAll(){return [{index:0,title:'Synthetic role',text:'Synthetic role'}];}};
  const tab={id:'local-test',async goto(value){url=value;navigations++;if(navigationError)throw navigationError;},
    async getAXState(){return 'synthetic';},async url(){return url;},async close(){},
    playwright:{frameLocator(){return {locator:()=>locator};},locator:()=>locator,
      async waitForLoadState(options){assert(options.timeoutMs>0&&options.timeoutMs<=10000);onWait();if(++waitCalls===1)throw waitError;},
      async evaluate(){return '<html>synthetic</html>';},async domSnapshot(){return 'synthetic';}}};
  const cua={async createBrowserTab(_browser,value){if(value!==undefined)await tab.goto(value);return tab;}};
  const runtime=kind==='sanofi'?createSanofiDomRuntime(cua,{failureDirectory}):createCspcDomRuntime(cua);
  return {runtime,counts:()=>({waitCalls,navigations}),async run(){
    const now=Date.now();
    if(kind==='sanofi'){await runtime.start(now+60000);return runtime.readPage();}
    return runtime.start({runStartedAt:new Date(now).toISOString(),dispatchBefore:new Date(now+60000).toISOString()});
  }};
}
for(const kind of ['cspc','sanofi']) {
  test(`${kind} continues the same tab after native Playwright TimeoutError within the existing readiness budget`,async()=>{
    const setup=fixture(kind,kind==='cspc'?{navigationError:timeout()}:{});
    const result=await setup.run();assert(result);assert.deepEqual(setup.counts(),{waitCalls:2,navigations:1});
  });
  test(`${kind} preserves non-timeout failures without waiting again`,async()=>{
    const error=new ReferenceError('synthetic unavailable browser symbol'),setup=fixture(kind,{waitError:error});
    await assert.rejects(setup.run(),actual=>actual===error);assert.equal(setup.counts().waitCalls,1);
  });
  test(`${kind} never extends the existing overall readiness deadline`,async t=>{
    let now=Date.now();t.mock.method(Date,'now',()=>now);
    const setup=fixture(kind,{onWait:()=>{now+=61000;}});
    await assert.rejects(setup.run(),{message:kind==='cspc'?'CSPC_DOM_LOADING_TIMEOUT':'SANOFI_CN_DOM_LOADING_TIMEOUT'});
    assert.deepEqual(setup.counts(),{waitCalls:1,navigations:1});
  });
}
