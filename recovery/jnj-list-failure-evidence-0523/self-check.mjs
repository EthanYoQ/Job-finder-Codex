// Artificial DOM and Functions tools only; no browser, HTTP, database or production evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const X=path.dirname(new URL(import.meta.url).pathname),origin='https://www.careers.jnj.com';
const listUrl=p=>origin+'/en/jobs/?'+(p===1?'':'page='+p+'&')+'country=China&origin=global#results';
const entry=(id)=>({text:'Artificial job '+id,links:[{title:'Artificial job '+id,url:origin+'/en/jobs/'+id+'/synthetic/'}]});
async function capture(version,mode){
 let page=1,creates=0;
 const items=()=>Array.from({length:20},(_,i)=>entry('r-'+String((page-1)*20+i+1).padStart(6,'0'))).map((v,i)=>page===2&&i===0&&mode==='duplicate'?entry('r-000001'):page===2&&i===0&&mode==='invalid'?{...v,links:[{...v.links[0],url:'https://example.invalid/en/jobs/r-000021/synthetic/'}]}:v);
 const fragment=()=>({html:'<ul id="js-job-search-results">artificial page '+page+'</ul>',htmlLength:64,items:items()});
 const list={url:async()=>listUrl(page),getAXState:async()=>{},close:async()=>{},playwright:{
  locator:s=>s==='#js-job-search-results'?{waitFor:async()=>{},evaluate:async()=>fragment()}:{evaluateAll:async()=>['team','subteam','country','state','location','type','pattern'].map(name=>({id:name,name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]}))},
  getByRole:(role,query)=>role==='heading'?{innerText:async()=>`Displaying ${(page-1)*20+1} to ${page*20} of 40 matching jobs`}:query.name==='Next page'?{click:async()=>{page++;}}:{evaluateAll:async()=>page===1?[{label:'Page 1',text:'1',url:listUrl(1)},{label:'Next page',text:'',url:listUrl(2)}]:[{label:'Page 2',text:'2',url:listUrl(2)},{label:'Previous page',text:'',url:listUrl(1)}]},
  domSnapshot:async()=>'Artificial page '+page
 }};
 const context=vm.createContext({URL,Date,Set,cua:{createBrowserTab:async()=>++creates===1?list:{close:async()=>{}}}});
 vm.runInContext(fs.readFileSync(path.join(X,version,'jnj-browser-runtime.js'),'utf8'),context);const r=context.jnjDomRuntime;
 await r.start(Date.now()+60000);const first=await r.readList();assert.equal(first.rowCount,20);await r.advance();
 try{return {value:await r.readList(),fragment:fragment()};}catch(error){return {error};}
}
assert.match((await capture('before','duplicate')).error.message,/JNJ_DOM_DUPLICATE_OR_INVALID_ID/);
const failed=await capture('after','duplicate');assert.equal(JSON.parse(failed.value.raw).fragment.items[0].links[0].url,origin+'/en/jobs/r-000001/synthetic/');
assert.equal(failed.value.file,'jnj-list-page-2.json');assert.equal(failed.value.failure,'JNJ_DOM_DUPLICATE_OR_INVALID_ID:'+JSON.stringify({page:2,index:0,id:'r-000001',url:origin+'/en/jobs/r-000001/synthetic/',alreadySeen:true}));
const invalid=await capture('after','invalid');assert.match(invalid.value.failure,/'?alreadySeen"?:false/);assert.equal(JSON.parse(invalid.value.raw).fragment.items[0].links[0].url,'https://example.invalid/en/jobs/r-000021/synthetic/');
const valid=await capture('after','valid');assert.equal(valid.value.rowCount,20);assert.equal(valid.value.total,40);assert.equal(valid.value.next,false);assert.equal(valid.value.failure,undefined);
const A=Object.getPrototypeOf(async function(){}).constructor,writes=[],calls=[];
const tools={exec_command:async()=>({exit_code:0,output:''}),apply_patch:async patch=>{writes.push(patch);return {};},mcp__cua_repl__js:async({code})=>{
 calls.push(code);if(code==='await cua.getState();')return {content:[]};
 const value=code.includes('.start(')?{deadline:Date.now()+60000}:code.includes('.readList(')?failed.value:code.includes('.close(')?{closed:true}:assert.fail('NO_DETAIL_OR_RETRY_AFTER_FAILURE');
 return {content:[{type:'text',text:'JNJ_DOM_RESULT:'+JSON.stringify(value)}]};
}};
const api=await new A('tools',fs.readFileSync(path.join(X,'after/jnj-functions.js'),'utf8'))(tools);
await assert.rejects(()=>api.captureJnjManagedDom({directory:'/artificial-only',browserSource:'// artificial',deadline:Date.now()+60000}),e=>e.message===failed.value.failure);
assert.equal(writes.length,1);assert(writes[0].includes('/jnj-list-page-2.json'));assert.equal(calls.length,4);
console.log(JSON.stringify({status:'PASS',artificialOnly:true,duplicateStillHeld:true,invalidUrlStillHeld:true,failedPageOriginalRetained:true,exactIdentityDiagnostic:true,validPageUnchanged:true,noDetailOrRetryAfterFailure:true,realBrowserCalls:0,httpCalls:0,databaseCalls:0}));
