import test from 'node:test';
import assert from 'node:assert/strict';
import {createMokaDomRuntime} from '../src/crawler/local-browser/moka-b-browser-runtime.mjs';
function fixture(error,onWait=()=>{}){
 let waits=0;const reached=Error('SYNTHETIC_DOM_READY');
 const locator={first(){return this;},async waitFor(){onWait();if(++waits===1)throw error;}};
 const tab={async getAXState(){},async close(){},playwright:{async waitForLoadState(){assert.fail('unrelated page resources must not block required DOM');},locator:()=>locator,getByText:()=>({async evaluate(){throw reached;}})}};
 const runtime=createMokaDomRuntime({async createBrowserTab(){return tab;}});
 return {runtime,reached,waits:()=>waits};
}
test('Moka waits on required DOM and retries native timeout on the same tab',async()=>{
 const f=fixture(Object.assign(Error('native timeout'),{name:'TimeoutError'}));await f.runtime.start('servier');
 await assert.rejects(f.runtime.readPage(),e=>e===f.reached);assert.equal(f.waits(),3);
});
test('Moka preserves non-timeout errors',async()=>{
 const error=new ReferenceError('synthetic'),f=fixture(error);await f.runtime.start('servier');
 await assert.rejects(f.runtime.readPage(),e=>e===error);assert.equal(f.waits(),1);
});
test('Moka readiness does not extend its existing deadline',async t=>{
 let now=Date.now();t.mock.method(Date,'now',()=>now);
 const f=fixture(Object.assign(Error('timeout'),{name:'TimeoutError'}),()=>{now+=61000;});await f.runtime.start('servier');
 await assert.rejects(f.runtime.readPage(),{message:'MOKA_B_DOM_LOADING_TIMEOUT'});assert.equal(f.waits(),1);
});
