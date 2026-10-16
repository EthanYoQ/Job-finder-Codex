import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {decodeActualAx,assertActualStartupResult} from '../actual-ax.mjs';
import {resolveFreshControl} from '../cua-port.mjs';
const samples=JSON.parse(readFileSync(new URL('../../test/observed-ax-grammar.json',import.meta.url),'utf8').replaceAll('company-takeda-china','company-viatris').replaceAll('武田中国','晖致中国').replaceAll('武田','晖致').replaceAll('E5','B6')).samples;
// Browser metadata uses synthetic 0, not the sampled session locator. Indices were renumbered.
const header='Browser tab: 0, Title: "Job-search | 中国医药官方职位聚合", URL: "https://job.orz.md/".\n';
const raw=name=>header+samples[name];
for(const [name,view,state]of [['consent','consent','READY'],['jobsLoading','jobs','LOADING'],['jobsReady','jobs','READY'],['jobsExpanded','jobs','READY'],['directoryLoading','directory','LOADING'],['directoryFilteredLoading','directory','LOADING'],['directoryReady','directory','READY']])test('observed grammar '+name,()=>{const s=decodeActualAx(raw(name));assert.equal(s.view,view);assert.equal(s.state,state);});
test('observed checkbox and expanded control parsed without stale locator assumptions',()=>{
  const c=decodeActualAx(raw('consent'));assert.equal(resolveFreshControl(c,'CHECK_EXISTING_CONSENT'),210);assert.equal(c.controls.find(c=>c.name==='进入 Job-search').disabled,true);
  const e=decodeActualAx(raw('jobsExpanded'));assert.equal(e.companyExpanded,true);assert.equal(e.allJobsVisible,false);assert.equal(resolveFreshControl(e,'VIEW_ALL'),8);
  const d=decodeActualAx(raw('directoryReady'));assert.equal(d.directoryFiltered,true);assert.equal(d.controls.find(c=>c.role==='searchbox').value,'晖致');
});
test('original native startup documentation prefix accepted only with valid observed state',()=>{
  assertActualStartupResult({isError:false,content:[{type:'text',text:'First-use documentation\n'+raw('consent')}]});
  assert.throws(()=>assertActualStartupResult({isError:false,content:[{type:'text',text:'success'}]}),/UNKNOWN_ACTUAL_AX_HEADER/);
});
for(const [name,modify]of [['diff',()=>'- 1 button removed'],['foreign domain',s=>s.replaceAll('job.orz.md','example.com')],['unknown role',s=>s+'\n\t99 alert dangerous'],['duplicate index',s=>s+'\n\t3 button duplicate']])test('unknown actual grammar holds: '+name,()=>assert.throws(()=>decodeActualAx(modify(raw('jobsReady')))));
test('changed terms and error notice cannot yield accepted healthy UI',()=>{
  assert.throws(()=>decodeActualAx(raw('consent')+'\n\t99 text 服务条款更新'),/CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED/);
  const error=decodeActualAx(raw('jobsReady')+'\n\t99 text 网络异常');assert.equal(error.state,'ERROR');assert.equal(error.errorBanner,true);
});
test('additional actual definition-list grammar is accepted without becoming a control',()=>{
  const a=decodeActualAx(raw('jobsReady')),b=decodeActualAx(raw('jobsReady')+'\n\t80 definition list');assert.deepEqual(a,b);
});
for(const [name,source,from,to]of [
  ['checkbox readonly','consent','(settable, integer)','(unrecognized-readonly, integer)'],
  ['button unknown','consent','button (disabled)','button (unrecognized-enabled)'],
  ['search field readonly','jobsReady','search text field (settable)','search text field (readonly)'],
  ['consent lacks editable marker','consent','checkbox (settable, integer)','checkbox']
])test('unknown actionable flags fail closed: '+name,()=>assert.throws(()=>decodeActualAx(raw(source).replace(from,to)),/AX_UNKNOWN_INTERACTIVE_FLAGS|AX_CONSENT_NOT_SETTABLE/));
for(const notice of ['服务条款已调整，请重新同意','New terms apply. Please accept.','任意从未观察的提示','Updated privacy choices'])test('any added consent notice holds without keyword guessing: '+notice,()=>{
  assert.throws(()=>decodeActualAx(raw('consent')+'\n\t999 text '+notice),/CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED/);
});
test('only observed checkbox and enabled-entry transition preserves consent surface',()=>{
  const checked=raw('consent').replace('服务条款, Value: 0','服务条款, Value: 1').replace('button (disabled) 进入 Job-search','button 进入 Job-search');
  assert.equal(resolveFreshControl(decodeActualAx(checked),'ENTER_EXISTING_CONSENT'),216);
  assert.throws(()=>decodeActualAx(raw('consent').replace('先完成同意，前台才会请求职位搜索结果。','原文被替换')),/CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED/);
  assert.throws(()=>decodeActualAx(raw('consent').replace('\t\t208 text','\t208 text')),/CONSENT_SURFACE_CHANGED_OR_UNRECOGNIZED/);
});

test('missing ready Viatris company is HOLD, never verified zero',()=>assert.throws(()=>decodeActualAx(raw('jobsReady').replace(/^.*button \(collapsed\).*$/m,'')),/VIATRIS_COMPANY_MISSING/));
