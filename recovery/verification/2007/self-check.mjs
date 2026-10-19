// One focused artificial check of the shared wait at both authorized call sites.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const X=new URL('./',import.meta.url),read=(version,file)=>fs.readFileSync(new URL(version+'/'+file,X),'utf8');
const A=Object.getPrototypeOf(async function(){}).constructor;
const helper=read('after','cspc-dom-runtime-functions.js');
assert(helper.endsWith(read('before','cspc-dom-runtime-functions.js')),'Original CSPC helper changed');
const timeout=new Error('Playwright selector deadline exceeded'),other=new Error('Artificial non-timeout failure');
const cases=[
  {name:'early-timeout-then-visible',budget:60000,steps:[[5000,timeout],[1000,null]],expected:[30000,25000]},
  {name:'source-deadline-HOLD',budget:9000,steps:[[4000,timeout],[5000,timeout]],expected:[9000,5000],error:timeout},
  {name:'other-error-HOLD',budget:60000,steps:[[1000,other]],expected:[30000],error:other}
];
for(const source of ['jnj','pfizer']) {
  const file=source+'-browser-runtime.js',after=read('after',file),call=after.match(/await waitOriginalDomVisible\([^;]+;/)?.[0];assert(call);
  const original=source==='jnj'?"await headingLocator.waitFor({state:'visible',timeoutMs:30000});":"await detail.playwright.locator('[data-automation-id=\"jobPostingHeader\"]').waitFor({state:'visible',timeoutMs:30000});";
  assert.equal(after.replace(call,original),read('before',file),'Change escaped the authorized wait point');
  for(const scenario of cases) {
    let now=100000,attempt=0,locatorReads=0;const observed=[];
    const locator={waitFor:async options=>{observed.push({...options});const step=scenario.steps[attempt++];assert(step,'Unexpected extra wait');now+=step[0];if(step[1])throw step[1];}};
    const context=vm.createContext({Date:{now:()=>now},Error});vm.runInContext(helper,context);
    const detail={playwright:{locator:selector=>{assert.equal(selector,'[data-automation-id="jobPostingHeader"]');locatorReads++;return locator;}}};
    const run=()=>new A('waitOriginalDomVisible','deadline','headingLocator','detail',call)(context.waitOriginalDomVisible,100000+scenario.budget,locator,detail);
    if(scenario.error)await assert.rejects(run,error=>error===scenario.error);else await run();
    assert.deepEqual(observed,scenario.expected.map(timeoutMs=>({state:'visible',timeoutMs})));
    assert.equal(locatorReads,source==='pfizer'?1:0);assert(now<=100000+Math.min(30000,scenario.budget));
  }
}
const entry=read('after','run-original-functions.js');new A(entry);
for(const source of ['jnj','pfizer'])assert(entry.includes("browserSource:await read(D+'/cspc-dom-runtime-functions.js')+'\\n'+await read(D+'/"+source+"-browser-runtime.js')"));
console.log(JSON.stringify({status:'PASS',artificialOnly:true,sources:['jnj-heading','pfizer-detail-title'],sameLocator:true,local30sWindowNotReset:true,sourceDeadlineClamped:true,nonTimeoutStillHeld:true,terminalOriginalErrorRetained:true,otherRuntimeBytesUnchanged:true,originalCspcHelperUnchanged:true,realBrowserCalls:0,httpCalls:0,databaseCalls:0}));
