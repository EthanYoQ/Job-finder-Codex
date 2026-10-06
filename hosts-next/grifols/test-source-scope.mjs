// Synthetic boundaries only: reject other sources before any real tool dispatch.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const base=dirname(fileURLToPath(import.meta.url)),host=join(base,'host');
const cfg=JSON.parse(readFileSync(join(host,'host-config.json'),'utf8'));
const A=Object.getPrototypeOf(async function(){}).constructor,checks=[];
const stageCode=readFileSync(join(host,'host-stage-functions.js'),'utf8');
let toolCalls=0,localCalls=0;
const context={checkedAt:new Date().toISOString(),sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256};
const h={cfg,readFile:async()=>{localCalls++;return {text:'SYNTHETIC_READ_ONLY_CONTEXT'};},mark:async()=>{localCalls++;},respond:async()=>{localCalls++;},rows:x=>x};
globalThis.__grifolsScopeFixture=()=>h;
globalThis.tools={mcp__codex_apps__supabase_execute_sql:async request=>{toolCalls++;assert.equal(request.project_id,cfg.project);assert.equal(request.query,'SYNTHETIC_READ_ONLY_CONTEXT');return [{context}];}};
globalThis.store=()=>{};
try{
 const stage=await new A('load',stageCode)(()=> 'return __grifolsScopeFixture();');
 const request={kind:'READ_CONTEXT',expired:false,dispatchRecorded:false,payload:{projectId:cfg.project,sourceId:cfg.sourceId,sourceConfigSha256:cfg.sourceConfigSha256}};
 for(const [name,change,pattern] of [
  ['merck-source',x=>x.payload.sourceId='source-merck-china-social',/HOST_CONTEXT_SOURCE_BINDING/],
  ['merck-hash',x=>x.payload.sourceConfigSha256='3bce85185c99c4513a907f87fe3da9e8297392a8e0b9b1c52f57da09f2fe7d38',/HOST_CONTEXT_SOURCE_BINDING/],
  ['wrong-project',x=>x.payload.projectId='wrong',/HOST_CONTEXT_SOURCE_BINDING/],
  ['expired',x=>x.expired=true,/HOST_STALE_OR_UNCERTAIN_REQUEST/],
  ['already-dispatched',x=>x.dispatchRecorded=true,/HOST_STALE_OR_UNCERTAIN_REQUEST/]
 ]){const r=structuredClone(request);change(r);await assert.rejects(()=>stage.handle(r,'/synthetic/relay'),pattern);assert.equal(toolCalls,0);assert.equal(localCalls,0);checks.push('reject-'+name+'-before-tools');}
 assert.deepEqual(await stage.handle(request,'/synthetic/relay'),{status:'READ_CONTEXT'});assert.equal(toolCalls,1);assert.equal(localCalls,3);checks.push('grifols-context-mocked-positive');
}finally{delete globalThis.__grifolsScopeFixture;delete globalThis.tools;delete globalThis.store;}
const runtime=readFileSync(join(host,'runtime/load-source-runtime.js'),'utf8');
let forbiddenCalls=0;
const forbidden=new Proxy({},{get(){forbiddenCalls++;throw Error('FORBIDDEN_TOOL');}});
await assert.rejects(()=>new A('sourceKey','tools',runtime)('merck',forbidden),/RESTORED46_SOURCE_SELECTION/);
const loader=readFileSync(join(host,'runtime/load-host-state.js'),'utf8');
await assert.rejects(()=>new A('root','sourceId','candidateId','commit','tools',loader)(host,'source-merck-china-social','synthetic-candidate','47b74924f850a4d329460b71717b36df9a5159b8',forbidden),/HOST_LOAD_ARGUMENT/);
assert.equal(forbiddenCalls,0);checks.push('other-source-runtime-and-loader-rejected-before-tools');
assert.equal(existsSync(join(host,'activation.json')),false);assert.equal(existsSync(join(host,'control-base.json')),false);
const report={status:'PASS_SYNTHETIC_SOURCE_SCOPE',checks,mockedDatabaseCalls:toolCalls,actualDatabaseCalls:0,actualNetworkCalls:0,realSourceSampled:false,activationAbsent:true,controlAbsent:true};
writeFileSync(join(base,'verification/SOURCE_SCOPE_RESULTS.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
