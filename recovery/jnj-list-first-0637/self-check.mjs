// Artificial DOM/tools only; runs the actual before/after runtime and Functions bridge without a browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const X=path.dirname(new URL(import.meta.url).pathname),origin='https://www.careers.jnj.com';
const listUrl=p=>origin+'/en/jobs/?'+(p===1?'':'page='+p+'&')+'country=China&origin=global#results';
const card=n=>({title:'Artificial job '+n,url:origin+'/en/jobs/r-'+String(n).padStart(6,'0')+'/synthetic/'});
async function run(version,{duplicate=false,sampleOnly=false}={}) {
 let page=1,creates=0,detailCard,emitted;
 const requests=[],events=[],files=[];
 const items=()=>Array.from({length:20},(_,i)=>{const n=duplicate&&page===2&&i===0?1:(page-1)*20+i+1;return {text:card(n).title,links:[card(n)]};});
 const list={url:async()=>listUrl(page),getAXState:async()=>{},close:async()=>{},playwright:{
  locator:s=>s==='#js-job-search-results'?{waitFor:async()=>{},evaluate:async()=>{events.push('list:'+page);return {html:'<ul id="js-job-search-results">Artificial page '+page+'</ul>',htmlLength:64,items:items()};}}:{evaluateAll:async()=>['team','subteam','country','state','location','type','pattern'].map(name=>({id:name,name,selectedOptions:name==='country'?[{text:'China',value:'China'}]:[]}))},
  getByRole:(role,q)=>role==='heading'?{waitFor:async()=>{},innerText:async()=>`Displaying ${(page-1)*20+1} to ${page*20} of 40 matching jobs`}:q.name==='Next page'?{click:async()=>{page++;requests.push(listUrl(page));events.push('next:'+page);}}:{evaluateAll:async()=>page===1?[{label:'Page 1',text:'1',url:listUrl(1)},{label:'Next page',text:'',url:listUrl(2)}]:[{label:'Page 2',text:'2',url:listUrl(2)},{label:'Previous page',text:'',url:listUrl(1)}]},
  domSnapshot:async()=>'Artificial page '+page
 }};
 const detail={goto:async url=>{requests.push(url);const n=Number(/r-(\d+)/.exec(url)[1]);detailCard=card(n);events.push('detail:'+n);},url:async()=>detailCard.url,getAXState:async()=>{},close:async()=>{},playwright:{
  locator:s=>s==='h1'?{innerText:async()=>detailCard.title}:{waitFor:async()=>{},evaluate:async()=>({html:'<div id="js-job-detail">Artificial detail</div>',htmlLength:48,text:'Artificial detail'})},
  getByRole:()=>({waitFor:async()=>{},evaluateAll:async()=>[{text:'Apply now',href:'https://jj.wd5.myworkdayjobs.com/JJ/job/artificial'}]}),domSnapshot:async()=>detailCard.title
 }};
 const context=vm.createContext({URL,Date,Set,cua:{getState:async()=>{},createBrowserTab:async(_mode,url)=>{if(++creates===1){requests.push(url);return list;}return detail;}},nodeRepl:{write:text=>{emitted=text;}}});
 const browserSource=fs.readFileSync(path.join(X,version,'jnj-browser-runtime.js'),'utf8');
 const tools={exec_command:async({cmd})=>({exit_code:0,output:cmd.includes('manifest.json')?JSON.stringify({path:'/artificial/manifest.json',sha256:'a'.repeat(64)}):''}),apply_patch:async patch=>{files.push(/\*\*\* Add File: ([^\n]+)/.exec(patch)[1].split('/').at(-1));return {};},mcp__cua_repl__js:async({code})=>{
  if(code.startsWith(browserSource)){vm.runInContext(browserSource,context);code=code.slice(browserSource.length);}
  emitted=undefined;await vm.runInContext('(async()=>{'+code+'})()',context);
  return {content:emitted?[{type:'text',text:emitted}]:[]};
 }};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const api=await new AsyncFunction('tools',fs.readFileSync(path.join(X,version,'jnj-functions.js'),'utf8'))(tools);
 let result,error;try{result=await api[sampleOnly?'probeJnjManagedDom':'captureJnjManagedDom']({directory:'/artificial',browserSource,deadline:Date.now()+60000});}catch(e){error=e.message;}
 return {result,error,requests,events,files};
}
const before=await run('before'),after=await run('after');
assert.equal(before.error,undefined);assert.equal(after.error,undefined);
assert.deepEqual(after.result,before.result);assert.equal(after.requests.length,42);
assert.deepEqual([...after.requests].sort(),[...before.requests].sort());
assert.deepEqual([...after.files].sort(),[...before.files].sort());assert.equal(after.files.length,42);
assert.deepEqual(after.events.slice(0,3),['list:1','next:2','list:2']);
assert.deepEqual(after.events.slice(3),Array.from({length:40},(_,i)=>'detail:'+(i+1)));
assert.equal(before.events[21],'next:2');
const duplicate=await run('after',{duplicate:true});
assert.match(duplicate.error,/JNJ_DOM_DUPLICATE_OR_INVALID_ID:/);assert.deepEqual(duplicate.files,['jnj-list-page-1.json','jnj-list-page-2.json']);
assert.equal(duplicate.events.filter(x=>x.startsWith('detail:')).length,0);
const sampleBefore=await run('before',{sampleOnly:true}),sampleAfter=await run('after',{sampleOnly:true});
assert.deepEqual(sampleAfter.result,sampleBefore.result);assert.deepEqual(sampleAfter.requests,sampleBefore.requests);assert.deepEqual(sampleAfter.files,sampleBefore.files);
console.log(JSON.stringify({status:'PASS',artificialOnly:true,sameSuccessfulRequestUrlsAndCounts:42,sameSuccessfulEvidenceFiles:42,allListsBeforeDetails:true,detailsRemainSequential:true,duplicateStillHeldAndSaved:true,sampleBehaviorUnchanged:true,realBrowserCalls:0,httpCalls:0,databaseCalls:0}));
