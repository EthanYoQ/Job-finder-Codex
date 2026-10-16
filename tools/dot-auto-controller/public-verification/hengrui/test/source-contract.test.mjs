import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {mokaSha256,hengruiMokaId,hengruiMokaUrl,hengruiMokaRawId,HENGRUI_JOB_PREFIX} from '../moka-id.mjs';
import {officialJobUrl,validateJob,TARGET} from '../contract.mjs';
import {mergeRenderedList} from '../cua-port.mjs';
import {createPublicVerifier} from '../machine.mjs';
import {fixture} from '../../../fixed-host/hengrui/synthetic-ui-port.mjs';
import {expected,job,fakePort} from './synthetic.mjs';
// All browser inputs are synthetic. Execute the exact original tiny native Moka
// functions below with only TypeScript annotations removed; no ATS/network call.
const source=fs.readFileSync(new URL('../../../vendor/c60-source/src/crawler/mokaSourceFetch.ts',import.meta.url),'utf8');
const hash=x=>createHash('sha256').update(x).digest('hex');
const extract=(name,next)=>source.slice(source.indexOf('function '+name+'('),source.indexOf('\nfunction '+next+'(',source.indexOf('function '+name+'(')));
const originalId=new Function('sha256Bytes','Buffer',extract('irreversibleEvidenceId','missingMokaRequiredField').replace('value: unknown','value').replace('): string',')')+';return irreversibleEvidenceId;')(b=>({sha256:hash(b)}),Buffer);
const originalUrl=new Function(extract('buildMokaJobUrl','mokaRawLocator').replace('officialEntryUrl: string, sourceJobId: string','officialEntryUrl, sourceJobId').replace('): string',')')+';return buildMokaJobUrl;')();
const originalRawId=new Function('isObject',extract('mokaJobId','requiredText').replace('job: unknown','job').replace('): string | undefined',')')+';return mokaJobId;')(x=>x!==null&&typeof x==='object');
for(const raw of ['1000','ASCII','中文职位','💊-科学家','Percent%20raw','A/B#C?D','quote"slash\\','line\ninside',0,-23,Number.MAX_SAFE_INTEGER])test('original native JSON-hash and encoded URL '+JSON.stringify(raw),()=>{
 const normalized=originalRawId({id:raw}),url=originalUrl(TARGET.officialEntry,normalized);
 assert.equal(mokaSha256(JSON.stringify(normalized)).sha256,hash(JSON.stringify(normalized)));
 assert.equal(hengruiMokaId(normalized),originalId(normalized));assert.equal(hengruiMokaUrl(normalized),url);
 assert.equal(hengruiMokaRawId(url),normalized);assert.equal(officialJobUrl(url,originalId(normalized)),true);
});
test('native trims raw strings before hashing JSON string bytes',()=>{const normalized=originalRawId({id:'  1000  '});assert.equal(normalized,'1000');assert.equal(hengruiMokaId(normalized),originalId('1000'));assert.notEqual(originalId(1000),hengruiMokaId('1000'));assert.notEqual('sha256:'+hash('1000'),hengruiMokaId('1000'));});
const j=job(1000);
for(const url of [j.officialUrl+'?x=1',j.officialUrl+'#x',j.officialUrl.replace('app.mokahr.com','evil.test'),j.officialUrl.replace('145996','145997'),j.officialUrl.replace('/hengrui/','/other/'),j.officialUrl.replace('#/job/','#/jobs/'),j.officialUrl.replace('1000','1001'),HENGRUI_JOB_PREFIX+'%31%30%30%30',HENGRUI_JOB_PREFIX+'%ZZ',HENGRUI_JOB_PREFIX+'%20x%20'])test('reject differing Moka URL '+url,()=>assert.equal(officialJobUrl(url,j.sourceJobId),false));
const collection=()=>({companyPresent:true,anchorJobs:[{...j,sourceJobId:j.officialUrl}],visibleTitles:[{sourceJobId:j.officialUrl,renderedOriginalTitle:j.officialTitle}]});
test('raw Moka URL collection hashes native ID and validates exact fields',()=>assert.deepEqual(mergeRenderedList(collection()),[{...j,renderedOriginalTitle:j.officialTitle}]));
test('duplicate anchors fail',()=>{const c=collection();c.anchorJobs.push(c.anchorJobs[0]);c.visibleTitles.push(c.visibleTitles[0]);assert.throws(()=>mergeRenderedList(c));});
test('different title membership fails',()=>{const c=collection();c.visibleTitles[0].sourceJobId=job(9999).officialUrl;assert.throws(()=>mergeRenderedList(c));});
test('Workday/path/REQ IDs cannot enter Moka public contract',()=>{for(const id of ['REQ1000','1000','workday:'+j.sourceJobId,'/job/1000'])assert.throws(()=>validateJob({...j,sourceJobId:id}));});
test('empty visible collection is legitimate data',()=>assert.deepEqual(mergeRenderedList({companyPresent:false,anchorJobs:[],visibleTitles:[]}),[]));
for(const count of [0,1,51])for(const options of [{},{stale:true},{stale:true,stillStale:true},{consent:true}])test('actual fixed CUA selectors, synthetic Moka count '+count+' '+JSON.stringify(options),async()=>{
 const e=expected(count),f=fixture(e,options),result=await createPublicVerifier({expected:e,port:f.port}).run();
 assert.equal(result.status,options.stillStale?'HOLD':'PASS_LIST_AND_SOURCE_TIME_ONLY',JSON.stringify(result));
 if(count===0&&!options.stale)assert(!f.calls.some(c=>/\.click\(\d+\)/.test(c.code)&&!options.consent),'No invented empty company expansion');
 assert.equal(result.productionQualified,false);
});
test('verified empty needs a matching source directory minute',async()=>{const e=expected(0),p=fakePort(e,{mutate(o,c){if(c.action==='READ_SOURCE_TIME')o.sourceTime=null;}});const r=await createPublicVerifier({expected:e,port:p}).run();assert.equal(r.reason,'SOURCE_TIME_MISSING');});
test('empty still loading cannot prove zero jobs',async()=>{const e=expected(0),p=fakePort(e,{loadingAt:'OPEN_HOME',loadingForever:true});const r=await createPublicVerifier({expected:e,port:p}).run();assert.equal(r.reason,'VISIBLE_LOADING_BUDGET_EXHAUSTED');});
test('unexpected nonempty rows cannot pass a reviewed zero result',async()=>{const e=expected(0),p=fakePort(e,{mutate(o,c){if(c.action==='READ_LIST'){o.jobs=[{...j,renderedOriginalTitle:j.officialTitle}];o.ui.displayedCount=1;o.ui.companyExpanded=true;o.ui.allJobsVisible=true;}}});const r=await createPublicVerifier({expected:e,port:p}).run();assert.equal(r.reason,'PUBLIC_LIST_MISMATCH');});
test('absent company cannot pass a first nonempty appearance',async()=>{const e=expected(1),f=fixture({...e,jobs:[]});const r=await createPublicVerifier({expected:e,port:f.port}).run();assert.equal(r.reason,'PUBLIC_LIST_MISMATCH');});
test('C3 and full company label derive from pinned original 41-company reader',()=>{
 const registry=fs.readFileSync(new URL('../../../vendor/reader-main/src/data/companyRegistry.ts',import.meta.url),'utf8');
 const manifest=fs.readFileSync(new URL('../../../vendor/reader-main/src/release/launchManifest.ts',import.meta.url),'utf8');
 const roster=manifest.slice(manifest.indexOf('const FROZEN_FOREIGN_COMPANY_IDS'),manifest.indexOf('export const P0_CANDIDATE_COMPANY_IDS'));
 const ids=new Set([...roster.matchAll(/"(company-[^"]+)"/g)].map(m=>m[1]));
 const rows=[...registry.matchAll(/id: "(company-[^"]+)",\s*officialChineseName: "([^"]+)"/g)].map(m=>({id:m[1],name:m[2]})).filter(c=>ids.has(c.id)).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
 assert.equal(rows.length,41);const index=rows.findIndex(c=>c.id===TARGET.companyId);assert.equal(rows[index].name,TARGET.companyName);assert.equal(String.fromCharCode(65+Math.floor(index/8))+(index%8+1),'C3');
});

test('collapsed or unrecognized present source cannot masquerade as absent zero',()=>assert.throws(()=>mergeRenderedList({companyPresent:true,anchorJobs:[],visibleTitles:[]}),/RENDERED_COMPANY_PRESENCE_MISMATCH/));
test('missing source container cannot carry purported rendered jobs',()=>{const c=collection();c.companyPresent=false;assert.throws(()=>mergeRenderedList(c),/RENDERED_COMPANY_PRESENCE_MISMATCH/);});

test('dedicated functions bundle contains the closed six-module Hengrui source and rebuilds byte-for-byte',()=>{
 const modules=['moka-id.mjs','contract.mjs','compare.mjs','machine.mjs','actual-ax.mjs','cua-port.mjs'];
 const builder=fs.readFileSync(new URL('../scripts/build-functions-bundle.mjs',import.meta.url),'utf8');
 assert(builder.includes("const files = ['moka-id.mjs','contract.mjs','compare.mjs','machine.mjs','actual-ax.mjs','cua-port.mjs'];"));
 let rebuilt='// GENERATED from contract.mjs, compare.mjs, machine.mjs, actual-ax.mjs, cua-port.mjs. No real tools bound.\n(() => {\n';
 for(const file of modules)rebuilt+='\n// '+file+'\n'+fs.readFileSync(new URL('../'+file,import.meta.url),'utf8').replace(/^import\s[\s\S]*?from\s'[^']+';\n/gm,'').replace(/^export /gm,'');
 rebuilt+='\nreturn Object.freeze({TARGET, LIMITS, UNBOUND_PORT, BrowserProtocolTimeout, createPublicVerifier, runPublicVerification, comparePublicList, compareSourceMinute, createCuaBrowserPort, buildCuaCall, parseCuaPacket, validateDecodedAx, resolveFreshControl, mergeRenderedList, parseVisibleSourceCard, UNBOUND_AX_DECODER, ACTUAL_PUBLIC_UI_DECODER, decodeActualAx, assertActualStartupResult});\n})()\n';
 const bundle=fs.readFileSync(new URL('../functions-bundle.js',import.meta.url),'utf8');assert.equal(rebuilt,bundle);
 const bundled=(0,eval)(bundle);assert.deepEqual(bundled.TARGET,TARGET);assert.equal(Object.isFrozen(bundled),true);
 assert.equal(typeof bundled.createPublicVerifier,'function');assert.equal(typeof bundled.createCuaBrowserPort,'function');
});
