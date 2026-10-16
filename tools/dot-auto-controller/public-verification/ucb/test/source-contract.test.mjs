import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {phenomSha256,ucbPhenomId,ucbPhenomUrl} from '../phenom-id.mjs';
import {TARGET,officialJobUrl,validateJob} from '../contract.mjs';
import {mergeRenderedList,createCuaBrowserPort,buildCuaCall} from '../cua-port.mjs';
import {createPublicVerifier} from '../machine.mjs';
import {fixture} from '../../../fixed-host/ucb/synthetic-ui-port.mjs';
import {expected,job,fakePort} from './synthetic.mjs';

// Synthetic public data only. Tiny ID functions are read from the unchanged native
// source and executed with type annotations removed; no fixture JSON or ATS calls.
const native=fs.readFileSync(new URL('../../../vendor/c60-source/src/crawler/officialJsonEvidence.ts',import.meta.url),'utf8');
const digest=x=>createHash('sha256').update(x).digest('hex');
const extract=(name,next)=>native.slice(native.indexOf('function '+name+'('),native.indexOf('\n'+next,native.indexOf('function '+name+'(')));
const hashValue=extract('hashValue','function strictInstant').replace('value: unknown','value').replace('): string',')');
const persistent=extract('persistentOfficialJsonJobId','export function safeOfficialJsonId').replace('value: string','value').replace('): string',')');
const originalId=new Function('sha256Bytes','Buffer',hashValue+'\n'+persistent+'\nreturn persistentOfficialJsonJobId;')(b=>({sha256:digest(b)}),Buffer);
for(const raw of ['UCB1GLOBALR001','10001','REQ-20002','false','0','A._-z'])test('unchanged native official-json ID '+raw,()=>{
 assert.equal(phenomSha256(JSON.stringify(raw)).sha256,digest(JSON.stringify(raw)));
 assert.equal(ucbPhenomId(raw),originalId(raw));
 assert.notEqual(ucbPhenomId(raw),'sha256:'+digest(JSON.stringify(raw)));
 assert.notEqual(ucbPhenomId(raw),'official-json:sha256:'+digest(raw));
});
const j=job(1000),e=expected(1);
const collection=()=>({companyPresent:true,anchorJobs:[{...j,sourceJobId:j.officialUrl}],visibleTitles:[{sourceJobId:j.officialUrl,renderedOriginalTitle:j.officialTitle}]});
test('jobSeqNo identity is not guessed from independent reqId URL',()=>{
 assert.equal(j.sourceJobId,originalId('UCBSEQ-1000'));assert.notEqual(j.sourceJobId,originalId('REQ-1000'));
 assert.deepEqual(mergeRenderedList(collection(),e),[{...j,renderedOriginalTitle:j.officialTitle}]);
});
test('native Phenom fallback priority, postedDate and China scope remain original',()=>{
 const s=fs.readFileSync(new URL('../../../vendor/c60-source/src/crawler/runSourceCrawl.ts',import.meta.url),'utf8');
 const section=s.slice(s.indexOf('function strictUcbDateOutput('),s.indexOf('function strictUcbLocationHasAmbiguousSegments('));
 assert(section.includes('raw.country !== "China"'));
 assert(section.includes('strictPhenomOfficialId(raw.jobSeqNo) ?? strictPhenomOfficialId(raw.reqId) ?? strictPhenomOfficialId(raw.jobId)'));
 assert(section.includes('ucbOfficialPostedDate(raw.postedDate)'));
 assert(section.includes('sourceJobId: persistentOfficialJsonJobId(rawId)'));
 assert(section.includes('encodeURIComponent(reqId!)'));
});
for(const url of ['http://careers.ucb.com/global/en/job/REQ-1000','https://careers.ucb.com.evil.test/x','https://evil.test/x','https://user@careers.ucb.com/x','https://careers.ucb.com:444/x','https://careers.ucb.com/\\evil','https://careers.ucb.com/x\n'])test('fixed public origin rejects '+JSON.stringify(url),()=>assert.equal(ucbPhenomUrl(url),false));
test('same-origin applyUrl may differ from fallback URL, but must exactly match reviewed data',()=>{
 const a={...e,jobs:[{...j,officialUrl:'https://careers.ucb.com/global/zh/job/REQ-1000/Synthetic-Title'}]},c=collection();
 c.anchorJobs[0].officialUrl=a.jobs[0].officialUrl;c.anchorJobs[0].sourceJobId=a.jobs[0].officialUrl;c.visibleTitles[0].sourceJobId=a.jobs[0].officialUrl;
 assert.deepEqual(mergeRenderedList(c,a),[{...a.jobs[0],renderedOriginalTitle:j.officialTitle}]);
 assert.throws(()=>mergeRenderedList(c,e),/UCB_UNREVIEWED_PUBLIC_URL/);
});
test('URL and sourceJobId are independently checked public fields',()=>{
 assert.equal(officialJobUrl(j.officialUrl,j.sourceJobId),true);
 for(const id of ['1000','REQ-1000','sha256:'+'a'.repeat(64),'workday:sha256:'+'a'.repeat(64)])assert.throws(()=>validateJob({...j,sourceJobId:id}),/INVALID_JOB_ID/);
});
test('unknown raw public URL never manufactures an official ID',()=>{const c=collection();c.anchorJobs[0].sourceJobId=job(9999).officialUrl;c.anchorJobs[0].officialUrl=c.anchorJobs[0].sourceJobId;assert.throws(()=>mergeRenderedList(c,e),/UCB_UNREVIEWED_PUBLIC_URL/);});
test('duplicate expected URL cannot ambiguously join two native IDs',()=>{const a=expected(2);a.jobs[1].officialUrl=a.jobs[0].officialUrl;assert.throws(()=>mergeRenderedList(collection(),a),/UCB_AMBIGUOUS_EXPECTED_URL/);assert.throws(()=>createCuaBrowserPort({enabled:true,expected:a,toolCall:async()=>{}}),/UCB_AMBIGUOUS_EXPECTED_URL/);});
test('duplicate anchors fail',()=>{const c=collection();c.anchorJobs.push(c.anchorJobs[0]);c.visibleTitles.push(c.visibleTitles[0]);assert.throws(()=>mergeRenderedList(c,e),/DUPLICATE_RENDERED_ANCHOR_ID/);});
test('different title membership fails',()=>{const c=collection();c.visibleTitles[0].sourceJobId=job(9999).officialUrl;assert.throws(()=>mergeRenderedList(c,e),/UCB_UNREVIEWED_PUBLIC_URL/);});
test('false anchor ID cannot mask a different visible href',()=>{const c=collection();c.anchorJobs[0].officialUrl=job(9999).officialUrl;assert.throws(()=>mergeRenderedList(c,e),/UCB_RENDERED_HREF_DISAGREEMENT/);});
test('verified empty accepts absent ready company only with matching source time',async()=>{
 const a=expected(0),f=fixture(a),r=await createPublicVerifier({expected:a,port:f.port}).run();assert.equal(r.status,'PASS_LIST_AND_SOURCE_TIME_ONLY');
 assert.deepEqual(mergeRenderedList({companyPresent:false,anchorJobs:[],visibleTitles:[]},a),[]);
 assert(!f.calls.some(c=>/\.click\(\d+\)/.test(c.code)));assert.equal(r.productionQualified,false);
});
for(const count of [0,1,51])for(const consent of [false,true])test('actual AX decoder and fixed selectors with synthetic count '+count+' consent '+consent,async()=>{
 const a=expected(count),f=fixture(a,{consent,actualAx:true}),r=await createPublicVerifier({expected:a,port:f.port}).run();assert.equal(r.status,'PASS_LIST_AND_SOURCE_TIME_ONLY',JSON.stringify(r));
 assert.equal(r.detailVerification,'UNKNOWN');assert.equal(r.applicationVerification,'NOT_TESTED');assert.equal(r.productionQualified,false);
});
test('caller mutation cannot retarget the once-frozen public ID binding',async()=>{
 const a=expected(1),reviewed=structuredClone(a),f=fixture(a,{actualAx:true});a.jobs[0].sourceJobId=job(9999).sourceJobId;
 const r=await createPublicVerifier({expected:reviewed,port:f.port}).run();assert.equal(r.status,'PASS_LIST_AND_SOURCE_TIME_ONLY');
});
for(const field of ['officialTitle','renderedOriginalTitle'])test('actual AX and CUA retain observed '+field+' mismatch',async()=>{
 const a=expected(1),f=fixture(a,{actualAx:true,mutateTool(response,request){
  if(request.code.includes('action:"READ_LIST"')){const packet=JSON.parse(response.content[0].text);if(field==='officialTitle')packet.payload.anchorJobs[0][field]+=' changed';else packet.payload.visibleTitles[0][field]+=' changed';response.content[0].text=JSON.stringify(packet);}return response;
 }}),r=await createPublicVerifier({expected:a,port:f.port}).run();assert.equal(r.reason,'PUBLIC_LIST_MISMATCH');
});
test('actual AX repeat use is refused and every synthetic click resolves a fresh index',async()=>{
 const a=expected(1),f=fixture(a,{actualAx:true,consent:true}),v=createPublicVerifier({expected:a,port:f.port});assert.equal((await v.run()).status,'PASS_LIST_AND_SOURCE_TIME_ONLY');
 await assert.rejects(v.run(),/RUN_ALREADY_STARTED/);assert.equal((await createPublicVerifier({expected:a,port:f.port}).run()).reason,'PORT_ALREADY_USED');
});
test('unknown stale URL conservatively holds rather than guessing removed ID',async()=>{const a=expected(1),f=fixture(a,{stale:true}),r=await createPublicVerifier({expected:a,port:f.port}).run();assert.equal(r.status,'HOLD');assert.equal(r.reason,'UCB_UNREVIEWED_PUBLIC_URL');});
test('verified zero with visible nonempty jobs holds',async()=>{const a=expected(0),p=fakePort(a,{mutate(o,c){if(c.action==='READ_LIST'){o.jobs=[{...j,renderedOriginalTitle:j.officialTitle}];o.ui.displayedCount=1;o.ui.companyExpanded=true;o.ui.allJobsVisible=true;}}}),r=await createPublicVerifier({expected:a,port:p}).run();assert.equal(r.reason,'PUBLIC_LIST_MISMATCH');});
test('verified zero still needs same-source minute and READY',async()=>{
 for(const option of [{mutate(o,c){if(c.action==='READ_SOURCE_TIME')o.sourceTime=null;}},{loadingAt:'OPEN_HOME',loadingForever:true}]){const a=expected(0),r=await createPublicVerifier({expected:a,port:fakePort(a,option)}).run();assert.equal(r.status,'HOLD');}
});
test('collapsed present source cannot masquerade as absent zero',()=>assert.throws(()=>mergeRenderedList({companyPresent:true,anchorJobs:[],visibleTitles:[]},expected(0)),/RENDERED_COMPANY_PRESENCE_MISMATCH/));
test('missing source container cannot carry jobs',()=>{const c=collection();c.companyPresent=false;assert.throws(()=>mergeRenderedList(c,e),/RENDERED_COMPANY_PRESENCE_MISMATCH/);});
test('E6 and full name derive from both unchanged 41-company readers',()=>{
 for(const reader of ['reader-main','reader-fallback']){
 const registry=fs.readFileSync(new URL('../../../vendor/'+reader+'/src/data/companyRegistry.ts',import.meta.url),'utf8');
 const manifest=fs.readFileSync(new URL('../../../vendor/'+reader+'/src/release/launchManifest.ts',import.meta.url),'utf8');
 const roster=manifest.slice(manifest.indexOf('const FROZEN_FOREIGN_COMPANY_IDS'),manifest.indexOf('export const P0_CANDIDATE_COMPANY_IDS'));
 const ids=new Set([...roster.matchAll(/"(company-[^"]+)"/g)].map(m=>m[1]));
 const rows=[...registry.matchAll(/id: "(company-[^"]+)",\s*officialChineseName: "([^"]+)"/g)].map(m=>({id:m[1],name:m[2]})).filter(c=>ids.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 assert.equal(rows.length,41);const i=rows.findIndex(c=>c.id===TARGET.companyId);assert.equal(rows[i].name,TARGET.companyName);assert.equal(String.fromCharCode(65+Math.floor(i/8))+(i%8+1),'E6');
 }
});
test('DOM query is fixed to UCB company and never infers IDs from URL segments',()=>{
 const code=buildCuaCall('READ_LIST').code;assert(code.includes("#jobs-company-ucb-china .job a"));assert(code.includes("row-company-ucb-china"));assert(!code.includes('jobSeqNo'));assert(!code.includes('fetch('));
});
test('bundle rebuilds exactly and works without Node or URL globals',()=>{
 const modules=['phenom-id.mjs','contract.mjs','compare.mjs','machine.mjs','actual-ax.mjs','cua-port.mjs'];
 let rebuilt='// GENERATED from contract.mjs, compare.mjs, machine.mjs, actual-ax.mjs, cua-port.mjs. No real tools bound.\n(() => {\n';
 for(const file of modules)rebuilt+='\n// '+file+'\n'+fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s'[^']+';\n/gm,'').replace(/^export /gm,'');
 rebuilt+='\nreturn Object.freeze({TARGET, LIMITS, UNBOUND_PORT, BrowserProtocolTimeout, createPublicVerifier, runPublicVerification, comparePublicList, compareSourceMinute, createCuaBrowserPort, buildCuaCall, parseCuaPacket, validateDecodedAx, resolveFreshControl, mergeRenderedList, parseVisibleSourceCard, UNBOUND_AX_DECODER, ACTUAL_PUBLIC_UI_DECODER, decodeActualAx, assertActualStartupResult});\n})()\n';
 const bundle=fs.readFileSync(new URL('../functions-bundle.js',import.meta.url),'utf8');assert.equal(bundle,rebuilt);
 const api=runInNewContext(bundle,{});assert.equal(api.TARGET.sourceId,TARGET.sourceId);assert.equal(Object.isFrozen(api),true);
 assert.deepEqual(JSON.parse(JSON.stringify(api.mergeRenderedList(collection(),e))),[{...j,renderedOriginalTitle:j.officialTitle}]);
});
