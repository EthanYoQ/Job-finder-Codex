'use strict';
// NONQUALIFYING SYNTHETIC TESTS: no browser, source navigation, or publisher.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const source=fs.readFileSync(path.join(__dirname,'readiness-call-with-diagnostics.js'),'utf8');
(async()=>{
 const outputs=[];const sandbox={nodeRepl:{write:text=>outputs.push(JSON.parse(text))}};vm.createContext(sandbox);vm.runInContext(source,sandbox);
 const state={url:'https://example.invalid/?search=&country=China&pagesize=20#results',keyword:'',filters:[{name:'country',selectedOptions:[{text:'China',value:'China'}]}],pagination:[{label:'Next page',url:'https://example.invalid/?page=2&country=China&pagesize=20#results'}]};
 let formalReads=0;
 const failure=await sandbox.jnjRunReadinessAttempt({waitForListReadiness:async()=>{const e=new Error('LIST_READINESS_REJECTED: PAGE_URL_MISMATCH,NEXT_PAGE_MISMATCH');e.nonqualifyingState=state;throw e;}},{},1,106,15000);
 if(failure.ok)formalReads++;
 assert.equal(failure.ok,false);assert.equal(formalReads,0);assert.deepEqual(outputs[0].error.nonqualifyingState,state);assert.equal(outputs[0].qualifyingCapture,false);
 const generic=await sandbox.jnjRunReadinessAttempt({waitForListReadiness:async()=>{throw new Error('SYNTHETIC locator timeout');}},{},1,106,15000);
 assert.equal(generic.ok,false);assert.equal(outputs[1].error.nonqualifyingState,null);
 const success=await sandbox.jnjRunReadinessAttempt({waitForListReadiness:async()=>({result:{ready:true,total:106},state})},{},1,106,15000);
 if(success.ok)formalReads++;
 assert.equal(success.ok,true);assert.equal(formalReads,1);assert.equal(outputs[2].ok,true);assert.deepEqual(outputs[2].result.state,state);
 const report={kind:'NONQUALIFYING_SYNTHETIC_ERROR_SERIALIZATION_TESTS',qualifyingCapture:false,passed:3,cases:['Thrown nonqualifyingState preserved and subsequent capture blocked','Error without state preserved as null, not invented','Successful state returned and caller can continue'],browserCalls:0,sourceSha256:crypto.createHash('sha256').update(source).digest('hex')};
 fs.writeFileSync(path.join(__dirname,'NONQUALIFYING-wrapper-tests.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
