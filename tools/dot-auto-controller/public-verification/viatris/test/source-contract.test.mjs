import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {TARGET,validateExpected,validateJob,officialJobUrl} from '../contract.mjs';
import {createCuaBrowserPort,mergeRenderedList,buildCuaCall,parseCuaPacket,parseVisibleSourceCard} from '../cua-port.mjs';
import {createPublicVerifier} from '../machine.mjs';
import {expected,job,fakePort} from './synthetic.mjs';
import {fixture} from './browser-fixture.mjs';
const read=path=>fs.readFileSync(new URL(path,import.meta.url),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const payload=e=>({companyPresent:true,jobs:e.jobs.map(j=>({officialUrl:j.officialUrl,renderedOriginalTitle:j.officialTitle}))});
const invoke=async(e,options)=>{const f=fixture(e,options);return {f,result:await createPublicVerifier({expected:e,port:f.port}).run()};};
test('independent fixed Viatris source, entry and original positionId profile',()=>{
 assert.equal(TARGET.sourceId,'source-viatris-social');assert.equal(TARGET.companyId,'company-viatris');assert.equal(TARGET.companyName,'晖致中国');assert.equal(TARGET.coordinate,'B6');
 const source=read('../../../vendor/c60-source/src/crawler/companyRecruitmentProfiles/profiles/viatris.ts');
 assert(source.includes('pattern: "positionId=([^&]+)"'));assert(source.includes('adapterId: "html-table"'));assert(!source.includes('official-json'));
 for(const reader of ['reader-main','reader-fallback']){
  const registry=read('../../../vendor/'+reader+'/src/data/companyRegistry.ts');
  const start=registry.indexOf('id: "company-viatris"'),end=registry.indexOf('\n  },',start),row=registry.slice(start,end);
  assert(row.includes('officialChineseName: "晖致中国"'));assert(row.includes(TARGET.officialEntry));assert(row.includes('https://viatris.cn/careers'));
 }
});
test('B6 independently recomputed from both pinned 41-company readers',()=>{
 const pins=JSON.parse(read('../../../config/reader-pins.json'));
 for(const [reader,key] of [['reader-main','main'],['reader-fallback','fallback']]){
  const registry=read('../../../vendor/'+reader+'/src/data/companyRegistry.ts');
  assert.equal(hash(registry),pins[key].readerFileHashes['src/data/companyRegistry.ts']);
  const manifest=read('../../../vendor/'+reader+'/src/release/launchManifest.ts');
  const roster=manifest.slice(manifest.indexOf('const FROZEN_FOREIGN_COMPANY_IDS'),manifest.indexOf('export const P0_CANDIDATE_COMPANY_IDS'));
  const ids=new Set([...roster.matchAll(/"(company-[^"]+)"/g)].map(m=>m[1]));
  const rows=[...registry.matchAll(/id: "(company-[^"]+)",\s*officialChineseName: "([^"]+)"/g)].map(m=>({id:m[1],name:m[2]})).filter(c=>ids.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  assert.equal(rows.length,41);const index=rows.findIndex(c=>c.id===TARGET.companyId);assert.equal(index,13);assert.equal(rows[index].name,TARGET.companyName);
  assert.equal(String.fromCharCode(65+Math.floor(index/8))+(index%8+1),TARGET.coordinate);
  const app=read('../../../vendor/'+reader+'/src/app/App.tsx'),components=read('../../../vendor/'+reader+'/src/app/RedesignComponents.tsx');
  assert(app.includes('a.companyName.localeCompare(b.companyName, "zh-CN")'));assert(app.includes('if (!requestKeyword) setPlateCompanies(sorted)'));
  assert(components.includes('String.fromCharCode(65 + Math.floor(index / 8))'));assert(components.includes('index % 8 + 1'));
  assert(app.includes('<p className="en">{job.officialTitle}</p>'));assert(app.includes('aria-label={`查看官方职位 ${job.title}`}'));
 }
});
test('raw receipt positionId is preserved and never derived from positionId URL',()=>{
 const e=expected(1);e.jobs[0].sourceJobId='RAW_Receipt_ID_007';
 const result=mergeRenderedList(payload(e),e);assert.equal(result[0].sourceJobId,'RAW_Receipt_ID_007');assert.equal(result[0].officialUrl,e.jobs[0].officialUrl);
});
for(const url of ['javascript:alert(1)','https://user@careersite.tupu360.com/Viatris/position/detail?positionId=x','https://user:pass@careersite.tupu360.com/path','https://careersite.tupu360.com/path?access_token=secret','https://careersite.tupu360.com/path?access%255Ftoken%253Dsecret','https://careersite.tupu360.com/path?positionId=x\n'])test('native-compatible safe public envelope rejects '+JSON.stringify(url),()=>assert.equal(officialJobUrl(url,'raw-id'),false));
const nativeSafeSource=read('../../../vendor/c60-source/src/crawler/adapters/safeAdapterValue.ts').replace(/^export /gm,'').replaceAll(': string','').replaceAll(': boolean','');
const nativeSafe=new Function('URL',nativeSafeSource+'\nreturn isSafeAdapterUrl;')(URL);
for(const url of ['https://careersite.tupu360.com/Viatris/position/alternate?positionId=receipt-id','https://careersite.tupu360.com/Other/position?positionId=receipt-id#details','http://careersite.tupu360.com/Viatris/position/alternate?positionId=receipt-id','https://careers.example.org/reviewed/path?positionId=receipt-id'])test('native-safe receipt URL is retained without guessed path or host '+url,()=>{
 assert.equal(nativeSafe(url,TARGET.officialEntry),true);const e=expected(1);e.jobs[0].officialUrl=url;e.jobs[0].sourceJobId='Raw position 7';
 validateExpected(e);const result=mergeRenderedList(payload(e),e);assert.equal(result[0].officialUrl,url);assert.equal(result[0].sourceJobId,'Raw position 7');
});
test('raw ID grammar follows original normalization; no additional whitespace or prefix guess',()=>{
 assert(read('../../../vendor/c60-source/src/crawler/normalizedJob.ts').includes('sourceJobId: z.string().min(1).optional()'));
 const adapter=read('../../../vendor/c60-source/src/crawler/adapters/htmlTable.ts');assert(adapter.includes('value.replace(/\\s+/g, " ").trim()'));assert(adapter.includes('const officialUrl = absoluteUrl(rawOfficialUrl, input.source.officialEntryUrl)!'));
 for(const id of ['original position 7','legacy:id/with%20escape','000000007']){const e=expected(1);e.jobs[0].sourceJobId=id;assert.equal(mergeRenderedList(payload(e),e)[0].sourceJobId,id);}
});
test('all default ports remain disabled and no tool is called',async()=>{
 let calls=0;const e=expected(),port=createCuaBrowserPort({toolCall:async()=>{calls++;},expected:e});assert.equal(port.enabled,false);
 const result=await createPublicVerifier({expected:e,port}).run();assert.equal(result.reason,'BROWSER_PORT_UNBOUND');assert.equal(calls,0);
});
for(const count of [1,7,51])for(const consent of [false,true])test(`synthetic fixed DOM and AX flow count=${count} consent=${consent}`,async()=>{
 const {f,result}=await invoke(expected(count),{consent});assert.equal(result.status,'PASS_LIST_AND_SOURCE_TIME_ONLY',JSON.stringify(result));
 assert.equal(result.productionQualified,false);assert.equal(result.detailVerification,'UNKNOWN');assert.equal(result.applicationVerification,'NOT_TESTED');assert.equal(result.newBatchAllowed,false);
 assert(f.evaluates.some(code=>code.includes("querySelectorAll('p.en')")));assert(!f.evaluates.some(code=>code.includes('aria-label')));
});
for(const [name,mutate] of [
 ['missing original title',row=>row.titles=[]],['duplicate original title',row=>row.titles.push(row.titles[0])],
 ['missing anchor',row=>row.anchors=[]],['duplicate anchor',row=>row.anchors.push(row.anchors[0])],
 ['wrong original title',row=>row.titles[0].innerText='Other role'],['original title whitespace differs',row=>row.titles[0].innerText+=' '],
 ['unknown public URL',row=>row.anchors[0].href+='&unreviewed=true'],['invisible original title',row=>row.titles[0].getClientRects=()=>[]],
 ['visibility hidden title',row=>row.titles[0].style={visibility:'hidden'}],['transparent ancestor',row=>row.style={opacity:'0'}],
 ['inert ancestor',row=>row.inert=true],['aria-hidden ancestor',row=>row.getAttribute=n=>n==='aria-hidden'?'true':null],
 ['hidden row',row=>row.getClientRects=()=>[]]
])test('fixed READ_LIST DOM execution holds '+name,async()=>{
 const {result}=await invoke(expected(2),{mutateRow(row,index){if(index===0)mutate(row);}});assert.equal(result.status,'HOLD');
});
test('same-row title association rejects swapped titles even when complete set matches',async()=>{
 const e=expected(2),{result}=await invoke(e,{mutateRow(row,index){row.titles[0].innerText=e.jobs[1-index].officialTitle;}});assert.equal(result.reason,'PUBLIC_LIST_MISMATCH');
});
test('duplicate observed URL holds',async()=>{
 const e=expected(2),{result}=await invoke(e,{mutateRow(row,index){if(index)row.anchors[0].href=e.jobs[0].officialUrl;}});assert.equal(result.reason,'DUPLICATE_RENDERED_URL');
});
test('ambiguous expected URL holds before any tool call',()=>{
 const e=expected(2);e.jobs[1].officialUrl=e.jobs[0].officialUrl;
 assert.throws(()=>createCuaBrowserPort({enabled:true,expected:e,toolCall:async()=>{throw Error('must not call');}}),/VIATRIS_AMBIGUOUS_EXPECTED_URL/);
});
test('missing company holds instead of treating the source as verified zero',async()=>{
 const {result}=await invoke(expected(1),{companyPresent:false});assert.equal(result.status,'HOLD');assert.match(result.reason,/VIATRIS_COMPANY_MISSING/);
});
test('Viatris empty expected is rejected before any browser call',async()=>{
 const e=expected(0),port=fakePort(e),result=await createPublicVerifier({expected:e,port}).run();assert.equal(result.reason,'VIATRIS_ZERO_ROWS_FAILED');assert.equal(port.calls.length,0);
 assert.throws(()=>createCuaBrowserPort({enabled:true,expected:e,toolCall:async()=>{}}),/VIATRIS_ZERO_ROWS_FAILED/);
});
test('caller mutation does not change frozen URL to original ID binding',async()=>{
 const e=expected(1),reviewed=structuredClone(e),f=fixture(e);e.jobs[0].sourceJobId='mutated-id';e.removedIds.push('mutated-removed');
 const result=await createPublicVerifier({expected:reviewed,port:f.port}).run();assert.equal(result.status,'PASS_LIST_AND_SOURCE_TIME_ONLY');
});
for(const field of ['batchId','observedAt','expectedFileSha256','jobs','removedIds'])test('machine expected cannot differ from frozen port '+field,async()=>{
 const e=expected(2),f=fixture(e),other=structuredClone(e);
 if(field==='batchId')other.batchId+='-other';if(field==='observedAt')other.observedAt='2026-10-11T15:24:18.748Z';if(field==='expectedFileSha256')other.expectedFileSha256='b'.repeat(64);
 if(field==='jobs')other.jobs[0].sourceJobId='different-original-id';if(field==='removedIds')other.removedIds=[];
 const result=await createPublicVerifier({expected:other,port:f.port}).run();assert.equal(result.reason,'VIATRIS_PORT_EXPECTED_BINDING_MISMATCH');assert.equal(f.calls.length,0);
});
test('render payload cannot pass an arbitrary claimed ID or translated officialTitle',()=>{
 const e=expected(1),p=payload(e);p.jobs[0].sourceJobId=e.jobs[0].sourceJobId;assert.throws(()=>mergeRenderedList(p,e),/INVALID_RENDERED_JOB_FIELDS/);
 const q=payload(e);q.jobs[0].officialTitle=e.jobs[0].officialTitle;assert.throws(()=>mergeRenderedList(q,e),/INVALID_RENDERED_JOB_FIELDS/);
});
test('wrong source or company expected rejects before binding',()=>{
 for(const field of ['sourceId','companyId']){const e=expected();e[field]='other';assert.throws(()=>createCuaBrowserPort({enabled:true,expected:e}),/SOURCE_NOT_ALLOWED/);}
});
test('public operations are closed; arbitrary selectors or action scripts cannot be passed',()=>{
 for(const action of ['FETCH','EVALUATE','OPEN_URL','__proto__','constructor'])assert.throws(()=>buildCuaCall(action));
 assert.throws(()=>buildCuaCall('READ_LIST',{index:1}));assert.throws(()=>buildCuaCall('CLICK_FRESH_INDEX',{index:-1}));
 assert(!buildCuaCall('READ_LIST').code.includes('positionId='));
});
test('packet unknown fields, mixed blocks and wrong source prefix hold',()=>{
 const p={kind:'JOBFINDER_VIATRIS_PUBLIC_UI_V1',action:'READ_LIST',payload:payload(expected())};
 const result=x=>({content:[{type:'text',text:JSON.stringify(x)}]});assert.deepEqual(parseCuaPacket(result(p),'READ_LIST'),p.payload);
 assert.throws(()=>parseCuaPacket(result({...p,extra:true}),'READ_LIST'));
 assert.throws(()=>parseCuaPacket(result({...p,kind:'OTHER_SOURCE'}),'READ_LIST'));
 assert.throws(()=>parseCuaPacket({content:[...result(p).content,...result(p).content]},'READ_LIST'));
});
test('source card rejects wrong entry, absent company and unknown visible UTC minute',()=>{
 const p={text:'晖致中国\n最近成功更新 2026-10-11 15:23 UTC',officialEntry:TARGET.officialEntry};assert.equal(parseVisibleSourceCard(p).companyId,TARGET.companyId);
 for(const q of [{...p,officialEntry:'https://example.com/'},{...p,text:p.text.replace('晖致中国','其他公司')},{...p,text:p.text.replace(' UTC','')},{...p,text:p.text+'\n最近成功更新 2026-10-11 15:23 UTC'}])assert.throws(()=>parseVisibleSourceCard(q));
});
test('bundle exactly regenerates and defaults remain disabled without Node globals',()=>{
 const modules=['contract.mjs','compare.mjs','machine.mjs','actual-ax.mjs','cua-port.mjs'];
 let rebuilt='// GENERATED from contract.mjs, compare.mjs, machine.mjs, actual-ax.mjs, cua-port.mjs. No real tools bound.\n(() => {\n';
 for(const file of modules)rebuilt+='\n// '+file+'\n'+read('../'+file).replace(/^import\s[\s\S]*?from\s'[^']+';\n/gm,'').replace(/^export /gm,'');
 rebuilt+='\nreturn Object.freeze({TARGET, LIMITS, UNBOUND_PORT, BrowserProtocolTimeout, createPublicVerifier, runPublicVerification, comparePublicList, compareSourceMinute, createCuaBrowserPort, buildCuaCall, parseCuaPacket, validateDecodedAx, resolveFreshControl, mergeRenderedList, parseVisibleSourceCard, UNBOUND_AX_DECODER, ACTUAL_PUBLIC_UI_DECODER, decodeActualAx, assertActualStartupResult});\n})()\n';
 assert.equal(read('../functions-bundle.js'),rebuilt);
 const api=runInNewContext(rebuilt,{});assert.equal(api.TARGET.sourceId,TARGET.sourceId);assert.equal(api.createCuaBrowserPort().enabled,false);assert(Object.isFrozen(api));
 const e=expected();assert.deepEqual(JSON.parse(JSON.stringify(api.mergeRenderedList(payload(e),e))),e.jobs.map(j=>({...j,renderedOriginalTitle:j.officialTitle})));
});
for(const [name,mutate] of [
 ['hidden card',card=>card.hidden=true],['visibility hidden card',card=>card.style={visibility:'hidden'}],
 ['transparent card ancestor',card=>card.parentElement={parentElement:null,style:{opacity:'0'},getAttribute:()=>null}],
 ['inert card ancestor',card=>card.parentElement={parentElement:null,inert:true,getAttribute:()=>null}],
 ['aria hidden card ancestor',card=>card.parentElement={parentElement:null,getAttribute:k=>k==='aria-hidden'?'true':null}],
 ['missing entry anchor',card=>card.anchors=[]],['duplicate entry anchor',card=>card.anchors.push(card.anchors[0])],
 ['hidden entry anchor',card=>card.anchors[0].hidden=true],['wrong official entry',card=>card.anchors[0].href='https://example.com/other']
])test('fixed source-card DOM execution holds '+name,async()=>{
 const {result}=await invoke(expected(1),{mutateCard:mutate});assert.equal(result.status,'HOLD');assert.match(result.reason,/SOURCE_TIME_MISSING|WRONG_TIME_SOURCE/);
});
