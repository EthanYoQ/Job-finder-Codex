// Artificial original-next-link navigation only; no browser, HTTP or database.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const X=new URL('./',import.meta.url),origin='https://www.careers.jnj.com';
const listUrl=page=>origin+'/en/jobs/?'+(page===1?'':'page='+page+'&')+'country=China&origin=global#results';
const before=fs.readFileSync(new URL('before/jnj-browser-runtime.js',X),'utf8'),after=fs.readFileSync(new URL('after/jnj-browser-runtime.js',X),'utf8');
const old="    await list.playwright.getByRole('link',{name:'Next page',exact:true}).click();";
const replacement="    const nextUrl=await list.playwright.getByRole('link',{name:'Next page',exact:true}).evaluate(e=>e.href);\n    if(nextUrl!==listUrl(page+1))throw Error('JNJ_DOM_PAGINATION');\n    await list.goto(nextUrl);";
assert.equal(after.replace(replacement,old),before,'Change escaped the original advance action');
let creates=0,href=listUrl(2);const events=[];
const list={playwright:{getByRole:(role,options)=>{assert.equal(role,'link');assert.equal(options.name,'Next page');assert.equal(options.exact,true);return {evaluate:async fn=>{events.push('read-href');return fn({href});}};}},
  goto:async url=>events.push('goto:'+url),getAXState:async()=>events.push('AX'),close:async()=>{}};
const context=vm.createContext({URL,Date,Set,cua:{createBrowserTab:async()=>++creates===1?list:{close:async()=>{}}}});
vm.runInContext(after,context);const runtime=context.jnjDomRuntime;await runtime.start(Date.now()+60000);
for(let page=2;page<=4;page++){href=listUrl(page);assert.equal((await runtime.advance()).page,page);}
assert.deepEqual(events,[2,3,4].flatMap(page=>['read-href','goto:'+listUrl(page),'AX']));
const validEvents=events.length;
for(const invalid of [listUrl(4),listUrl(5).replace(origin,'https://example.invalid'),listUrl(5).replace('country=China','country=Japan')]){
  href=invalid;await assert.rejects(()=>runtime.advance(),/JNJ_DOM_PAGINATION/);
}
assert.deepEqual(events.slice(validEvents),['read-href','read-href','read-href']);
href=listUrl(5);assert.equal((await runtime.advance()).page,5);assert.equal(creates,2);
await runtime.close();
console.log(JSON.stringify({status:'PASS',artificialOnly:true,scope:'JNJ advance only',observedHrefValidatedExactly:true,sameTabSingleGoto:true,wrongPageOriginAndCountryRejectedBeforeNavigation:true,pageUnchangedAfterRejection:true,otherRuntimeBytesUnchanged:true,realBrowserCalls:0,httpCalls:0,databaseCalls:0}));
