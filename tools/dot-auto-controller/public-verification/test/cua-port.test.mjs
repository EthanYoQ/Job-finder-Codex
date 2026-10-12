import test from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {createPublicVerifier} from '../machine.mjs';
import {TARGET,EXISTING_CONSENT_LABEL,BrowserProtocolTimeout} from '../contract.mjs';
import {createCuaBrowserPort,buildCuaCall,parseCuaPacket,resolveFreshControl,mergeRenderedList,parseVisibleSourceCard} from '../cua-port.mjs';
import {expected,job,clone} from './synthetic.mjs';

// This authored normalization is SYNTHETIC ONLY, never a recorded proprietary AX shape.
function fixture(e,{stale=false,stillStale=false,consent=false,mutateAx=null,mutateTool=null}={}) {
  let reloads=0,accepted=!consent,checked=false,view=accepted?'jobs':'consent',expanded=false,all=false,filtered=false,indexBase=0;
  let currentControls=[];const calls=[];const evaluates=[];
  const jobs=()=>[...e.jobs,...((reloads?stillStale:stale)?e.removedIds.map(job):[])];
  const c=(role,name,{disabled=false,checked=null,value=null}={})=>({index:++indexBase,role,name,disabled,checked,value});
  const ax=()=>{
    indexBase+=100;
    const controls=view==='consent'?[c('checkbox',EXISTING_CONSENT_LABEL,{checked}),c('link','隐私政策',{value:'job.orz.md/privacy'}),c('link','服务条款',{value:'job.orz.md/terms'}),c('button','进入 Job-search',{disabled:!checked})]:
      [c('button','官方招聘目录'),...(view==='jobs'?[c('button',`E5 武田中国 ${jobs().length} 个职位`),...(expanded&&!all?[c('button',`查看全部 ${jobs().length} 个职位`)]:[])]:[c('searchbox','搜索已覆盖公司')])];
    currentControls=controls;
    const s={websiteUrl:TARGET.websiteUrl,view,state:'READY',errorBanner:false,consentAccepted:accepted,materialChangeNotice:false,
      recognizedExistingFlow:true,companyExpanded:expanded,allJobsVisible:all,directoryFiltered:filtered,controls};
    mutateAx?.(s,calls);return {fixtureKind:'SYNTHETIC_AX_NOT_ACTUAL_CUA_SCHEMA',snapshot:s};
  };
  const document={querySelectorAll(selector){
    if(selector==='a')return jobs().map(j=>({href:j.officialUrl,getClientRects:()=>[{}],getAttribute:()=>`查看官方职位 ${j.officialTitle}`,textContent:j.officialTitle}));
    if(selector==='#jobs-company-takeda-china .job')return jobs().map(j=>({getClientRects:()=>[{}],querySelector:s=>s==='a'?{href:j.officialUrl}:{innerText:j.officialTitle}}));
    throw Error('Unknown selector');
  },getElementById(id){assert.equal(id,'row-company-takeda-china');return {getClientRects:()=>[{}],innerText:'E5\n武田中国\n最近成功更新 2026-10-11 15:23 UTC\n官方招聘入口',querySelector:s=>{assert.equal(s,'a');return {href:TARGET.officialEntry};}};}};
  const tab={async getAXState(){return ax();},async click(index){
    const control=currentControls.find(c=>c.index===index);assert(control,'Only a fresh AX index may be clicked');assert(!control.disabled);
    if(control.role==='checkbox')checked=true;
    else if(control.name==='进入 Job-search'){accepted=true;view='jobs';}
    else if(control.name.startsWith('E5 '))expanded=true;
    else if(control.name.startsWith('查看全部 '))all=true;
    else throw Error('Unexpected index click');
  },async reload(){reloads++;accepted=!consent;checked=false;view=accepted?'jobs':'consent';expanded=false;all=false;filtered=false;},playwright:{
    getByRole(role,options){
      if(role==='button'){assert.deepEqual(JSON.parse(JSON.stringify(options)),{name:'官方招聘目录',exact:true});return {async click(){view='directory';expanded=false;all=false;filtered=false;}};}
      assert.equal(role,'searchbox');assert.equal(options.name,'搜索已覆盖公司');return {async fill(value){assert.equal(value,'武田');filtered=true;}};
    },async evaluate(fn,...args){assert.equal(typeof fn,'function');assert.equal(args.length,0);evaluates.push(fn.toString());return fn();}
  }};
  const context={cua:{async createBrowserTab(browser,url){assert.equal(browser,'cdp');assert.equal(url,'https://job.orz.md');context.__jobfinder_public_ui_v2_tab=tab;return tab;}},document,nodeRepl:{write(){throw Error('write not bound');}}};
  const toolCall=async request=>{
    calls.push(request);let output=[];context.nodeRepl.write=value=>output.push({type:'text',text:value});
    await runInNewContext(`(async()=>{${request.code}})()`,context);
    let response=output.length?{content:output}:{fixtureKind:'SYNTHETIC_NATIVE_STARTUP_NOT_ACTUAL_CUA_SCHEMA'};
    if(mutateTool)response=mutateTool(response,request,calls)??response;
    return response;
  };
  const decoder={kind:'REVIEWED_ACTUAL_AX_DECODER', // Test injection; not a claim of real qualification.
    assertStartupResult(r){assert.equal(r.fixtureKind,'SYNTHETIC_NATIVE_STARTUP_NOT_ACTUAL_CUA_SCHEMA');},
    decodeAx(raw){assert.equal(raw.fixtureKind,'SYNTHETIC_AX_NOT_ACTUAL_CUA_SCHEMA');return raw.snapshot;}};
  return {port:createCuaBrowserPort({enabled:true,toolCall,decoder}),calls,evaluates,ax,decoder,toolCall};
}
test('real CUA port is disabled without exact decoder and injected tool',async()=>{
  let calls=0;const p=createCuaBrowserPort({enabled:false,toolCall:async()=>{calls++;}});
  assert.equal(p.enabled,false);await assert.rejects(p.execute({}),/CUA_PORT_DISABLED/);assert.equal(calls,0);
});
test('builder open is precisely one supported CUA entry call',()=>{
  const r=buildCuaCall('OPEN_HOME');assert.equal(r.code,'var __jobfinder_public_ui_v2_tab = await cua.createBrowserTab("cdp", "https://job.orz.md");');
  assert(!r.code.includes('nodeRepl.write'));assert(!r.code.includes('getAXState'));
});
for(const operation of ['https://example.com','API','fetch','READ_DETAIL','APPLY_JOB','toString'])test(`builder rejects arbitrary ${operation}`,()=>assert.throws(()=>buildCuaCall(operation),/CUA_OPERATION_NOT_ALLOWED/));
test('builder rejects injected AX index or expanded timeout',()=>{
  assert.throws(()=>buildCuaCall('CLICK_FRESH_INDEX',{index:'1);fetch(1)'}),/INVALID_AX_INDEX/);
  assert.throws(()=>buildCuaCall('OBSERVE_AX',{timeoutMs:16000}),/INVALID_CUA_TIMEOUT/);
});
test('strict packet rejects unobserved outer wrappers and mismatched marker/action',()=>{
  for(const r of [{result:'{}'},{content:[{type:'text',text:'prefix {"kind":"JOBFINDER_PUBLIC_UI_V2"}'}]},
    {content:[{type:'text',text:'{}'},{type:'text',text:'{}'}]}]) assert.throws(()=>parseCuaPacket(r,'READ_LIST'));
  assert.throws(()=>parseCuaPacket({isError:true,content:[]},'READ_LIST'),/CUA_TOOL_ERROR_OR_DENIAL/);
  assert.throws(()=>parseCuaPacket({content:[{type:'text',text:JSON.stringify({kind:'OTHER',action:'READ_LIST',payload:{}})}]},'READ_LIST'),/CUA_PACKET_ACTION_MISMATCH/);
});
test('fixed real tool-call strings execute full synthetic 119→116 and consent flow',async()=>{
  const e=expected(116),f=fixture(e,{stale:true,consent:true});
  const r=await createPublicVerifier({expected:e,port:f.port}).run();assert.equal(r.status,'PASS_LIST_AND_SOURCE_TIME_ONLY');assert.equal(r.ordinaryReloadCount,1);
  assert.equal(f.calls.filter(c=>c.code.includes('.reload()')).length,1);assert.equal(f.evaluates.length,4);
  assert(f.calls.every(c=>!c.code.includes('fetch(')&&!c.code.includes('document.cookie')));
});
test('fixed adapter exact current needs no reload',async()=>{
  const e=expected(),f=fixture(e);const r=await createPublicVerifier({expected:e,port:f.port}).run();assert.match(r.status,/^PASS/);assert.equal(r.ordinaryReloadCount,0);
});
test('unknown actual tool wrapper holds with no second request',async()=>{
  const e=expected(),f=fixture(e,{mutateTool(r,request){if(request.code.includes('getAXState'))return {content:[{type:'text',text:'unknown real wrapper'}]};}});
  const r=await createPublicVerifier({expected:e,port:f.port}).run();assert.equal(r.reason,'UNKNOWN_CUA_RESULT_FORMAT');assert.equal(f.calls.length,2);
  await assert.rejects(f.port.execute({}),/CUA_PORT_HALTED_OR_BUSY/);
});
test('non-timeout decoder error propagates rather than fabricating UI state',async()=>{
  const e=expected(),f=fixture(e),error=new TypeError('decoder bug');f.decoder.decodeAx=()=>{throw error;};
  await assert.rejects(createPublicVerifier({expected:e,port:f.port}).run(),actual=>actual===error);
});
test('unknown actual AX shape cannot masquerade as normalized fields',async()=>{
  const e=expected(),f=fixture(e);f.decoder.decodeAx=()=>({text:'unknown actual AX'});
  const r=await createPublicVerifier({expected:e,port:f.port}).run();assert.equal(r.reason,'UNKNOWN_AX_DECODER_SCHEMA');assert.equal(f.calls.length,2);
});
test('duplicate company controls stop before any click',async()=>{
  const e=expected(),f=fixture(e,{mutateAx(s){const company=s.controls.find(c=>c.name.startsWith('E5 '));s.controls.push({...company,index:company.index+50});}});
  const r=await createPublicVerifier({expected:e,port:f.port}).run();assert.equal(r.reason,'AX_COMPANY_NOT_UNIQUE');assert(!f.calls.some(c=>/\.click\(/.test(c.code)));
});
test('changed legal-link path stops before checkbox click',async()=>{
  const e=expected(),f=fixture(e,{consent:true,mutateAx(s){s.controls.find(c=>c.name==='隐私政策').value='https://job.orz.md/privacy-v2';}});
  const r=await createPublicVerifier({expected:e,port:f.port}).run();assert.equal(r.reason,'CONSENT_CHANGED_OR_UNVERIFIED');assert(!f.calls.some(c=>/\.click\(/.test(c.code)));
});
test('rendered paragraph merge is truly bidirectional',()=>{
  const e=expected(),payload={anchorJobs:e.jobs,visibleTitles:e.jobs.map(j=>({sourceJobId:j.sourceJobId,renderedOriginalTitle:j.officialTitle}))};
  assert.equal(mergeRenderedList(payload).length,2);
  for(const mutate of [p=>p.visibleTitles.pop(),p=>p.visibleTitles[1].sourceJobId=p.visibleTitles[0].sourceJobId,p=>p.visibleTitles[0].sourceJobId='9999',p=>p.anchorJobs[1]=clone(p.anchorJobs[0])]){
    const bad=clone(payload);mutate(bad);assert.throws(()=>mergeRenderedList(bad));
  }
});
test('source-card parser rejects global time, wrong source, missing UTC and multiple times',()=>{
  const good={text:'武田中国\n最近成功更新 2026-10-11 15:23 UTC',officialEntry:TARGET.officialEntry};assert.equal(parseVisibleSourceCard(good).text,'2026-10-11 15:23 UTC');
  for(const bad of [{...good,text:good.text.replace('最近成功更新','全站更新')},{...good,officialEntry:'https://example.com/'},{...good,text:good.text.replace(' UTC','')},{...good,text:good.text+'\n最近成功更新 2026-10-11 15:24 UTC'}])assert.throws(()=>parseVisibleSourceCard(bad));
});
test('loading snapshot never permits a stale control click',()=>{
  const f=fixture(expected()),s=f.ax().snapshot;s.state='LOADING';
  assert.throws(()=>resolveFreshControl(s,'EXPAND_COMPANY'),/AX_UI_NOT_READY/);
});
test('UTC suffix must be a literal complete displayed minute',()=>{
  const good={text:'武田中国\n最近成功更新 2026-10-11 15:23 UTCabc',officialEntry:TARGET.officialEntry};
  assert.throws(()=>parseVisibleSourceCard(good),/HOLD_TIME_UNKNOWN/);
});
test('adapter preserves original tool promise while unresolved and does not schedule another action',async()=>{
  let resolve;const raw=new Promise(r=>resolve=r);let calls=0;
  const decoder={kind:'REVIEWED_ACTUAL_AX_DECODER',decodeAx(){throw Error('not reached');},assertStartupResult(){throw new BrowserProtocolTimeout();}};
  const p=createCuaBrowserPort({enabled:true,decoder,toolCall(){calls++;return raw;}});
  const executing=p.execute({schemaVersion:1,action:'OPEN_HOME',target:TARGET,timeoutMs:15000,deadlineAtMs:Date.now()+15000});
  await Promise.resolve();assert.equal(p.originalToolOperation,raw);assert.equal(p.toolOperationPending,true);assert.equal(calls,1);
  resolve({});await assert.rejects(executing,error=>error instanceof BrowserProtocolTimeout);assert.equal(p.toolOperationPending,false);assert.equal(calls,1);
});
