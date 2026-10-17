import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {isSupportedABRoute,entrypointsFor,AB_MODE} from './connector-host-binding.mjs';
const catalogue=JSON.parse(fs.readFileSync(new URL('../../../../config/native-catalog.json',import.meta.url))).routingCatalogue;
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
async function fixture(route='TRUE_A'){
 const sourceId=route==='TRUE_A'?'source-amgen-china-social':'source-pfizer-china-social';
 const b={sourceId,sourceConfigSha256:'config',candidateId:'candidate',buildContentSha256:'build',relayDirectory:'/relay'};
 const calls=[]; const h={cfg:{mode:AB_MODE,project:'yiopvxysxrtrnvqxwgbx',root:'/host'},binding:async()=>b,q:x=>x,
 cmd:async()=>JSON.stringify({requestId:'request',requestSha256:'request-sha',candidateId:b.candidateId,buildContentSha256:b.buildContentSha256,projectId:'yiopvxysxrtrnvqxwgbx',sql:'SELECT original',output:'/sql'}),
 sqlDispatch:async(r,d,sql)=>{calls.push(r.kind);return {status:r.kind,sql};},mark:async()=>calls.push('mark'),rows:x=>x,respond:async()=>calls.push('respond')};
 const tools={mcp__codex_apps__supabase_execute_sql:async()=>[{context:{checkedAt:new Date().toISOString()}}]};
 const text=fs.readFileSync(new URL('./host-stage-functions.js',import.meta.url),'utf8');
 const body='const cfg=h.cfg;\n'+text.slice(text.indexOf('async function handle')).replace('return {h,handle};','return handle;');
 const handle=await new AsyncFunction('h','tools','store',body)(h,tools,()=>{});
 const request=kind=>({kind,requestId:'request',requestSha256:'request-sha',payload:{projectId:'yiopvxysxrtrnvqxwgbx',sourceId,sourceConfigSha256:'config',sql:'SELECT outcome'}});
 return {handle,request,calls,h};
}
test('all 12 original A and the four original B sources are enabled; original producer retained',()=>{
 const supported=catalogue.filter(isSupportedABRoute);assert.equal(supported.filter(x=>x.route==='TRUE_A').length,12);assert.equal(supported.filter(x=>x.route==='TRUE_B').length,4);
 assert.equal(entrypointsFor({kind:AB_MODE}).producer,'scripts/p0-cloud-source-pilot.ts');
 for(const id of ['source-johnson-innovative-medicine-social','source-bayer-healthcare-social','source-servier-china-social','source-sanofi-china-social'])assert(supported.some(x=>x.sourceId===id));
});
for(const route of ['TRUE_A','TRUE_B'])test(route+' uses existing four requests and never dispatches PUBLISH before review',async()=>{
 const f=await fixture(route);
 for(const kind of ['READ_CONTEXT','READ_PUBLICATION_CONTEXT','PUBLISH','READ_OUTCOME']){
  const result=await f.handle(f.request(kind),'/relay');assert.equal(result.status,kind==='PUBLISH'?'AWAITING_PARENT_REVIEW':kind);
 }
 assert(!f.calls.includes('PUBLISH'));assert(f.calls.includes('READ_OUTCOME'));
});
test('expired, uncertain, wrong source and wrong candidate are rejected before dispatch',async()=>{
 const f=await fixture();
 for(const patch of [{expired:true},{dispatchRecorded:true}])await assert.rejects(()=>f.handle({...f.request('PUBLISH'),...patch},'/relay'),/STALE_OR_UNCERTAIN/);
 const wrong=f.request('READ_CONTEXT');wrong.payload.sourceId='wrong';await assert.rejects(()=>f.handle(wrong,'/relay'),/SOURCE_BINDING/);
 f.h.cmd=async()=>JSON.stringify({requestId:'request',requestSha256:'request-sha',candidateId:'wrong'});
 await assert.rejects(()=>f.handle(f.request('PUBLISH'),'/relay'),/PUBLISH_PACKET_BINDING/);
 assert.equal(f.calls.length,0);
});
