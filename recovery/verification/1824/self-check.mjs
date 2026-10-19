// One artificial page-3 heading failure through both runtime versions and the unchanged Functions bridge.
// No real browser, HTTP, database or production raw is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const X=new URL('./',import.meta.url),origin='https://www.careers.jnj.com';
const listUrl=p=>origin+'/en/jobs/?'+(p===1?'':'page='+p+'&')+'country=China&origin=global#results';
const waitError=new Error('Playwright selector deadline exceeded; locator.waitFor(visible) timed out internal:role=heading[name="Displaying 41 to 60 of 163 matching jobs"s]\ndiagnostics: no_matches, matchCount: 0, visibleCount: 0');
const A=Object.getPrototypeOf(async function(){}).constructor;
async function capture(version) {
  let page=1,creates=0,closes=0,advances=0,failureDomReads=0,failureUrlReads=0;
  const waits=[],writes=[],events=[];
  const list={
    url:async()=>{if(page===3)failureUrlReads++;return listUrl(page===3?2:page);},
    getAXState:async()=>{},close:async()=>{closes++;},playwright:{
      locator:selector=>selector==='#js-job-search-results'?{
        waitFor:async options=>waits.push({page,kind:'results',...options}),
        evaluate:async()=>({html:'<ul id="js-job-search-results">Artificial page '+page+'</ul>',htmlLength:64,
          items:Array.from({length:20},(_,i)=>({text:'Artificial job',links:[{title:'Artificial job',url:origin+'/en/jobs/r-'+((page-1)*20+i+1)+'/artificial/'}]}))})
      }:selector==='select[name]'?{evaluateAll:async()=>['team','subteam','country','state','location','type','pattern'].map(name=>({id:name,name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]}))}:assert.fail('Unexpected selector'),
      getByRole:(role,query)=>role==='heading'?{
        waitFor:async options=>{waits.push({page,kind:'heading',...options});if(page===3){assert.equal(query.name,'Displaying 41 to 60 of 163 matching jobs');throw waitError;}},
        innerText:async()=>`Displaying ${(page-1)*20+1} to ${page*20} of 163 matching jobs`
      }:role==='link'&&query.name==='Next page'?{click:async()=>{advances++;page++;}}:{evaluateAll:async()=>[{label:'Next page',text:'',url:listUrl(page+1)}]},
      domSnapshot:async()=>{if(page===3)failureDomReads++;return 'Artificial rendered page '+(page===3?2:page);}
    }
  };
  const context=vm.createContext({URL,Date,Set,cua:{createBrowserTab:async()=>++creates===1?list:{close:async()=>{closes++;}}}});
  vm.runInContext(fs.readFileSync(new URL(version+'/jnj-browser-runtime.js',X),'utf8'),context);
  const runtime=context.jnjDomRuntime;
  const tools={
    exec_command:async()=>({exit_code:0,output:''}),
    apply_patch:async patch=>{
      const lines=patch.split('\n'),file=lines[1].split('/').at(-1);
      const raw=lines.slice(2,-1).map(line=>line.slice(1)).join('\n')+'\n';
      writes.push({file,value:JSON.parse(raw)});events.push('save:'+file);return {};
    },
    mcp__cua_repl__js:async({code})=>{
      if(code==='await cua.getState();')return {content:[]};
      try {
        let value;
        if(code.includes('await jnjDomRuntime.start('))value=await runtime.start(Date.now()+60000);
        else if(code.includes('await jnjDomRuntime.readList()'))value=await runtime.readList();
        else if(code.includes('await jnjDomRuntime.advance()'))value=await runtime.advance();
        else if(code.includes('await jnjDomRuntime.close()')){await runtime.close();events.push('close');value={closed:true};}
        else assert.fail('NO_DETAIL_OR_RETRY_AFTER_FAILURE');
        return {content:[{type:'text',text:'JNJ_DOM_RESULT:'+JSON.stringify(value)}]};
      } catch(error) {return {isError:true,content:[{type:'text',text:String(error)}]};}
    }
  };
  const api=await new A('tools',fs.readFileSync(new URL(version+'/jnj-functions.js',X),'utf8'))(tools);
  await assert.rejects(()=>api.captureJnjManagedDom({directory:'/artificial-only',browserSource:'// Loaded above',deadline:Date.now()+60000}),error=>error.message===String(waitError));
  events.push('HOLD');
  assert.equal(creates,2);assert.equal(closes,2);assert.equal(advances,2);
  assert.deepEqual(waits,[1,2,3].flatMap(page=>['results','heading'].map(kind=>({page,kind,state:'visible',timeoutMs:30000}))));
  return {writes,events,failureDomReads,failureUrlReads};
}
const before=await capture('before'),after=await capture('after');
assert.deepEqual(before.writes.map(x=>x.file),['jnj-list-page-1.json','jnj-list-page-2.json']);
assert.deepEqual(after.writes.map(x=>x.file),['jnj-list-page-1.json','jnj-list-page-2.json','jnj-list-page-3.json']);
const failed=after.writes[2].value;
assert.equal(failed.page,3);assert.equal(failed.expectedUrl,listUrl(3));assert.equal(failed.url,listUrl(2));
assert.equal(failed.dom,'Artificial rendered page 2');assert.equal(failed.error,String(waitError));assert(Number.isFinite(Date.parse(failed.observedAt)));
assert.deepEqual(after.events,['save:jnj-list-page-1.json','save:jnj-list-page-2.json','save:jnj-list-page-3.json','close','HOLD']);
assert.equal(before.failureDomReads,0);assert.equal(before.failureUrlReads,0);assert.equal(after.failureDomReads,1);assert.equal(after.failureUrlReads,1);
console.log(JSON.stringify({status:'PASS',artificialOnly:true,case:'page-3-heading-wait-failure',beforeArchivedPages:2,afterArchivedPages:3,actualUrlAndDomRetained:true,exactErrorRetained:true,saveBeforeHold:true,noRetryOrDetailOrManifest:true,waitOptionsUnchanged:true,realBrowserCalls:0,httpCalls:0,databaseCalls:0}));
