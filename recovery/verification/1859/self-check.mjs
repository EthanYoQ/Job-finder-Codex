// One artificial detail Apply-wait failure; no real browser, HTTP, database or production raw.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const X=new URL('./',import.meta.url),prefix='https://pfizer.wd1.myworkdayjobs.com/en-US/PfizerCareers';
const entry=prefix+'?Location_Country=6cb77610a8a543aea2d6bc10457e35d4',job=prefix+'/job/Shanghai/Artificial_1234567';
const waitError=new Error('Playwright selector deadline exceeded'),A=Object.getPrototypeOf(async function(){}).constructor;
async function capture(version) {
  let creates=0,closes=0,navigations=0,detailUrl=job+'?artificial=loading';
  const waits=[],events=[],saved=[];
  const wait=kind=>async options=>{waits.push({kind,...options});if(kind==='detail-apply')throw waitError;};
  const list={url:async()=>entry,title:async()=>'Artificial list',close:async()=>{events.push('close-list');closes++;},playwright:{
    locator:selector=>({
      '[data-automation-id="jobTitle"]':{first:()=>({waitFor:wait('list-title')}),evaluateAll:async()=>[{href:job,title:'Artificial'}]},
      '[data-automation-id="jobFoundText"]':{filter:()=>({waitFor:wait('list-total')}),innerText:async()=>'1 JOBS FOUND'},
      'ul[aria-label^="Page "]':{getAttribute:async()=>'Page 1 of 1'},
      '[data-automation-id="jobOutOfText"]':{innerText:async()=>'1 - 1 of 1'}
    })[selector]??assert.fail('Unexpected list selector'),
    getByRole:(role,query)=>query.name==='China clear filter'?{waitFor:wait('list-country'),getAttribute:async()=>'China clear filter'}:
      query.name==='next'?{count:async()=>0}:query.name==='Search'?{evaluate:async()=>''}:{innerText:async()=>'Clear All (1)'},
    domSnapshot:async()=>'Artificial list snapshot'
  }};
  const detail={goto:async url=>{assert.equal(url,job);navigations++;},getAXState:async()=>{},url:async()=>{events.push('read-detail-url');return detailUrl;},
    close:async()=>{events.push('close-detail');closes++;},playwright:{
      locator:selector=>selector==='[data-automation-id="jobPostingHeader"]'?{waitFor:wait('detail-title')}:assert.fail('No later detail read'),
      getByRole:(role,query)=>{assert.equal(role,'button');assert.equal(query.name,'Apply');return {waitFor:wait('detail-apply')};},
      domSnapshot:async()=>{events.push('read-detail-dom');return 'Artificial detail loading snapshot';}
    }};
  const context=vm.createContext({URL,Date,Set,cua:{createBrowserTab:async()=>++creates===1?list:detail}});
  vm.runInContext(fs.readFileSync(new URL(version+'/pfizer-browser-runtime.js',X),'utf8'),context);
  const runtime=context.pfizerDomRuntime;
  const tools={apply_patch:async patch=>{
    const lines=patch.split('\n'),name=lines[1].split('/').at(-1),value=JSON.parse(lines.slice(2,-1).map(s=>s.slice(1)).join('\n'));
    events.push('save:'+name);saved.push({name,value});return {};
  },mcp__cua_repl__js:async({code})=>{
    if(code==='await cua.getState();')return {content:[]};
    try {
      let value;
      if(code.includes('await pfizerDomRuntime.start('))value=await runtime.start(Date.now()+60000);
      else if(code.includes('await pfizerDomRuntime.readPage('))value=await runtime.readPage(false);
      else if(code.includes('await pfizerDomRuntime.failureState()'))value=await runtime.failureState();
      else if(code.includes('await pfizerDomRuntime.close()')){await runtime.close();value={closed:true};}
      else assert.fail('No retry or additional navigation');
      return {content:[{type:'text',text:'PFIZER_DOM_RESULT:'+JSON.stringify(value)}]};
    } catch(error) {return {isError:true,content:[{type:'text',text:String(error)}]};}
  }};
  const api=await new A('tools',fs.readFileSync(new URL(version+'/pfizer-functions.js',X),'utf8'))(tools);
  await assert.rejects(()=>api.capturePfizerManagedDom({directory:'/artificial-only',browserSource:'// loaded above',deadline:Date.now()+60000}),error=>error.message===String(waitError));
  events.push('HOLD');
  assert.equal(creates,2);assert.equal(closes,2);assert.equal(navigations,1);
  assert.deepEqual(waits,['list-title','list-country','list-total','detail-title','detail-apply'].map(kind=>({kind,state:'visible',timeoutMs:30000})));
  assert.equal(saved.length,1);assert.equal(saved[0].name,'capture-error.json');
  return {error:saved[0].value,events};
}
const before=await capture('before'),after=await capture('after');
assert.deepEqual(before.error,{stage:'read-page',pageNumber:1,archivedPageCount:0,error:String(waitError)});
const {state,...unchanged}=after.error;assert.deepEqual(unchanged,before.error);
assert.equal(state.stage,'detail-apply-wait');assert.equal(state.pageNumber,1);assert.equal(state.tab,'detail');
assert.equal(state.url,job+'?artificial=loading');assert.equal(state.domSnapshot,'Artificial detail loading snapshot');
assert(Number.isFinite(Date.parse(state.observedAt)));
assert.deepEqual(after.events,['read-detail-url','read-detail-dom','close-detail','close-list','save:capture-error.json','HOLD']);
console.log(JSON.stringify({status:'PASS',artificialOnly:true,case:'page-1-detail-Apply-wait-failure',internalStageAndActualTabRetained:true,actualUrlAndDomRetained:true,readBeforeClose:true,originalErrorAndHoldUnchanged:true,noFabricatedPageOrRows:true,waitOptionsAndNavigationCountUnchanged:true,realBrowserCalls:0,httpCalls:0,databaseCalls:0}));
