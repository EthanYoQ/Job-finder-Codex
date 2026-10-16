/** Execute only the existing host's pure receipt-to-UI adapter with synthetic data.
 * No producer/compiler, database, browser, HTTP, installation or sidecar is run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {TARGET} from '../contract.mjs';
import {createCuaBrowserPort} from '../cua-port.mjs';
import {job} from './synthetic.mjs';
const source=readFileSync(new URL('../../../fixed-host/viatris/body.template.js',import.meta.url),'utf8');
const start=source.indexOf('  const projectionData=await sourceLocal(PROJECTIONS)'),end=source.indexOf("  check(uiResult.status===",start);
assert(start>0&&end>start,'Original receipt-to-public-UI adapter must be present');
const adapter=new Function('sourceLocal','PROJECTIONS','readAck','check','sha','canonical','ob','tuple','seed','SOURCE','own','ui','fixedTools','readRequest',
 'return (async()=>{let uiResult;\n'+source.slice(start,end)+'\nreturn uiResult;})()');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const sha=s=>createHash('sha256').update(s).digest('hex');
function input(){
 const j=job('synthetic-original-positionId');
 const projection={companyId:TARGET.companyId,sourceId:TARGET.sourceId,dedupeKey:'synthetic-dedupe-key',...j,listUrl:TARGET.officialEntry,locationRaw:'上海',city:'上海',cities:['上海'],officialPublishedAt:null,missingSuccessCount:0,lifecycleStatus:'ACTIVE',visibleInFrontend:true,isNew:true};
 const tuple={releaseCandidateId:'synthetic-candidate',batchId:'synthetic-receipt-batch',sourceId:TARGET.sourceId,sourceResultId:'synthetic-result'};
 const receipt={binding:tuple,observedAt:'2026-10-11T15:23:18.748Z',members:[{setKind:'VISIBLE',jobKey:projection.dedupeKey,jobProjectionSha256:sha(canonical({schemaVersion:'job-persisted-projection-v1',projection}))}]};
 return {tuple,projections:[projection],row:{atomicCommitState:'COMMITTED',completenessCertificate:receipt,completenessCertificateSha256:sha(canonical(receipt))}};
}
const rehash=x=>{x.row.completenessCertificateSha256=sha(canonical(x.row.completenessCertificate));};
async function execute(x){
 let portCalls=0,toolCalls=0,captured=null;
 const invoke=()=>adapter(async()=>({projections:x.projections}),'synthetic-read-projections',{bytes:JSON.stringify({result:{rows:[{row:x.row}]}}),sha256:'b'.repeat(64)},
  (ok,code)=>{assert(ok,code);},sha,canonical,{equalEvidenceData:(a,b)=>canonical(a)===canonical(b)},()=>x.tuple,{batchId:x.tuple.batchId},TARGET.sourceId,(o,k)=>Object.hasOwn(o,k),{
   createCuaBrowserPort(options){portCalls++;captured=structuredClone(options.expected);return createCuaBrowserPort(options);},
   createPublicVerifier({expected,port}){port.assertExpected(expected);return {async run(){return {status:'SYNTHETIC_ADAPTER_ACCEPTED_NO_BROWSER',expected};}};}
  },{mcp__cua_repl__js:async()=>{toolCalls++;throw Error('Browser forbidden');}},{requestSha256:'a'.repeat(64)});
 // The host evidence also binds the original READ_OUTCOME request.
 const original=adapter.toString();assert(original.includes('readRequest.requestSha256'));
 return {invoke,counts:()=>({portCalls,toolCalls,captured})};
}
test('actual fixed receipt adapter binds source/company/batch/time and full projection before UI',async()=>{
 const x=input(),h=await execute(x),r=await h.invoke();assert.equal(r.status,'SYNTHETIC_ADAPTER_ACCEPTED_NO_BROWSER');
 assert.equal(r.expected.sourceId,TARGET.sourceId);assert.equal(r.expected.companyId,TARGET.companyId);assert.equal(r.expected.batchId,x.tuple.batchId);assert.equal(r.expected.observedAt,x.row.completenessCertificate.observedAt);
 assert.deepEqual(r.expected.jobs,[{sourceJobId:x.projections[0].sourceJobId,officialTitle:x.projections[0].officialTitle,officialUrl:x.projections[0].officialUrl}]);assert.equal(h.counts().toolCalls,0);
});
for(const [name,mutate] of [
 ['receipt hash',x=>x.row.completenessCertificateSha256='0'.repeat(64)],
 ['receipt source',x=>{x.row.completenessCertificate.binding={...x.tuple,sourceId:'source-other'};rehash(x);}],
 ['receipt batch',x=>{x.row.completenessCertificate.binding={...x.tuple,batchId:'other'};rehash(x);}],
 ['invalid receipt time',x=>{x.row.completenessCertificate.observedAt='invalid';rehash(x);}],
 ['uncommitted row',x=>x.row.atomicCommitState='PREPARED'],
 ['missing projection',x=>x.projections=[]],['duplicate projection',x=>x.projections.push(x.projections[0])],
 ['projection title hash',x=>x.projections[0].officialTitle+=' changed'],
 ['projection URL hash',x=>x.projections[0].officialUrl+='&changed=1'],
 ['projection raw ID hash',x=>x.projections[0].sourceJobId+='changed'],
 ['nonpublic persisted field hash',x=>x.projections[0].locationRaw='北京'],
 ['missing persisted field',x=>delete x.projections[0].isNew],
 ['wrong projection source even with valid hash',x=>{x.projections[0].sourceId='source-other';x.row.completenessCertificate.members[0].jobProjectionSha256=sha(canonical({schemaVersion:'job-persisted-projection-v1',projection:x.projections[0]}));rehash(x);}],
 ['wrong projection company even with valid hash',x=>{x.projections[0].companyId='company-other';x.row.completenessCertificate.members[0].jobProjectionSha256=sha(canonical({schemaVersion:'job-persisted-projection-v1',projection:x.projections[0]}));rehash(x);}],
 ['wrong member identity',x=>{x.row.completenessCertificate.members[0].jobKey='other';rehash(x);}]
])test('receipt adapter rejects before UI '+name,async()=>{
 const x=input();mutate(x);const h=await execute(x);await assert.rejects(h.invoke());assert.equal(h.counts().portCalls,0);assert.equal(h.counts().toolCalls,0);
});
